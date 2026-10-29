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
  db = await createDb({ url: '', dataDir: '' });
  await migrate(db);
  await seedIfEmpty(db);
  uploadDir = await mkdtemp(path.join(tmpdir(), 'zed-market-p3-'));
  server = createApp(db, { auth: testAuth, uploadDir, sms: { send: async (phone, message) => sent.push({ phone, message }) } }).listen(
    0,
  );
  base = `http://localhost:${server.address().port}`;
  await setupShop();
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
  const out = { status: res.status, body: await res.json().catch(() => ({})) };
  // Most tests are about what happens after payment, so the shop's "payment received" is recorded at once.
  // The payment steps themselves are tested in payments.test.js.
  if (method === 'POST' && url === '/api/orders' && out.status === 201 && body.payment === 'momo') {
    await db.query('UPDATE shipments SET paid_at = now() WHERE order_id = $1', [out.body.id]);
  }
  return out;
}

// Signs in through the stand-in for Clerk (see testing/auth.js).
async function signIn(phone, name = 'Test') {
  return testSignIn(api, phone, name);
}

let seller;
let buyer;
let other;
let fanId; // K500 standing fan, 2 kg, 100 in stock
const shipping = { name: 'Chipo', phone: '0966111000', province: 'lusaka', town: 'Lusaka', address: 'Plot 3' };
const cart = (extra = {}) => ({
  items: [{ productId: fanId, qty: 2 }],
  shipping,
  couriers: { [seller.shopId]: 'pickup' },
  payment: 'momo',
  ...extra,
});

async function setupShop() {
  seller = await signIn('0977700700', 'Mutinta');
  const shop = await api(
    'POST',
    '/api/shops',
    {
      name: 'Mutinta Appliances',
      ownerFullName: 'Test Owner',
      nrc: '123456/78/1',
      phone: '0977700700',
      province: 'lusaka',
      town: 'Lusaka',
      area: 'Cairo Road',
      momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'yango'],
      tpin: '1002003004',
      vatRegistered: true,
    },
    seller.token,
  );
  assert.equal(shop.status, 201, JSON.stringify(shop.body));
  seller.shopId = shop.body.id;
  await db.query(`UPDATE shops SET verification = 'verified' WHERE id = $1`, [seller.shopId]);
  const fan = await api(
    'POST',
    '/api/products',
    { name: 'Standing Fan', category: 'home', price: 500, stock: 100, weightKg: 2, tiers: [{ min: 10, price: 450 }] },
    seller.token,
  );
  fanId = fan.body.id;
  buyer = await signIn('0966111000', 'Chipo');
  other = await signIn('0955222000', 'Kondwani');
}

describe('messages', () => {
  let conversationId;

  test('a buyer asks a shop a question and the shop replies; unread counts follow', async () => {
    const start = await api(
      'POST',
      '/api/conversations',
      { shopId: seller.shopId, productId: fanId, body: 'Does it have a remote?' },
      buyer.token,
    );
    assert.equal(start.status, 201, JSON.stringify(start.body));
    conversationId = start.body.id;

    assert.equal((await api('GET', '/api/conversations/unread', undefined, seller.token)).body.count, 1);
    const list = (await api('GET', '/api/conversations', undefined, seller.token)).body;
    assert.equal(list[0].role, 'seller');
    assert.equal(list[0].withName, 'Chipo');
    assert.equal(list[0].productName, 'Standing Fan');

    const thread = (await api('GET', `/api/conversations/${conversationId}`, undefined, seller.token)).body;
    assert.equal(thread.messages[0].body, 'Does it have a remote?');
    assert.equal((await api('GET', '/api/conversations/unread', undefined, seller.token)).body.count, 0);

    await api('POST', `/api/conversations/${conversationId}/messages`, { body: 'Yes, remote included.' }, seller.token);
    assert.equal((await api('GET', '/api/conversations/unread', undefined, buyer.token)).body.count, 1);

    // Asking the same shop again continues the same conversation.
    const again = await api(
      'POST',
      '/api/conversations',
      { shopId: seller.shopId, body: 'Great, thanks' },
      buyer.token,
    );
    assert.equal(again.body.id, conversationId);
  });

  test('outsiders cannot read or write, and shops cannot message themselves', async () => {
    assert.equal((await api('GET', `/api/conversations/${conversationId}`, undefined, other.token)).status, 404);
    const write = await api('POST', `/api/conversations/${conversationId}/messages`, { body: 'hi' }, other.token);
    assert.equal(write.status, 404);
    const self = await api('POST', '/api/conversations', { shopId: seller.shopId, body: 'hi' }, seller.token);
    assert.equal(self.status, 400);
    assert.equal(
      (await api('POST', '/api/conversations', { shopId: seller.shopId, body: '  ' }, buyer.token)).status,
      400,
    );
  });
});

