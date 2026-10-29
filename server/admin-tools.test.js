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
const ADMIN_PHONE = '0950000009';

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

// Signs in through the stand-in for Clerk (see testing/auth.js).
async function signIn(phone, extra = {}) {
  return testSignIn(api, phone, extra);
}

let admin;
let seller;
let buyer;
let fanId;
const shipping = { name: 'Chipo', phone: '0966100100', province: 'lusaka', town: 'Lusaka', address: 'Plot 3' };
const order = (payment = 'momo') =>
  api(
    'POST',
    '/api/orders',
    { items: [{ productId: fanId, qty: 1 }], shipping, couriers: { [seller.shopId]: 'pickup' }, payment },
    buyer.token,
  );
const deliver = async (orderId) => {
  await api('PATCH', `/api/orders/${orderId}/shipments/${seller.shopId}`, { status: 'dispatched' }, seller.token);
  await api('POST', `/api/orders/${orderId}/shipments/${seller.shopId}/received`, undefined, buyer.token);
};
// Pretend the parcel was delivered long enough ago for the return window to have passed.
const clearReturnWindow = (orderId) =>
  db.query(`UPDATE shipments SET delivered_at = now() - interval '8 days' WHERE order_id = $1`, [orderId]);
const notificationsOf = async (token) => (await api('GET', '/api/notifications', undefined, token)).body;

