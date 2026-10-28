import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { testAuth, testSignIn } from './testing/auth.js';
import { createDb, migrate } from './db.js';

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

// Signs in through the stand-in for Clerk (see testing/auth.js).
async function signIn(phone, extra = {}) {
  return testSignIn(api, phone, extra);
}

let owner;
let staff;
let seller;
let buyer;
let fanId;
const lusaka = { name: 'Chipo', phone: '0966100100', province: 'lusaka', town: 'Lusaka', address: 'Plot 3' };
const kitwe = { ...lusaka, province: 'copperbelt', town: 'Kitwe' };
const quote = (courier, shipping = lusaka, extra = {}) =>
  api(
    'POST',
    '/api/orders/quote',
    { items: [{ productId: fanId, qty: 1 }], shipping, couriers: { [seller.shopId]: courier }, payment: 'momo', ...extra },
    buyer.token,
  );
const platinum = {
  description: 'Door-to-door parcels between towns and provinces.',
  rates: { town: 70, province: 110, national: 180 },
  perKg: { town: 4, province: 6, national: 9 },
  maxKg: 80,
  eta: { town: 'Same day', province: 'Next day', national: '2 days' },
  cod: true,
};

before(async () => {
  db = await createDb({ url: '', dataDir: '' });
  await migrate(db); // no demo data: the marketplace starts empty
  uploadDir = await mkdtemp(path.join(tmpdir(), 'zed-market-delivery-'));
  server = createApp(db, { auth: testAuth,
    uploadDir,
    sms: { send: async (phone, message) => sent.push({ phone, message }) },
    adminPhones: [OWNER_PHONE],
  }).listen(0);
  base = `http://localhost:${server.address().port}`;

  owner = await signIn(OWNER_PHONE, { name: 'Noah' });
  await api('POST', '/api/admin/staff', { email: '955123456@example.test', name: 'Mapalo' }, owner.token);
  staff = await signIn('0955123456');
  seller = await signIn('0977100100', { name: 'Mutinta' });
  seller.shopId = (
    await api(
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
        momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'platinum', 'zampost'],
      },
      seller.token,
    )
  ).body.id;
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

// Zed Market Points are off until staff switch them on; these tests are about how they work once on.
const enablePoints = () =>
  db.query(
    `INSERT INTO delivery_config (key, value) VALUES ('couriers', '{"point": {"disabled": false}}')
     ON CONFLICT (key) DO UPDATE SET value = delivery_config.value || EXCLUDED.value`,
  );

describe('delivery settings', () => {
  test('until staff save real rates, the starting values are marked as not confirmed', async () => {
    const d = (await api('GET', '/api/delivery')).body;
    assert.equal(d.couriers.platinum.confirmed, false);
    assert.equal(d.couriers.platinum.rates.town, 30);
    assert.equal(d.pointsConfirmed, false);
    assert.ok(d.points.every((p) => p.example));
  });

  test('owners set courier rates; new orders use them and old orders keep their fee', async () => {
    const placed = await api(
      'POST',
      '/api/orders',
      { items: [{ productId: fanId, qty: 1 }], shipping: lusaka, couriers: { [seller.shopId]: 'platinum' }, payment: 'momo' },
      buyer.token,
    );
    assert.equal(placed.body.delivery, 30);

    assert.equal((await api('PUT', '/api/admin/delivery/couriers/platinum', platinum, staff.token)).status, 403);
    assert.equal((await api('PUT', '/api/admin/delivery/couriers/platinum', platinum, buyer.token)).status, 403);
    const saved = await api('PUT', '/api/admin/delivery/couriers/platinum', platinum, owner.token);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.couriers.platinum.confirmed, true);

    assert.equal((await quote('platinum')).body.delivery, 70);
    assert.equal((await quote('platinum', kitwe)).body.delivery, 180);
    const [old] = (await api('GET', '/api/orders/mine', undefined, buyer.token)).body;
    assert.equal(old.delivery, 30, 'past orders keep the fee they were charged');

    const log = (await api('GET', '/api/admin/actions', undefined, owner.token)).body;
    assert.ok(log.some((a) => a.action === 'courier rates saved' && /town K70/.test(a.note)));
  });

  test('a blank fee means the courier does not cover that distance; switched-off couriers are not offered', async () => {
    await api('PUT', '/api/admin/delivery/couriers/platinum', { ...platinum, rates: { ...platinum.rates, national: null } }, owner.token);
    assert.equal((await quote('platinum', kitwe)).status, 409);

    await api('PUT', '/api/admin/delivery/couriers/zampost', {
      description: 'National postal courier.',
      rates: { town: 50, province: 75, national: 120 },
      perKg: {},
      maxKg: 30,
      eta: { town: '1–2 days' },
      cod: false,
      disabled: true,
    }, owner.token);
    const res = await quote('zampost');
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Zampost|deliver/);
  });

  test('rates are checked', async () => {
    assert.equal((await api('PUT', '/api/admin/delivery/couriers/platinum', { ...platinum, rates: { town: -5 } }, owner.token)).status, 400);
    assert.equal((await api('PUT', '/api/admin/delivery/couriers/nope', platinum, owner.token)).status, 404);
    assert.equal(
      (await api('PUT', '/api/admin/delivery/couriers/yango', { ...platinum, towns: ['Atlantis'] }, owner.token)).status,
      400,
    );
  });

  test('owners replace the example Zed Market Points with real ones', async () => {
    await enablePoints();
    const point = {
      id: 'kitwe-chisokone',
      province: 'copperbelt',
      town: 'Kitwe',
      name: 'Zed Market Point Chisokone',
      address: 'Shop 4, Chisokone Market',
      hours: 'Mon–Sat 08:00–17:00',
    };
    assert.equal((await api('PUT', '/api/admin/delivery/points', { points: [{ ...point, town: 'Lusaka' }] }, owner.token)).status, 400);
    assert.equal((await api('PUT', '/api/admin/delivery/points', { points: [point, point] }, owner.token)).status, 400);
    assert.equal((await api('PUT', '/api/admin/delivery/points', { points: [point] }, staff.token)).status, 403);
    const saved = await api('PUT', '/api/admin/delivery/points', { points: [point, { ...point, id: 'kitwe-closed', active: false }] }, owner.token);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.pointsConfirmed, true);

    // Lusaka no longer has a point (the examples are gone); Kitwe has the new one.
    assert.equal((await quote('point', lusaka, { pickupPoint: 'lsk-cairo' })).status, 409);
    const ok = await quote('point', kitwe, { pickupPoint: 'kitwe-chisokone' });
    assert.equal(ok.status, 200);
    assert.match(ok.body.shipments[0].pickupPoint, /Chisokone Market/);
    assert.equal((await quote('point', kitwe, { pickupPoint: 'kitwe-closed' })).status, 409, 'closed points cannot be used');
  });
});

