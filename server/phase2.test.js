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
  uploadDir = await mkdtemp(path.join(tmpdir(), 'zed-market-p2-'));
  server = createApp(db, { auth: testAuth, uploadDir, sms: { send: async (phone, message) => sent.push({ phone, message }) } }).listen(
    0,
  );
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
async function signIn(phone, name = 'Test') {
  return testSignIn(api, phone, name);
}

const names = (res) => res.body.items.map((p) => p.name);

describe('search and paging', () => {
  test('finds products despite typos', async () => {
    assert.ok(names(await api('GET', '/api/products?q=chitenje')).some((n) => n.includes('Chitenge')));
    assert.ok(names(await api('GET', '/api/products?q=solr%20panel')).some((n) => n.includes('Solar Panel')));
  });

  test('understands local synonyms', async () => {
    assert.ok(names(await api('GET', '/api/products?q=nshima')).some((n) => n.includes('Mealie Meal')));
    assert.ok(names(await api('GET', '/api/products?q=nappies')).some((n) => n.includes('Diapers')));
    assert.ok(names(await api('GET', '/api/products?q=fridge')).some((n) => n.includes('Fridge')));
  });

  test('nonsense finds nothing, and wildcards are treated literally', async () => {
    assert.equal((await api('GET', '/api/products?q=qwxzv')).body.total, 0);
    assert.equal((await api('GET', '/api/products?q=%25%25')).body.total, 0);
  });

  test('pages through results without repeats', async () => {
    const first = await api('GET', '/api/products?limit=20&page=1&sort=popular');
    const second = await api('GET', '/api/products?limit=20&page=2&sort=popular');
    assert.equal(first.body.total, 46);
    assert.equal(first.body.items.length, 20);
    const overlap = second.body.items.filter((p) => first.body.items.some((q) => q.id === p.id));
    assert.equal(overlap.length, 0);
  });

  test('sorts nearest first and filters by province and town', async () => {
    const near = await api('GET', '/api/products?sort=nearest&nearProv=western&nearTown=Mongu&limit=3');
    assert.ok(
      near.body.items.every((p) => p.shopId === 's13'),
      'Mongu shop products come first',
    );
    const kitwe = await api('GET', '/api/products?prov=copperbelt&town=Kitwe&limit=100');
    assert.ok(kitwe.body.items.length > 0 && kitwe.body.items.every((p) => p.shopId === 's3'));
  });

  test('can fetch a list of products by id (for carts)', async () => {
    const res = await api('GET', '/api/products?ids=p1,p10,nope');
    assert.deepEqual(res.body.items.map((p) => p.id).sort(), ['p1', 'p10']);
  });

  test('province stats count shops and products', async () => {
    const stats = (await api('GET', '/api/stats/provinces')).body;
    assert.equal(Object.keys(stats).length, 10);
    assert.equal(stats.western.shops, 1);
  });
});

