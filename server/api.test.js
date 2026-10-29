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

before(async () => {
  db = await createDb({ url: '', dataDir: '' }); // in-memory PGlite
  await migrate(db);
  await seedIfEmpty(db);
  uploadDir = await mkdtemp(path.join(tmpdir(), 'zed-market-uploads-'));
  const sms = { send: async (phone, message) => sent.push({ phone, message }) };
  server = createApp(db, { auth: testAuth, uploadDir, sms }).listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
  await rm(uploadDir, { recursive: true, force: true });
});

async function api(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = { status: res.status, body: await res.json() };
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

const shopBody = {
  ownerFullName: 'Mwansa Banda',
  nrc: '123456/78/1',
  name: 'Mwansa Hardware',
  phone: '0977 123 456',
  province: 'copperbelt',
  town: 'Kitwe',
  area: 'Chisokone Market',
  momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'yango', 'bus'],
};

describe('sign-in', () => {
  test('a sign-in token that is missing, made up or tampered with gets nobody', async () => {
    assert.equal((await api('GET', '/api/session/me')).status, 401);
    assert.equal((await api('GET', '/api/session/me', undefined, 'not-a-token')).status, 401);
    assert.equal((await api('GET', '/api/session/me', undefined, 'test:12345')).status, 401);
  });

  test('the first sign-in creates the ZedMarket account, with the verified phone; later ones find it', async () => {
    const first = await signIn('0971 000 003', { name: 'Chanda', accountType: 'buyer' });
    assert.equal(first.status, 200);
    assert.equal(first.user.phone, '0971000003');
    assert.equal(first.user.email, '971000003@example.test');
    const second = await signIn('+260971000003');
    assert.equal(second.user.id, first.user.id);
    assert.equal(second.user.name, 'Chanda');
  });

  test('protected routes need a session', async () => {
    assert.equal((await api('GET', '/api/session/me')).status, 401);
    assert.equal((await api('POST', '/api/orders', {})).status, 401);
  });
});

