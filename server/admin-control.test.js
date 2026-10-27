import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { testAuth, testSignIn } from './testing/auth.js';
import { createDb, migrate } from './db.js';
import { seedIfEmpty } from './seed.js';

let server;
let base;
let db;
let uploadDir;
const sent = [];
const OWNER_PHONE = '0950000009';

async function api(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = { status: res.status, body: await res.json().catch(() => ({})) };
  // Most tests are about what happens after payment, so the shop's "payment received" is recorded at once.
  // The payment steps themselves are tested in payments.test.js.
  if (method === 'POST' && url === '/api/orders' && out.status === 201 && body.payment === 'momo') {
    await db.query('UPDATE shipments SET paid_at = now() WHERE order_id = $1', [out.body.id]);
  }
  return out;
}

// Signs in through the stand-in for Neon Auth (see testing/auth.js).
async function signIn(phone, extra = {}) {
  return testSignIn(api, phone, extra);
}

const shopBody = (phone, name) => ({
  name,
  ownerFullName: 'Shop Owner',
  nrc: '123456/78/1',
  phone,
  province: 'lusaka',
  town: 'Lusaka',
  area: 'Cairo Road',
  momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'seller'],
});

let owner;
let seller;
let buyer;
let fanId;
const shipping = { name: 'Chipo', phone: '0966100100', province: 'lusaka', town: 'Lusaka', address: 'Plot 3' };
const order = () =>
  api(
    'POST',
    '/api/orders',
    { items: [{ productId: fanId, qty: 1 }], shipping, couriers: { [seller.shopId]: 'pickup' }, payment: 'momo' },
    buyer.token,
  );
const notificationsOf = async (token) => (await api('GET', '/api/notifications', undefined, token)).body;

before(async () => {
  db = await createDb({ url: '', dataDir: '' });
  await migrate(db);
  await seedIfEmpty(db);
  uploadDir = await mkdtemp(path.join(tmpdir(), 'zed-market-admin-control-'));
  server = createApp(db, { auth: testAuth,
    uploadDir,
    sms: { send: async (phone, message) => sent.push({ phone, message }) },
    adminPhones: [OWNER_PHONE],
  }).listen(0);
  base = `http://localhost:${server.address().port}`;

  owner = await signIn(OWNER_PHONE, { name: 'Noah' });
  seller = await signIn('0977100100', { name: 'Mutinta' });
  seller.shopId = (await api('POST', '/api/shops', shopBody('0977100100', 'Mutinta Appliances'), seller.token)).body.id;
  await api('PATCH', `/api/admin/shops/${seller.shopId}/verification`, { status: 'verified' }, owner.token);
  fanId = (
    await api('POST', '/api/products', { name: 'Standing Fan', category: 'home', price: 500, stock: 50, weightKg: 2 }, seller.token)
  ).body.id;
  buyer = await signIn('0966100100', { name: 'Chipo' });
});

after(async () => {
  server.close();
  await db.close();
  await rm(uploadDir, { recursive: true, force: true });
});