describe('discount codes', () => {
  test('shop creates codes; checkout preview and order apply them on the server', async () => {
    const pct = await api(
      'POST',
      '/api/seller/coupons',
      { code: 'fan10', kind: 'percent', value: 10, minSpend: 800 },
      seller.token,
    );
    assert.equal(pct.status, 201, JSON.stringify(pct.body));
    assert.equal(pct.body.code, 'FAN10');
    assert.equal(
      (await api('POST', '/api/seller/coupons', { code: 'FAN10', kind: 'amount', value: 5 }, seller.token)).status,
      409,
    );

    const preview = await api('POST', '/api/orders/quote', cart({ coupon: 'fan10' }), buyer.token);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.discount, 100); // 10% of K1000
    assert.equal(preview.body.total, 900);

    const tooSmall = await api(
      'POST',
      '/api/orders/quote',
      cart({ items: [{ productId: fanId, qty: 1 }], coupon: 'FAN10' }),
      buyer.token,
    );
    assert.equal(tooSmall.status, 409);
    assert.match(tooSmall.body.error, /Spend at least K800/);

    const unknown = await api('POST', '/api/orders/quote', cart({ coupon: 'NOPE' }), buyer.token);
    assert.equal(unknown.status, 409);

    const order = await api('POST', '/api/orders', cart({ coupon: 'FAN10' }), buyer.token);
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(order.body.total, 900);
    assert.equal(order.body.shipments[0].couponCode, 'FAN10');
    assert.equal(order.body.shipments[0].shopTpin, '1002003004');

    // Once per customer.
    const twice = await api('POST', '/api/orders', cart({ coupon: 'FAN10' }), buyer.token);
    assert.equal(twice.status, 409);
    assert.match(twice.body.error, /already used/);
  });

  test('usage limits, expiry and switching off', async () => {
    const limited = await api(
      'POST',
      '/api/seller/coupons',
      { code: 'ONCE', kind: 'amount', value: 50, maxUses: 1 },
      seller.token,
    );
    assert.equal(
      (
        await api(
          'POST',
          '/api/orders',
          cart({ coupon: 'ONCE', shipping: { ...shipping, name: 'Kondwani', phone: '0955222000' } }),
          other.token,
        )
      ).status,
      201,
    );
    const used = await api('POST', '/api/orders/quote', cart({ coupon: 'ONCE' }), buyer.token);
    assert.match(used.body.error, /fully used/);

    await api(
      'POST',
      '/api/seller/coupons',
      { code: 'OLD', kind: 'amount', value: 50, endsAt: '2020-01-01' },
      seller.token,
    );
    assert.match((await api('POST', '/api/orders/quote', cart({ coupon: 'OLD' }), buyer.token)).body.error, /expired/);

    await api('PATCH', `/api/seller/coupons/${limited.body.id}`, { active: false }, seller.token);
    const list = (await api('GET', '/api/seller/coupons', undefined, seller.token)).body;
    assert.equal(list.find((c) => c.code === 'ONCE').active, false);
    assert.equal(list.find((c) => c.code === 'ONCE').uses, 1);
    assert.equal((await api('GET', '/api/seller/coupons', undefined, buyer.token)).status, 403);
  });
});