before(async () => {
  db = await createDb({ url: '', dataDir: '' });
  await migrate(db);
  await seedIfEmpty(db);
  uploadDir = await mkdtemp(path.join(tmpdir(), 'zed-market-admin-tools-'));
  server = createApp(db, { auth: testAuth,
    uploadDir,
    sms: { send: async (phone, message) => sent.push({ phone, message }) },
    adminPhones: [ADMIN_PHONE],
  }).listen(0);
  base = `http://localhost:${server.address().port}`;

  admin = await signIn(ADMIN_PHONE, { name: 'Staff' });
  seller = await signIn('0977100100', { name: 'Mutinta' });
  const shop = await api(
    'POST',
    '/api/shops',
    {
      name: 'Mutinta Appliances',
      ownerFullName: 'Mutinta Hamoonga',
      nrc: '123456/78/1',
      phone: '0977100100',
      province: 'lusaka',
      town: 'Lusaka',
      area: 'Cairo Road',
      momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'seller'],
    },
    seller.token,
  );
  seller.shopId = shop.body.id;
  await api('PATCH', `/api/admin/shops/${seller.shopId}/verification`, { status: 'verified' }, admin.token);
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

describe('admin tools', () => {
  test('only staff can use them', async () => {
    for (const url of ['/api/admin/analytics', '/api/admin/payouts', '/api/admin/banners', '/api/admin/campaigns']) {
      assert.equal((await api('GET', url, undefined, buyer.token)).status, 403, url);
    }
  });

  test('payouts: money is held through the return window, then paid out once', async () => {
    const balance = async () => (await api('GET', '/api/seller/payouts', undefined, seller.token)).body;
    // An older order paid to Zed Market (before buyers paid shops directly) still earns the shop a payout.
    const paid = (await order('momo')).body;
    await db.query(`UPDATE orders SET payment_status = 'paid' WHERE id = $1`, [paid.id]);
    await deliver(paid.id);
    let b = await balance();
    assert.equal(b.onHold, 475, 'K500 − 5% commission, waiting for the return window');
    assert.equal(b.available, 0);

    await clearReturnWindow(paid.id);
    b = await balance();
    assert.equal(b.available, 475);

    // Cash on delivery: the shop already has the cash, so it owes the K25 commission.
    const cod = (await order('cod')).body;
    await deliver(cod.id);
    await clearReturnWindow(cod.id);
    b = await balance();
    assert.equal(b.available, 450);

    // The monthly statement uses the same rule, so it agrees with the balance.
    const month = new Date(Date.now() + 2 * 3600e3 - 8 * 864e5).toISOString().slice(0, 7);
    const statement = (await api('GET', `/api/seller/statement?month=${month}`, undefined, seller.token)).body;
    const codLine = statement.lines.find((l) => l.orderId === cod.id);
    assert.equal(codLine.cashOnDelivery, true);
    assert.equal(codLine.cashCollected, 500);
    assert.equal(codLine.payout, -25, 'commission owed on cash the shop already collected');
    assert.equal(statement.lines.find((l) => l.orderId === paid.id).payout, 475);
    assert.equal(statement.totals.payout, 450);
    assert.equal(statement.totals.cashCollected, 500);

    const pay = (amount) =>
      api('POST', '/api/admin/payouts', { shopId: seller.shopId, amount, method: 'mtn', reference: 'MP2610.1234' }, admin.token);
    assert.equal((await pay(451)).status, 409, 'cannot pay more than is available');
    assert.equal((await pay(400)).status, 201);
    b = await balance();
    assert.equal(b.available, 50);
    assert.equal(b.paidOut, 400);
    assert.equal(b.history[0].reference, 'MP2610.1234');
    assert.match((await notificationsOf(seller.token))[0].title, /Zed Market paid you K400/);

    const list = (await api('GET', '/api/admin/payouts', undefined, admin.token)).body;
    assert.equal(list.find((s) => s.shopId === seller.shopId).available, 50);
  });

  test('analytics add up sales, commission and where they come from', async () => {
    const a = (await api('GET', '/api/admin/analytics?days=30', undefined, admin.token)).body;
    assert.equal(a.orders, 2);
    assert.equal(a.gmv, 1000);
    assert.equal(a.commission, 50);
    assert.equal(a.daily.length, 30);
    assert.equal(a.daily.at(-1).orders, 2);
    assert.equal(a.provinces[0].key, 'lusaka');
    assert.equal(a.shops[0].name, 'Mutinta Appliances');
    assert.equal(a.categories[0].key, 'home');
    assert.deepEqual(a.payments.map((p) => p.key).sort(), ['Mobile Money', 'Pay on Delivery']);
  });

  test('home page banners: staff create and hide them; links stay on Zed Market', async () => {
    const banner = { title: 'Back to school', text: 'Bags, shoes and uniforms', link: '/shop?cat=fashion', theme: 'green' };
    assert.equal((await api('POST', '/api/admin/banners', { ...banner, link: 'https://evil.example' }, admin.token)).status, 400);
    const created = await api('POST', '/api/admin/banners', banner, admin.token);
    assert.equal(created.status, 201);
    assert.equal((await api('GET', '/api/banners')).body[0].title, 'Back to school');

    await api('PATCH', `/api/admin/banners/${created.body.id}`, { active: false }, admin.token);
    assert.equal((await api('GET', '/api/banners')).body.length, 0);
    assert.equal((await api('DELETE', `/api/admin/banners/${created.body.id}`, undefined, admin.token)).status, 200);
  });

  test('voucher campaigns reach the chosen customers and work at checkout', async () => {
    const lusaka = await api(
      'POST',
      '/api/admin/campaigns',
      { name: 'Lusaka week', amount: 30, minSpend: 200, days: 14, audience: 'province', province: 'lusaka' },
      admin.token,
    );
    assert.equal(lusaka.status, 201);
    assert.equal(lusaka.body.issued, 2, 'the Lusaka buyer and the Lusaka shop owner');

    const [voucher] = (await api('GET', '/api/me/vouchers', undefined, buyer.token)).body.filter((v) => v.reason === 'campaign');
    assert.equal(voucher.note, 'Lusaka week');
    assert.match((await notificationsOf(buyer.token))[0].title, /K30 voucher: Lusaka week/);

    const quote = await api(
      'POST',
      '/api/orders/quote',
      { items: [{ productId: fanId, qty: 1 }], shipping, couriers: { [seller.shopId]: 'pickup' }, payment: 'momo', voucherId: voucher.id },
      buyer.token,
    );
    assert.equal(quote.body.total, 470);

    const one = await api('POST', '/api/admin/campaigns', { name: 'Sorry gift', amount: 20, audience: 'phone', phone: '096 610 0100' }, admin.token);
    assert.equal(one.body.issued, 1);
    const nobody = await api('POST', '/api/admin/campaigns', { name: 'Nobody', amount: 20, audience: 'phone', phone: '0961234567' }, admin.token);
    assert.equal(nobody.status, 404);

    const campaigns = (await api('GET', '/api/admin/campaigns', undefined, admin.token)).body;
    assert.deepEqual(
      campaigns.map((c) => [c.name, c.issued]),
      [
        ['Sorry gift', 1],
        ['Lusaka week', 2],
      ],
      'the failed campaign was not saved',
    );
  });

  test('announcements go to the chosen group only', async () => {
    const res = await api(
      'POST',
      '/api/admin/announcements',
      { title: 'New: sell in bulk with CSV', body: 'Upload many products at once', link: '/seller?tab=bulk', audience: 'sellers' },
      admin.token,
    );
    assert.equal(res.body.sent, 1);
    assert.equal((await notificationsOf(seller.token))[0].title, 'New: sell in bulk with CSV');
    assert.notEqual((await notificationsOf(buyer.token))[0]?.title, 'New: sell in bulk with CSV');
  });

  test('staff can take down a buying request', async () => {
    const posted = await api(
      'POST',
      '/api/buying-requests',
      { title: 'Cheap phones, WhatsApp me', qty: 5, province: 'lusaka', town: 'Lusaka' },
      buyer.token,
    );
    const id = posted.body.id;
    assert.equal((await api('POST', `/api/admin/requests/${id}/remove`, { reason: '' }, admin.token)).status, 400);
    assert.equal((await api('POST', `/api/admin/requests/${id}/remove`, { reason: 'Contact details in the title' }, admin.token)).status, 200);

    assert.ok(!(await api('GET', '/api/buying-requests')).body.some((r) => r.id === id));
    assert.equal((await api('GET', `/api/buying-requests/${id}`, undefined, seller.token)).status, 404);
    const own = (await api('GET', `/api/buying-requests/${id}`, undefined, buyer.token)).body;
    assert.equal(own.status, 'removed');
    assert.equal(own.removedReason, 'Contact details in the title');
    const removed = (await api('GET', '/api/admin/requests?status=removed', undefined, admin.token)).body;
    assert.deepEqual(removed.map((r) => r.id), [id]);
  });
});