describe('weights, options, reviews and seller tools', () => {
  let seller;
  let buyer;
  let shirtId;
  let sheetsId;
  let orderId;
  const shipping = { name: 'Chilufya', phone: '0966400400', province: 'lusaka', town: 'Lusaka', address: 'Plot 1' };

  test('setup: a Lusaka shop with a shirt (sizes) and heavy roofing sheets', async () => {
    seller = await signIn('0977300300', 'Mwila');
    const shop = await api(
      'POST',
      '/api/shops',
      {
        name: 'Mwila Traders',
        ownerFullName: 'Mwila Phiri',
        nrc: '234567/89/1',
        phone: '0977300300',
        province: 'lusaka',
        town: 'Lusaka',
        area: 'Kamwala',
        momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'yango', 'platinum', 'bus', 'zampost'],
      },
      seller.token,
    );
    seller.shopId = shop.body.id;
    await db.query(`UPDATE shops SET verification = 'verified' WHERE id = $1`, [seller.shopId]);
    const shirt = await api(
      'POST',
      '/api/products',
      {
        name: 'Work Shirt',
        category: 'fashion',
        price: 200,
        stock: 30,
        weightKg: 0.5,
        tiers: [{ min: 10, price: 150 }],
        options: [{ name: 'Size', values: ['M', 'L'] }],
      },
      seller.token,
    );
    assert.equal(shirt.status, 201, JSON.stringify(shirt.body));
    shirtId = shirt.body.id;
    const sheets = await api(
      'POST',
      '/api/products',
      { name: 'Roofing Sheet 3m', category: 'building', price: 280, stock: 500, weightKg: 9, lowStockAt: 600 },
      seller.token,
    );
    sheetsId = sheets.body.id;
    buyer = await signIn('0966400400', 'Chilufya');
  });

  test('options must be chosen, and mixed sizes still reach the wholesale price', async () => {
    const order = (items) =>
      api(
        'POST',
        '/api/orders',
        { items, shipping, couriers: { [seller.shopId]: 'yango' }, payment: 'momo' },
        buyer.token,
      );

    const noSize = await order([{ productId: shirtId, qty: 1 }]);
    assert.equal(noSize.status, 409);
    assert.match(noSize.body.error, /Choose a size/);
    assert.equal((await order([{ productId: shirtId, qty: 1, options: { Size: 'XXXL' } }])).status, 409);

    const mixed = await order([
      { productId: shirtId, qty: 6, options: { Size: 'M' } },
      { productId: shirtId, qty: 4, options: { Size: 'L' } },
    ]);
    assert.equal(mixed.status, 201, JSON.stringify(mixed.body));
    assert.equal(mixed.body.subtotal, 1500); // 10 shirts at the K150 tier
    assert.deepEqual(mixed.body.shipments[0].items.map((i) => i.options).sort(), ['Size: L', 'Size: M']);
    assert.equal(mixed.body.delivery, 45); // 5 kg fits Yango's base rate
    orderId = mixed.body.id;
  });

  test('heavy parcels cost more and rule out small couriers', async () => {
    const order = (courier, qty) =>
      api(
        'POST',
        '/api/orders',
        { items: [{ productId: sheetsId, qty }], shipping, couriers: { [seller.shopId]: courier }, payment: 'momo' },
        buyer.token,
      );
    const yango = await order('yango', 10); // 90 kg
    assert.equal(yango.status, 409);
    assert.match(yango.body.error, /Yango Delivery can't carry 90 kg/);

    const platinum = await order('platinum', 10); // 90 kg in the same town: K30 + 85 extra kg × K3
    assert.equal(platinum.status, 201, JSON.stringify(platinum.body));
    assert.equal(platinum.body.delivery, 30 + 85 * 3);
  });

  test('reviews: only after delivery, once, by the buyer; ratings update', async () => {
    const early = await api('POST', '/api/reviews', { orderId, productId: shirtId, rating: 5 }, buyer.token);
    assert.equal(early.status, 409);

    const url = `/api/orders/${orderId}/shipments/${seller.shopId}`;
    await api('PATCH', url, { status: 'dispatched' }, seller.token);
    await api('PATCH', url, { status: 'delivered' }, seller.token);

    const stranger = await signIn('0955500500');
    const notMine = await api('POST', '/api/reviews', { orderId, productId: shirtId, rating: 1 }, stranger.token);
    assert.equal(notMine.status, 403);

    const ok = await api(
      'POST',
      '/api/reviews',
      { orderId, productId: shirtId, rating: 4, comment: 'Good cotton' },
      buyer.token,
    );
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const twice = await api('POST', '/api/reviews', { orderId, productId: shirtId, rating: 5 }, buyer.token);
    assert.equal(twice.status, 409);

    const product = (await api('GET', `/api/products/${shirtId}`)).body;
    assert.equal(product.rating, 4);
    assert.equal(product.reviewCount, 1);
    const reviews = (await api('GET', `/api/products/${shirtId}/reviews`)).body;
    assert.equal(reviews.count, 1);
    assert.equal(reviews.histogram[4], 1);
    assert.equal(reviews.items[0].author, 'Chilufya');

    const mine = (await api('GET', '/api/orders/mine', undefined, buyer.token)).body;
    assert.equal(mine.find((o) => o.id === orderId).shipments[0].items[0].reviewRating, 4);

    const hijack = await api('PATCH', `/api/reviews/${ok.body.id}/reply`, { reply: 'Thanks!' }, stranger.token);
    assert.equal(hijack.status, 403);
    const reply = await api('PATCH', `/api/reviews/${ok.body.id}/reply`, { reply: 'Natotela!' }, seller.token);
    assert.equal(reply.body.reply, 'Natotela!');
  });

  test('bulk upload checks every row first and saves all or nothing', async () => {
    const bad = await api(
      'POST',
      '/api/products/bulk',
      {
        products: [
          { name: 'Hoe', category: 'agri', price: 80, stock: 10 },
          { name: 'Rake', category: 'gardening', price: 90, stock: 5 },
          { name: 'Spade', category: 'agri', price: -1, stock: 5 },
        ],
      },
      seller.token,
    );
    assert.equal(bad.status, 400);
    assert.deepEqual(
      bad.body.rows.map((r) => r.row),
      [2, 3],
    );
    assert.equal(
      (await api('GET', `/api/products?shop=${seller.shopId}`)).body.total,
      2,
      'nothing saved from a bad file',
    );

    const good = await api(
      'POST',
      '/api/products/bulk',
      {
        products: [
          { name: 'Hoe', category: 'agri', price: 80, stock: 10 },
          { name: 'Rake', category: 'agri', price: 90, stock: 5, tiers: [{ min: 10, price: 80 }] },
        ],
      },
      seller.token,
    );
    assert.equal(good.status, 201);
    assert.equal(good.body.created, 2);
  });

  test('sales report and low stock', async () => {
    const report = (await api('GET', '/api/seller/report?days=30', undefined, seller.token)).body;
    assert.equal(report.orders, 2);
    assert.equal(report.units, 20);
    assert.equal(report.revenue, 1500 + 2800);
    assert.equal(report.deliveredRevenue, 1500);
    assert.equal(report.toDispatch, 1);
    assert.equal(report.topProducts[0].name, 'Roofing Sheet 3m');
    assert.deepEqual(
      report.lowStock.map((p) => p.name),
      ['Rake', 'Roofing Sheet 3m'], // Rake: 5 left with the default alert at 5
    );
    assert.equal(report.reviewCount, 1);
    assert.equal((await api('GET', '/api/seller/report', undefined, buyer.token)).status, 403);
  });
});

test('synonyms match exactly, so related words do not drag in unrelated products', async () => {
  const found = names(await api('GET', '/api/products?q=chitenje'));
  assert.ok(found.some((n) => n.includes('Chitenge')));
  assert.ok(!found.some((n) => n.includes('Printer')), `unexpected: ${found.join(', ')}`);
});

test('searching a town shows products sold there, without fuzzy look-alikes', async () => {
  const res = await api('GET', '/api/products?q=kitwe&limit=100');
  assert.ok(res.body.total > 0);
  assert.ok(
    res.body.items.every((p) => p.shopId === 's3'),
    'only the Kitwe shop',
  );
});

test('shop-name matches use what was typed, not synonyms', async () => {
  // "Mongu Chitenge & Crafts" also sells cooking oil; a search for "chitenje" should not list it.
  assert.ok(!names(await api('GET', '/api/products?q=chitenje')).some((n) => n.includes('Cooking Oil')));
  // Typing the shop's name finds its products.
  assert.ok(
    names(await api('GET', '/api/products?q=mongu%20chitenge&limit=50')).some((n) => n.includes('Cooking Oil')),
  );
});

test('a category word finds the whole category', async () => {
  assert.ok((await api('GET', '/api/products?q=phone')).body.total >= 5);
});