describe('featured listings', () => {
  test('shops can feature up to 3 products, and featured ones are listed', async () => {
    const ids = [fanId];
    for (const name of ['Kettle', 'Iron', 'Toaster']) {
      ids.push(
        (await api('POST', '/api/products', { name, category: 'home', price: 100, stock: 5 }, seller.token)).body.id,
      );
    }
    for (const id of ids.slice(0, 3)) {
      assert.equal((await api('POST', `/api/products/${id}/feature`, undefined, seller.token)).status, 200);
    }
    const fourth = await api('POST', `/api/products/${ids[3]}/feature`, undefined, seller.token);
    assert.equal(fourth.status, 409);
    assert.equal((await api('POST', `/api/products/${ids[0]}/feature`, undefined, other.token)).status, 403);

    const featured = (await api('GET', '/api/products?featured=1')).body;
    assert.equal(featured.total, 3);
    assert.ok(featured.items.every((p) => p.featuredUntil));

    await api('DELETE', `/api/products/${ids[0]}/feature`, undefined, seller.token);
    assert.equal((await api('POST', `/api/products/${ids[3]}/feature`, undefined, seller.token)).status, 200);
  });
});

describe('wholesale price requests', () => {
  let requestId;

  test('buyer asks, shop quotes, buyer accepts and checks out once at that price', async () => {
    const asked = await api(
      'POST',
      '/api/price-requests',
      { productId: fanId, qty: 40, targetPrice: 380, note: 'For my shop in Kafue', province: 'lusaka', town: 'Kafue' },
      buyer.token,
    );
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    requestId = asked.body.id;
    assert.equal(asked.body.status, 'open');

    const notYet = await api('PATCH', `/api/price-requests/${requestId}/accept`, undefined, buyer.token);
    assert.equal(notYet.status, 409);
    assert.equal(
      (await api('PATCH', `/api/price-requests/${requestId}/respond`, { price: 400 }, other.token)).status,
      403,
    );

    const quoted = await api(
      'PATCH',
      `/api/price-requests/${requestId}/respond`,
      { price: 400, validDays: 3, note: 'Best price' },
      seller.token,
    );
    assert.equal(quoted.body.status, 'quoted');
    assert.equal(quoted.body.quotedPrice, 400);
    const shopList = (await api('GET', '/api/price-requests/shop', undefined, seller.token)).body;
    assert.equal(shopList[0].buyerPhone, '0966111000');

    // Before accepting, the agreed price can't be used.
    const early = await api(
      'POST',
      '/api/orders/quote',
      cart({ items: [{ productId: fanId, qty: 40, quoteId: requestId }] }),
      buyer.token,
    );
    assert.equal(early.status, 409);

    assert.equal(
      (await api('PATCH', `/api/price-requests/${requestId}/accept`, undefined, buyer.token)).body.status,
      'accepted',
    );
    const wrongQty = await api(
      'POST',
      '/api/orders/quote',
      cart({ items: [{ productId: fanId, qty: 39, quoteId: requestId }] }),
      buyer.token,
    );
    assert.match(wrongQty.body.error, /exactly 40 units/);
    const stolen = await api(
      'POST',
      '/api/orders/quote',
      cart({ items: [{ productId: fanId, qty: 40, quoteId: requestId }] }),
      other.token,
    );
    assert.equal(stolen.status, 409);

    const order = await api(
      'POST',
      '/api/orders',
      cart({ items: [{ productId: fanId, qty: 40, quoteId: requestId }] }),
      buyer.token,
    );
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(order.body.subtotal, 40 * 400); // not the K450 tier price

    const again = await api(
      'POST',
      '/api/orders',
      cart({ items: [{ productId: fanId, qty: 40, quoteId: requestId }] }),
      buyer.token,
    );
    assert.equal(again.status, 409);
    const mine = (await api('GET', '/api/price-requests/mine', undefined, buyer.token)).body;
    assert.equal(mine[0].status, 'ordered');
  });

  test('requests are checked: own shop, options, one open request per product', async () => {
    const own = await api(
      'POST',
      '/api/price-requests',
      { productId: fanId, qty: 10, province: 'lusaka', town: 'Lusaka' },
      seller.token,
    );
    assert.equal(own.status, 400);
    const shirt = await api(
      'POST',
      '/api/price-requests',
      { productId: 'p16', qty: 50, province: 'lusaka', town: 'Lusaka' },
      other.token,
    );
    assert.match(shirt.body.error, /Choose a size/);
    const ok = await api(
      'POST',
      '/api/price-requests',
      { productId: 'p16', qty: 50, options: { Size: 'L' }, province: 'lusaka', town: 'Lusaka' },
      other.token,
    );
    assert.equal(ok.status, 201);
    const dup = await api(
      'POST',
      '/api/price-requests',
      { productId: 'p16', qty: 60, options: { Size: 'M' }, province: 'lusaka', town: 'Lusaka' },
      other.token,
    );
    assert.equal(dup.status, 409);
  });
});