describe('collecting from the courier office', () => {
  test('a parcel sent with Platinum tells the buyer to collect it at the Platinum office in their town', async () => {
    const placed = await api(
      'POST',
      '/api/orders',
      { items: [{ productId: fanId, qty: 1 }], shipping: lusaka, couriers: { [seller.shopId]: 'platinum' }, payment: 'momo' },
      buyer.token,
    );
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const url = `/api/orders/${placed.body.id}/shipments/${seller.shopId}`;
    assert.equal((await api('PATCH', url, { status: 'dispatched', tracking: 'PC123' }, seller.token)).status, 200);
    const [note] = (await api('GET', '/api/notifications', undefined, buyer.token)).body;
    assert.equal(note.title, 'On its way to the Platinum Couriers office in Lusaka');
    assert.match(note.body, /tracking PC123 · Collect it with order number ZM-\w+ and your ID/);
  });
});

describe('Yango priced by distance', () => {
  test('the shop and buyer map positions set the fare, and the buyer position is kept for the rider', async () => {
    const shop = (await api('GET', `/api/shops/${seller.shopId}`, undefined, seller.token)).body;
    const patch = await api(
      'PATCH',
      `/api/shops/${seller.shopId}`,
      { ...shop, couriers: [...shop.couriers, 'yango'], lat: -15.4167, lng: 28.2833, ownRates: null },
      seller.token,
    );
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    assert.equal(patch.body.lat, -15.4167);
    assert.equal(
      (await api('PATCH', `/api/shops/${seller.shopId}`, { ...shop, lat: 51.5, lng: -0.1 }, seller.token)).status,
      400,
      'positions outside Zambia are refused',
    );

    const estimate = await quote('yango');
    assert.equal(estimate.body.delivery, 45, 'no buyer position: a typical 8 km trip');
    const placed = await api(
      'POST',
      '/api/orders',
      {
        items: [{ productId: fanId, qty: 1 }],
        shipping: { ...lusaka, lat: -15.4467, lng: 28.2833 },
        couriers: { [seller.shopId]: 'yango' },
        payment: 'momo',
      },
      buyer.token,
    );
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.delivery, 27, '4.3 km by road');
    assert.deepEqual([placed.body.shipping.lat, placed.body.shipping.lng], [-15.4467, 28.2833]);
  });

  test('owners change the per-km fares', async () => {
    const body = {
      description: 'Yango to your door.',
      rates: {},
      perKg: {},
      maxKg: 20,
      eta: { town: '1–3 hours' },
      towns: ['Lusaka'],
      cod: true,
      distance: { moto: { minFare: 12, includedKm: 1, perKm: 5 }, car: { minFare: 20, includedKm: 1.5, perKm: 5, perMin: 1 }, motoMaxKg: 10, typicalKm: 8 },
    };
    const { distance, ...withoutFares } = body;
    assert.equal((await api('PUT', '/api/admin/delivery/couriers/yango', withoutFares, owner.token)).status, 400);
    assert.equal((await api('PUT', '/api/admin/delivery/couriers/yango', body, owner.token)).status, 200);
    assert.equal((await quote('yango')).body.delivery, 12 + 7 * 5);
  });
});