describe('staff accounts', () => {
  test('an admin account is staff only: it cannot open a shop', async () => {
    assert.equal(owner.user.isAdmin, true);
    assert.equal(owner.user.staffRole, 'owner');
    assert.equal(owner.user.shopId, null);
    const res = await api('POST', '/api/shops', shopBody('0950000009', 'Staff Shop'), owner.token);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /staff accounts can't open a shop/);
  });

  test('owners add and remove staff; staff cannot manage staff or settings', async () => {
    const added = await api('POST', '/api/admin/staff', { phone: '0955123456', name: 'Mapalo' }, owner.token);
    assert.equal(added.status, 201);
    const staff = await signIn('0955123456');
    assert.equal(staff.user.isAdmin, true);
    assert.equal(staff.user.staffRole, 'staff');

    assert.equal((await api('GET', '/api/admin/stats', undefined, staff.token)).status, 200);
    assert.equal((await api('POST', '/api/admin/staff', { phone: '0955999999' }, staff.token)).status, 403);
    assert.equal((await api('PATCH', '/api/admin/settings', { commissionRate: 0.2 }, staff.token)).status, 403);
    assert.equal((await api('POST', '/api/shops', shopBody('0955123456', 'Side hustle'), staff.token)).status, 403);
    // Staff can't suspend the owner, and the owner can't be suspended at all.
    assert.equal((await api('PATCH', `/api/admin/users/${owner.user.id}/suspension`, { suspended: true, reason: 'Testing it' }, staff.token)).status, 403);

    const list = (await api('GET', '/api/admin/staff', undefined, staff.token)).body;
    assert.deepEqual(list.map((s) => [s.name, s.role]), [
      ['Noah', 'owner'],
      ['Mapalo', 'staff'],
    ]);

    assert.equal((await api('DELETE', `/api/admin/staff/${staff.user.id}`, undefined, owner.token)).status, 200);
    assert.equal((await api('GET', '/api/admin/stats', undefined, staff.token)).status, 403, 'no admin access once removed');
    const again = await signIn('0955123456');
    assert.equal(again.user.isAdmin, false);
  });

  test('a shop owner cannot be made staff', async () => {
    const res = await api('POST', '/api/admin/staff', { phone: '0977100100' }, owner.token);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /owns the shop Mutinta Appliances/);
  });
});

describe('platform settings', () => {
  test('a new commission rate applies to new orders only', async () => {
    const before = (await order()).body;
    const changed = await api('PATCH', '/api/admin/settings', { commissionRate: 0.1, welcomeVoucher: 75 }, owner.token);
    assert.equal(changed.status, 200);
    assert.equal(changed.body.commissionRate, 0.1);
    const afterChange = (await order()).body;

    for (const o of [before, afterChange]) {
      await api('PATCH', `/api/orders/${o.id}/shipments/${seller.shopId}`, { status: 'dispatched' }, seller.token);
      await api('PATCH', `/api/orders/${o.id}/shipments/${seller.shopId}`, { status: 'delivered' }, seller.token);
    }
    const month = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 7);
    const statement = (await api('GET', `/api/seller/statement?month=${month}`, undefined, seller.token)).body;
    assert.deepEqual(
      statement.lines.map((l) => l.commission),
      [25, 50],
      'the earlier order keeps 5%, the new one pays 10%',
    );
    const { onHold } = (await api('GET', '/api/seller/payouts', undefined, seller.token)).body;
    assert.equal(onHold, -75, 'the shop was paid directly, so it owes the K25 + K50 commission');

    const { code } = (await api('GET', '/api/me/referral', undefined, buyer.token)).body;
    const friend = await signIn('0966400400', { referralCode: code });
    const [welcome] = (await api('GET', '/api/me/vouchers', undefined, friend.token)).body;
    assert.equal(welcome.amount, 75, 'the new welcome voucher amount');

    await api('PATCH', '/api/admin/settings', { commissionRate: 0.05, welcomeVoucher: 50 }, owner.token);
    const log = (await api('GET', '/api/admin/actions', undefined, owner.token)).body;
    assert.ok(log.some((a) => a.action === 'settings changed' && /commissionRate: 0.05 → 0.1/.test(a.note)));
  });

  test('settings are checked', async () => {
    assert.equal((await api('PATCH', '/api/admin/settings', { commissionRate: 0.9 }, owner.token)).status, 400);
    assert.equal((await api('PATCH', '/api/admin/settings', {}, owner.token)).status, 400);
  });
});