describe('statements and account data', () => {
  test('the monthly statement shows delivered parcels, commission and payout', async () => {
    const orders = (await api('GET', '/api/orders/shop', undefined, seller.token)).body;
    const first = orders.find((o) => o.shipments[0].couponCode === 'FAN10');
    const url = `/api/orders/${first.id}/shipments/${seller.shopId}`;
    await api('PATCH', url, { status: 'dispatched' }, seller.token);
    await api('POST', `${url}/received`, undefined, buyer.token);

    const month = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 7); // Zambian time
    const statement = (await api('GET', `/api/seller/statement?month=${month}`, undefined, seller.token)).body;
    assert.equal(statement.lines.length, 1);
    assert.equal(statement.totals.subtotal, 1000);
    assert.equal(statement.totals.discount, 100);
    assert.equal(statement.totals.commission, 45); // 5% of K900
    assert.equal(statement.totals.cashCollected, 900, 'the buyer paid the shop directly');
    assert.equal(statement.totals.payout, -45, 'so the shop owes the commission');
    assert.equal(statement.shop.tpin, '1002003004');
    assert.equal((await api('GET', '/api/seller/statement?month=2026-13', undefined, seller.token)).status, 400);
  });

  test('a buyer can download their data, and delete their account once orders have arrived', async () => {
    const data = (await api('GET', '/api/me/export', undefined, buyer.token)).body;
    assert.equal(data.user.name, 'Chipo');
    assert.ok(data.orders.length >= 2);
    assert.ok(data.messages.length >= 2);

    const blocked = await api('DELETE', '/api/me', undefined, buyer.token);
    assert.equal(blocked.status, 409, 'orders still on the way');
    assert.equal(
      (await api('DELETE', '/api/me', undefined, seller.token)).status,
      409,
      'shop owners close their shop first',
    );

    // Deliver everything, then delete.
    for (const o of (await api('GET', '/api/orders/mine', undefined, buyer.token)).body) {
      const url = `/api/orders/${o.id}/shipments/${seller.shopId}`;
      if (o.shipments[0].status === 'pending') await api('PATCH', url, { status: 'dispatched' }, seller.token);
      if (o.shipments[0].status !== 'delivered') await api('POST', `${url}/received`, undefined, buyer.token);
    }
    const deleted = await api('DELETE', '/api/me', undefined, buyer.token);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal((await api('GET', '/api/session/me', undefined, buyer.token)).status, 401, 'signed out everywhere');

    const shopView = (await api('GET', '/api/orders/shop', undefined, seller.token)).body;
    assert.ok(
      shopView.every((o) => o.buyer.phone !== '0966111000'),
      'phone removed from shop records',
    );
    const [row] = await db.query(`SELECT phone, email, deleted_at FROM users WHERE id = $1`, [buyer.user.id]);
    assert.deepEqual([row.phone, row.email, !!row.deleted_at], [null, null, true], 'contact details removed');
  });
});