describe('shops, products and orders', () => {
  let seller;
  let buyer;
  let productId;

  test('a seller opens a shop and lists a product', async () => {
    seller = await signIn('0977123456', { name: 'Mwansa', accountType: 'seller' });
    const created = await api('POST', '/api/shops', shopBody, seller.token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const me = await api('GET', '/api/session/me', undefined, seller.token);
    assert.equal(me.body.shopId, created.body.id);
    seller.shopId = created.body.id;
    // New shops wait for staff approval; the approval flow itself is tested in cases-admin.test.js.
    await db.query(`UPDATE shops SET verification = 'verified' WHERE id = $1`, [seller.shopId]);

    const bad = await api('POST', '/api/products', { name: 'X', category: 'nope', price: 10, stock: 1 }, seller.token);
    assert.equal(bad.status, 400);

    const product = await api(
      'POST',
      '/api/products',
      { name: 'Wheelbarrow', category: 'building', price: 650, stock: 5, tiers: [{ min: 3, price: 600 }] },
      seller.token,
    );
    assert.equal(product.status, 201, JSON.stringify(product.body));
    productId = product.body.id;

    const all = await api('GET', `/api/products?shop=${seller.shopId}`);
    assert.ok(all.body.items.some((p) => p.id === productId && p.shopId === seller.shopId));
  });

  test('a second shop and town mismatches are rejected', async () => {
    assert.equal((await api('POST', '/api/shops', shopBody, seller.token)).status, 409);
    const other = await signIn('0966222333');
    const wrongTown = await api('POST', '/api/shops', { ...shopBody, town: 'Lusaka' }, other.token);
    assert.equal(wrongTown.status, 400);
  });

  test("nobody can edit another person's shop or product", async () => {
    const intruder = await signIn('0955444555');
    await api(
      'POST',
      '/api/shops',
      { ...shopBody, name: 'Intruder Shop', province: 'lusaka', town: 'Lusaka' },
      intruder.token,
    );
    assert.equal((await api('PATCH', `/api/shops/${seller.shopId}`, shopBody, intruder.token)).status, 403);
    const edit = await api(
      'PATCH',
      `/api/products/${productId}`,
      { name: 'Hacked', category: 'building', price: 1, stock: 1 },
      intruder.token,
    );
    assert.equal(edit.status, 404);
    assert.equal((await api('DELETE', `/api/products/${productId}`, undefined, intruder.token)).status, 404);
  });

  test('order totals are calculated on the server and stock goes down', async () => {
    buyer = await signIn('0977000111', { name: 'Chanda Phiri' });
    const order = await api(
      'POST',
      '/api/orders',
      {
        items: [{ productId, qty: 3, price: 1 }], // a price sent by the browser is ignored
        shipping: {
          name: 'Chanda Phiri',
          phone: '0977000111',
          province: 'copperbelt',
          town: 'Kitwe',
          address: 'Plot 5',
        },
        couriers: { [seller.shopId]: 'yango' },
        payment: 'momo',
      },
      buyer.token,
    );
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(order.body.subtotal, 1800); // 3 × K600 wholesale tier
    assert.equal(order.body.delivery, 45); // Yango, same town
    assert.equal(order.body.total, 1845);
    assert.equal(order.body.shipments[0].status, 'pending');

    const product = await api('GET', `/api/products/${productId}`);
    assert.equal(product.body.stock, 2);
    assert.equal(product.body.sold, 3);
  });

  test('orders are refused when stock, courier or payment rules fail', async () => {
    const base = {
      shipping: { name: 'Chanda Phiri', phone: '0977000111', province: 'lusaka', town: 'Lusaka', address: 'Plot 5' },
    };
    const tooMany = await api(
      'POST',
      '/api/orders',
      { ...base, items: [{ productId, qty: 3 }], couriers: { [seller.shopId]: 'bus' }, payment: 'momo' },
      buyer.token,
    );
    assert.equal(tooMany.status, 409);
    assert.match(tooMany.body.error, /Only 2/);

    const yangoAcrossProvinces = await api(
      'POST',
      '/api/orders',
      { ...base, items: [{ productId, qty: 1 }], couriers: { [seller.shopId]: 'yango' }, payment: 'momo' },
      buyer.token,
    );
    assert.equal(yangoAcrossProvinces.status, 409);

    const codOnBus = await api(
      'POST',
      '/api/orders',
      { ...base, items: [{ productId, qty: 1 }], couriers: { [seller.shopId]: 'bus' }, payment: 'cod' },
      buyer.token,
    );
    assert.equal(codOnBus.status, 409);
    assert.match(codOnBus.body.error, /Pay on Delivery/);

    assert.equal((await api('GET', `/api/products/${productId}`)).body.stock, 2, 'failed orders must not touch stock');
  });

  test('the seller sees the order and moves the parcel forward only', async () => {
    const orders = await api('GET', '/api/orders/shop', undefined, seller.token);
    assert.equal(orders.body.length, 1);
    const order = orders.body[0];
    assert.equal(order.shipments[0].items[0].qty, 3);

    const url = `/api/orders/${order.id}/shipments/${seller.shopId}`;
    assert.equal((await api('PATCH', url, { status: 'delivered' }, seller.token)).status, 403, 'only the buyer confirms delivery');
    assert.equal((await api('POST', `${url}/received`, undefined, buyer.token)).status, 409, 'not sent yet');
    assert.equal((await api('POST', `${url}/received`, undefined, seller.token)).status, 404, 'not the buyer');
    assert.equal((await api('PATCH', url, { status: 'dispatched' }, buyer.token)).status, 403);
    const sent = await api('PATCH', url, { status: 'dispatched', tracking: 'YG-4471' }, seller.token);
    assert.equal(sent.body.shipments[0].tracking, 'YG-4471');
    assert.equal(
      (await api('POST', `${url}/received`, undefined, buyer.token)).body.shipments[0].status,
      'delivered',
    );

    const mine = await api('GET', '/api/orders/mine', undefined, buyer.token);
    assert.equal(mine.body[0].shipments[0].status, 'delivered');
    assert.equal((await api('GET', '/api/orders/mine', undefined, seller.token)).body.length, 0);
  });

  test('photo uploads accept small images from signed-in users (products and return evidence)', async () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const ok = await api('POST', '/api/uploads', { dataUrl: pixel }, seller.token);
    // The photo is served from the database, as an image that browsers may cache.
    const photo = await fetch(base + ok.body.url);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.match(photo.headers.get('cache-control'), /max-age=2592000/);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), Buffer.from(pixel.split(',')[1], 'base64'));
    assert.equal((await fetch(`${base}/uploads/img_missing.jpg`)).status, 404);
    assert.equal(ok.status, 201);
    const served = await fetch(base + ok.body.url);
    assert.equal(served.status, 200);
    assert.equal((await api('POST', '/api/uploads', { dataUrl: pixel }, buyer.token)).status, 201);
    assert.equal((await api('POST', '/api/uploads', { dataUrl: pixel })).status, 401);
    assert.equal(
      (await api('POST', '/api/uploads', { dataUrl: 'data:text/html;base64,PGI+' }, seller.token)).status,
      400,
    );
  });
});