describe('acting for a shop', () => {
  test('staff fix shop details and listings, with a reason the shop sees', async () => {
    const shop = (await api('GET', `/api/admin/shops/${seller.shopId}`, undefined, owner.token)).body;
    const edit = { ...shop, name: 'Mutinta Home Appliances' };
    assert.equal((await api('PUT', `/api/admin/shops/${seller.shopId}`, edit, owner.token)).status, 400, 'reason needed');
    const saved = await api('PUT', `/api/admin/shops/${seller.shopId}`, { ...edit, note: 'Name as on PACRA certificate' }, owner.token);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.name, 'Mutinta Home Appliances');
    assert.equal((await notificationsOf(seller.token))[0].title, 'Zed Market updated your shop details');

    const product = (await api('GET', `/api/products/${fanId}`)).body;
    const fixed = await api(
      'PUT',
      `/api/admin/products/${fanId}`,
      { ...product, category: 'electronics', note: 'Fans belong in Electronics' },
      owner.token,
    );
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.category, 'electronics');
  });

  test('staff mark a parcel delivered when the courier confirms it', async () => {
    const o = (await order()).body;
    const url = `/api/admin/orders/${o.id}/shipments/${seller.shopId}/status`;
    assert.equal((await api('PATCH', url, { status: 'delivered', note: 'Courier confirmed' }, owner.token)).status, 409, 'must be sent first');
    await api('PATCH', url, { status: 'dispatched', note: 'Shop phoned in' }, owner.token);
    const done = await api('PATCH', url, { status: 'delivered', note: 'Platinum confirmed delivery' }, owner.token);
    assert.equal(done.status, 200);
    assert.equal(done.body.shipments[0].status, 'delivered');
    assert.match((await notificationsOf(buyer.token))[0].title, /Delivered/);
    assert.equal((await api('PATCH', url, { status: 'delivered', note: 'x' }, seller.token)).status, 403);
  });
});

describe('deleting accounts', () => {
  test('an owner deletes a customer account: open parcels are cancelled and the person is gone', async () => {
    const spammer = await signIn('0966777888', { name: 'Fake Buyer' });
    const placed = await api(
      'POST',
      '/api/orders',
      { items: [{ productId: fanId, qty: 1 }], shipping: { ...shipping, name: 'Fake Buyer' }, couriers: { [seller.shopId]: 'pickup' }, payment: 'cod' },
      spammer.token,
    );
    assert.equal(placed.status, 201, JSON.stringify(placed.body));

    assert.equal((await api('POST', `/api/admin/users/${spammer.user.id}/delete`, { reason: '' }, owner.token)).status, 400);
    const res = await api('POST', `/api/admin/users/${spammer.user.id}/delete`, { reason: 'Fake orders' }, owner.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.cancelled, 1);

    assert.equal((await api('GET', '/api/session/me', undefined, spammer.token)).status, 401);
    const [o] = await db.query('SELECT buyer_name, buyer_phone FROM orders WHERE id = $1', [placed.body.id]);
    assert.deepEqual(o, { buyer_name: 'Deleted user', buyer_phone: '' });
    const [s] = await db.query('SELECT status FROM shipments WHERE order_id = $1', [placed.body.id]);
    assert.equal(s.status, 'cancelled');
    const users = (await api('GET', '/api/admin/users?q=Fake', undefined, owner.token)).body;
    assert.equal(users.length, 0);
    const [logged] = await db.query(`SELECT note FROM admin_actions WHERE action = 'user deleted' AND target_id = $1`, [
      spammer.user.id,
    ]);
    assert.equal(logged.note, 'Fake Buyer: Fake orders');
  });

  test('staff, shop owners, owners and yourself cannot be deleted this way', async () => {
    await api('POST', '/api/admin/staff', { phone: '0955246810', name: 'Bwalya' }, owner.token);
    const staff = await signIn('0955246810');
    const someone = await signIn('0966135790', { name: 'Mwila' });

    assert.equal((await api('POST', `/api/admin/users/${someone.user.id}/delete`, { reason: 'Test' }, staff.token)).status, 403);
    assert.equal((await api('POST', `/api/admin/users/${staff.user.id}/delete`, { reason: 'Test' }, owner.token)).status, 403);
    const shopOwner = await api('POST', `/api/admin/users/${seller.user.id}/delete`, { reason: 'Test' }, owner.token);
    assert.equal(shopOwner.status, 409);
    assert.match(shopOwner.body.error, /Delete the shop under Shops first/);
    assert.equal((await api('POST', `/api/admin/users/${owner.user.id}/delete`, { reason: 'Test' }, owner.token)).status, 400);
    assert.equal((await api('GET', '/api/session/me', undefined, someone.token)).status, 200);
  });
});
