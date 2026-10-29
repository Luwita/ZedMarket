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
const order = (extra = {}, token = buyer.token) =>
  api(
    'POST',
    '/api/orders',
    { items: [{ productId: fanId, qty: 1 }], shipping, couriers: { [seller.shopId]: 'pickup' }, payment: 'momo', ...extra },
    token
  );
const notificationsOf = async (token) => (await api('GET', '/api/notifications', undefined, token)).body;

before(async () => {
  db = await createDb({ url: '', dataDir: '' });
  await migrate(db);
  await seedIfEmpty(db);
  uploadDir = await mkdtemp(path.join(tmpdir(), 'zed-market-features-'));
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
    seller.token
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

describe('delivery choices', () => {
  test("buyers can't choose a courier the shop doesn't offer", async () => {
    const res = await order({ couriers: { [seller.shopId]: 'yango' } });
    assert.equal(res.status, 409, 'Yango is not one of this shop’s options');
  });

  test('Zed Market Points are off until staff switch them on', async () => {
    const off = await order({ couriers: { [seller.shopId]: 'point' }, pickupPoint: 'lsk-cairo' });
    assert.equal(off.status, 409);
  });

  test('Zed Market Points: any shop can send to a collection point in the buyer’s town', async () => {
    await enablePoints();
    const noPoint = await order({ couriers: { [seller.shopId]: 'point' } });
    assert.equal(noPoint.status, 409);
    assert.match(noPoint.body.error, /Zed Market Point in Lusaka/);
    const wrongTown = await order({ couriers: { [seller.shopId]: 'point' }, pickupPoint: 'kitwe' });
    assert.equal(wrongTown.status, 409);

    const ok = await order({ couriers: { [seller.shopId]: 'point' }, pickupPoint: 'lsk-cairo' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.delivery, 20);
    assert.match(ok.body.shipments[0].pickupPoint, /Cairo Road/);

    const mongu = await order({
      couriers: { [seller.shopId]: 'point' },
      pickupPoint: 'mongu',
      shipping: { ...shipping, province: 'western', town: 'Mongu' },
    });
    assert.equal(mongu.status, 201, JSON.stringify(mongu.body));
    assert.equal(mongu.body.delivery, 90);
  });
});

// Zed Market Points are off until staff switch them on; these tests are about how they work once on.
const enablePoints = () =>
  db.query(
    `INSERT INTO delivery_config (key, value) VALUES ('couriers', '{"point": {"disabled": false}}')
     ON CONFLICT (key) DO UPDATE SET value = delivery_config.value || EXCLUDED.value`,
  );

describe('notifications', () => {
  test('new orders reach the shop; dispatch reaches the buyer; counts and read state work', async () => {
    const placed = (await order()).body;
    const shopNotes = await notificationsOf(seller.token);
    assert.ok(shopNotes.some((n) => n.title === `New order ${placed.id}`));

    await api('PATCH', `/api/orders/${placed.id}/shipments/${seller.shopId}`, { status: 'dispatched' }, seller.token);
    const buyerNotes = await notificationsOf(buyer.token);
    assert.match(buyerNotes[0].title, /Ready to collect at Mutinta Appliances/);

    const counts = (await api('GET', '/api/notifications/counts', undefined, buyer.token)).body;
    assert.ok(counts.notifications >= 1);
    await api('POST', '/api/notifications/read', {}, buyer.token);
    assert.equal((await api('GET', '/api/notifications/counts', undefined, buyer.token)).body.notifications, 0);
    assert.ok((await api('GET', '/api/notifications/counts', undefined, seller.token)).body.toDispatch >= 1);
  });

  test('shop approval is announced to the owner', async () => {
    const notes = await notificationsOf(seller.token);
    assert.ok(notes.some((n) => /approved and live/.test(n.title)));
  });
});

describe('customer support', () => {
  test('a customer asks, staff reply, the customer is notified', async () => {
    const created = await api('POST', '/api/support', { subject: 'Where is my order?', body: 'It has been 5 days' }, buyer.token);
    assert.equal(created.status, 201);
    assert.equal((await api('GET', '/api/admin/support', undefined, buyer.token)).status, 403);

    const queue = (await api('GET', '/api/admin/support', undefined, admin.token)).body;
    assert.equal(queue[0].subject, 'Where is my order?');
    assert.equal(queue[0].unread, 1);
    await api('POST', `/api/admin/support/${created.body.id}/messages`, { body: 'It arrives tomorrow.' }, admin.token);

    const thread = (await api('GET', `/api/support/${created.body.id}`, undefined, buyer.token)).body;
    assert.deepEqual(
      thread.messages.map((m) => m.fromStaff),
      [false, true]
    );
    assert.ok((await notificationsOf(buyer.token)).some((n) => n.title === 'Zed Market support replied'));
    const other = await signIn('0955100100');
    assert.equal((await api('GET', `/api/support/${created.body.id}`, undefined, other.token)).status, 404);
  });
});

describe('buying requests', () => {
  test('buyers post, approved shops offer, the buyer accepts', async () => {
    const posted = await api(
      'POST',
      '/api/buying-requests',
      { title: '200 bags of cement', qty: 200, unit: 'bags', budget: 150, province: 'northern', town: 'Kasama' },
      buyer.token
    );
    assert.equal(posted.status, 201, JSON.stringify(posted.body));
    const id = posted.body.id;
    assert.ok((await api('GET', '/api/buying-requests')).body.some((r) => r.id === id));

    // A shop still waiting for approval can't offer.
    const newOwner = await signIn('0977200200');
    await api(
      'POST',
      '/api/shops',
      { name: 'New Shop', ownerFullName: 'New Owner', nrc: '111111/11/1', phone: '0977200200', province: 'lusaka', town: 'Lusaka', area: 'Kamwala', momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'bus'] },
      newOwner.token
    );
    assert.equal((await api('POST', `/api/buying-requests/${id}/offers`, { price: 140 }, newOwner.token)).status, 403);
    assert.equal((await api('POST', `/api/buying-requests/${id}/offers`, { price: 140 }, buyer.token)).status, 403);

    const offered = await api('POST', `/api/buying-requests/${id}/offers`, { price: 145, note: 'Delivered by bus' }, seller.token);
    assert.equal(offered.status, 201, JSON.stringify(offered.body));
    assert.ok((await notificationsOf(buyer.token)).some((n) => n.title === 'New offer from Mutinta Appliances'));

    const forBuyer = (await api('GET', `/api/buying-requests/${id}`, undefined, buyer.token)).body;
    assert.equal(forBuyer.offers.length, 1);
    assert.equal((await api('GET', `/api/buying-requests/${id}`)).body.offers.length, 0, 'offers are private');

    await api('PATCH', `/api/buying-requests/${id}/offers/${forBuyer.offers[0].id}/accept`, undefined, buyer.token);
    assert.equal((await api('GET', `/api/buying-requests/${id}`)).body.status, 'closed');
    assert.ok((await notificationsOf(seller.token)).some((n) => n.title === 'Your offer was accepted'));
  });
});

describe('invite codes and vouchers', () => {
  let friend;

  test('a friend who signs up with an invite code gets a welcome voucher', async () => {
    const { code } = (await api('GET', '/api/me/referral', undefined, buyer.token)).body;
    assert.match(code, /^CHIPO[0-9A-F]{3}$/);
    friend = await signIn('0966300300', { name: 'Mapalo', referralCode: code.toLowerCase() });
    const vouchers = (await api('GET', '/api/me/vouchers', undefined, friend.token)).body;
    assert.equal(vouchers.length, 1);
    assert.equal(vouchers[0].amount, 50);
    assert.equal((await api('GET', '/api/me/referral', undefined, buyer.token)).body.invited, 1);
  });

  test('vouchers: minimum spend, split across shops, once only, back on full cancellation', async () => {
    const [voucher] = (await api('GET', '/api/me/vouchers', undefined, friend.token)).body;
    const kettle = (await api('POST', '/api/products', { name: 'Kettle', category: 'home', price: 100, stock: 9 }, seller.token)).body;
    const tooSmall = await order({ items: [{ productId: kettle.id, qty: 1 }], voucherId: voucher.id }, friend.token);
    assert.equal(tooSmall.status, 409);
    assert.match(tooSmall.body.error, /at least K300/);

    // Fan (K500, this shop) + 200W panel (K1,850, Lusaka Solar Centre), both collected.
    const twoShops = {
      items: [
        { productId: fanId, qty: 1 },
        { productId: 'p10', qty: 1 },
      ],
      couriers: { [seller.shopId]: 'pickup', s2: 'pickup' },
      shipping: { ...shipping, name: 'Mapalo', phone: '0966300300' },
      voucherId: voucher.id,
    };
    const placed = await order(twoShops, friend.token);
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.voucherDiscount, 50);
    assert.equal(placed.body.total, 2350 - 50);
    const parts = Object.fromEntries(placed.body.shipments.map((s) => [s.shopId, s.voucherDiscount]));
    assert.equal(parts[seller.shopId] + parts.s2, 50);
    assert.equal(parts[seller.shopId], 10.64); // 50 × 500 / 2350

    const again = await order(twoShops, friend.token);
    assert.equal(again.status, 409, 'a voucher works once');

    const fanCancel = await api('POST', `/api/orders/${placed.body.id}/shipments/${seller.shopId}/cancel`, { reason: 'Changed my mind' }, friend.token);
    assert.equal(fanCancel.body.refund, 500 - 10.64, 'the voucher part was paid by Zed Market, not the buyer');
    assert.equal((await api('GET', '/api/me/vouchers', undefined, friend.token)).body[0].usable, false, 'one parcel still on');
    await api('POST', `/api/orders/${placed.body.id}/shipments/s2/cancel`, { reason: 'Changed my mind' }, friend.token);
    assert.equal((await api('GET', '/api/me/vouchers', undefined, friend.token)).body[0].usable, true, 'whole order cancelled');
  });

  test('the inviter is rewarded once, when the friend’s first order is delivered', async () => {
    const first = (await order({ shipping: { ...shipping, name: 'Mapalo', phone: '0966300300' } }, friend.token)).body;
    const deliver = async (o) => {
      await api('PATCH', `/api/orders/${o.id}/shipments/${seller.shopId}`, { status: 'dispatched' }, seller.token);
      await api('PATCH', `/api/orders/${o.id}/shipments/${seller.shopId}`, { status: 'delivered' }, seller.token);
    };
    const rewards = async () =>
      (await api('GET', '/api/me/vouchers', undefined, buyer.token)).body.filter((v) => v.reason === 'referral');
    assert.equal((await rewards()).length, 0, 'nothing until delivery');
    await deliver(first);
    assert.equal((await rewards()).length, 1);
    assert.ok((await notificationsOf(buyer.token)).some((n) => n.title === 'You earned K50!'));
    await deliver((await order({ shipping: { ...shipping, name: 'Mapalo', phone: '0966300300' } }, friend.token)).body);
    assert.equal((await rewards()).length, 1, 'only once per friend');
  });

  test('an unknown invite code just signs up normally', async () => {
    const someone = await signIn('0966400400', { name: 'Bupe', referralCode: 'NOTREAL' });
    assert.equal((await api('GET', '/api/me/vouchers', undefined, someone.token)).body.length, 0);
  });
});

describe('resell and shop pages', () => {
  test('a shop can copy another listing into its own shop, keeping the source', async () => {
    const copy = await api(
      'POST',
      '/api/products',
      { name: '200W Solar Panel', category: 'solar', price: 1990, stock: 0, weightKg: 12, sourceProductId: 'p10' },
      seller.token
    );
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    assert.equal(copy.body.sourceProductId, 'p10');
  });

  test('shops can add a banner, an about text and opening hours', async () => {
    const [shop] = (await api('GET', '/api/shops', undefined, seller.token)).body.filter((s) => s.id === seller.shopId);
    const updated = await api(
      'PATCH',
      `/api/shops/${seller.shopId}`,
      { ...shop, about: 'Fans and fridges since 2015.', openingHours: 'Mon–Sat 08:00–18:00', banner: '/uploads/img_banner.jpg' },
      seller.token
    );
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.about, 'Fans and fridges since 2015.');
    assert.equal(updated.body.openingHours, 'Mon–Sat 08:00–18:00');
    assert.equal(updated.body.banner, '/uploads/img_banner.jpg');
    const bad = await api('PATCH', `/api/shops/${seller.shopId}`, { ...shop, banner: 'https://evil.example/x.jpg' }, seller.token);
    assert.equal(bad.status, 400, 'only uploaded images');
  });
});

describe('every category works end to end', () => {
  test('a product in each category can be listed, found by category and ordered', async () => {
    const { categories } = await import('../src/data/catalog.js');
    assert.ok(categories.length >= 21);
    for (const c of categories) {
      const made = await api(
        'POST',
        '/api/products',
        { name: `Test item for ${c.id}`, category: c.id, price: 120, stock: 5, weightKg: 1 },
        seller.token
      );
      assert.equal(made.status, 201, `${c.id}: ${JSON.stringify(made.body)}`);
      assert.equal(made.body.category, c.id);
      assert.equal(made.body.icon, c.icon, `${c.id} uses its category icon`);
      const found = await api('GET', `/api/products?cat=${c.id}`);
      assert.ok(
        found.body.items.some((p) => p.id === made.body.id),
        `${c.id} shows when filtering by that category`
      );
      assert.ok(found.body.items.every((p) => p.category === c.id), `${c.id} filter only returns its own products`);
      const bought = await api(
        'POST',
        '/api/orders',
        { items: [{ productId: made.body.id, qty: 1 }], shipping, couriers: { [seller.shopId]: 'pickup' }, payment: 'momo' },
        buyer.token
      );
      assert.equal(bought.status, 201, `${c.id} can be ordered: ${JSON.stringify(bought.body)}`);
      const request = await api(
        'POST',
        '/api/buying-requests',
        { title: `Need ${c.id}`, description: 'Looking for a good supplier', category: c.id, qty: 2, unit: 'pcs', province: 'lusaka', town: 'Lusaka' },
        buyer.token
      );
      assert.equal(request.status, 201, `${c.id} buying request: ${JSON.stringify(request.body)}`);
    }
  });

  test('an unknown category is still refused', async () => {
    const bad = await api('POST', '/api/products', { name: 'Nope', category: 'weapons', price: 10, stock: 1 }, seller.token);
    assert.equal(bad.status, 400);
  });
});
