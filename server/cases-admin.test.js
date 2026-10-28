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
const ADMIN_PHONE = '0950000001';

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

let admin;
let seller;
let buyer;
let other;
let fanId;
const shipping = { name: 'Chipo', phone: '0966111000', province: 'lusaka', town: 'Lusaka', address: 'Plot 3' };
const order = (extra = {}, token = buyer.token) =>
  api(
    'POST',
    '/api/orders',
    {
      items: [{ productId: fanId, qty: 2 }],
      shipping,
      couriers: { [seller.shopId]: 'yango' },
      payment: 'momo',
      ...extra,
    },
    token,
  );
const stockOf = async (id) => (await db.query('SELECT stock, sold FROM products WHERE id = $1', [id]))[0];
const advance = async (o, ...steps) => {
  for (const status of steps)
    await api('PATCH', `/api/orders/${o.id}/shipments/${seller.shopId}`, { status }, seller.token);
};

before(async () => {
  db = await createDb({ url: '', dataDir: '' });
  await migrate(db);
  await seedIfEmpty(db);
  uploadDir = await mkdtemp(path.join(tmpdir(), 'zed-market-cases-'));
  server = createApp(db, { auth: testAuth,
    uploadDir,
    sms: { send: async (phone, message) => sent.push({ phone, message }) },
    adminPhones: [ADMIN_PHONE],
  }).listen(0);
  base = `http://localhost:${server.address().port}`;

  admin = await signIn(ADMIN_PHONE, 'Staff Member');
  seller = await signIn('0977700700', 'Mutinta');
  const shop = await api(
    'POST',
    '/api/shops',
    {
      name: 'Mutinta Appliances',
      ownerFullName: 'Mutinta Hamoonga',
      nrc: '123456/78/1',
      phone: '0977700700',
      province: 'lusaka',
      town: 'Lusaka',
      area: 'Cairo Road',
      momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'yango'],
    },
    seller.token,
  );
  seller.shopId = shop.body.id;
  // Staff approve the new shop so it can sell.
  await api('PATCH', `/api/admin/shops/${seller.shopId}/verification`, { status: 'verified' }, admin.token);
  fanId = (
    await api(
      'POST',
      '/api/products',
      { name: 'Standing Fan', category: 'home', price: 500, stock: 10, weightKg: 2 },
      seller.token,
    )
  ).body.id;
  await api('POST', '/api/seller/coupons', { code: 'FAN50', kind: 'amount', value: 50, maxUses: 1 }, seller.token);
  buyer = await signIn('0966111000', 'Chipo');
  other = await signIn('0955222000', 'Kondwani');
});

after(async () => {
  server.close();
  await db.close();
  await rm(uploadDir, { recursive: true, force: true });
});

describe('cancelling parcels', () => {
  test('the buyer cancels before dispatch: stock, code use and money come back', async () => {
    const placed = await order({ coupon: 'FAN50' });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.deepEqual(await stockOf(fanId), { stock: 8, sold: 2 });

    assert.equal(
      (
        await api(
          'POST',
          `/api/orders/${placed.body.id}/shipments/${seller.shopId}/cancel`,
          { reason: 'Changed my mind' },
          other.token,
        )
      ).status,
      404,
    );
    const cancelled = await api(
      'POST',
      `/api/orders/${placed.body.id}/shipments/${seller.shopId}/cancel`,
      { reason: 'Changed my mind' },
      buyer.token,
    );
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.order.shipments[0].status, 'cancelled');
    assert.equal(cancelled.body.order.shipments[0].cancelledBy, 'buyer');
    assert.equal(cancelled.body.refund, 1000 - 50 + 45);
    assert.deepEqual(await stockOf(fanId), { stock: 10, sold: 0 });

    const again = await api(
      'POST',
      `/api/orders/${placed.body.id}/shipments/${seller.shopId}/cancel`,
      { reason: 'again' },
      buyer.token,
    );
    assert.equal(again.status, 409);

    // The single-use code works again, for the same buyer.
    const reorder = await order({ coupon: 'FAN50' });
    assert.equal(reorder.status, 201, JSON.stringify(reorder.body));
    await api(
      'POST',
      `/api/orders/${reorder.body.id}/shipments/${seller.shopId}/cancel`,
      { reason: 'Out of stock' },
      seller.token,
    );
  });

  test('sent parcels cannot be cancelled by the buyer, and cancelled parcels are not sales', async () => {
    const placed = await order();
    await advance(placed.body, 'dispatched');
    const res = await api(
      'POST',
      `/api/orders/${placed.body.id}/shipments/${seller.shopId}/cancel`,
      { reason: 'Too slow' },
      buyer.token,
    );
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already been sent/);

    const report = (await api('GET', '/api/seller/report', undefined, seller.token)).body;
    assert.equal(report.orders, 1, 'two cancelled parcels are left out');
    await advance(placed.body, 'delivered');
  });
});

describe('returns and disputes', () => {
  let delivered;
  let caseId;

  test('setup: a delivered order', async () => {
    delivered = (await order()).body;
    await advance(delivered, 'dispatched', 'delivered');
    const mine = (await api('GET', '/api/orders/mine', undefined, buyer.token)).body;
    assert.ok(mine.find((o) => o.id === delivered.id).shipments[0].deliveredAt);
  });

  test('the buyer opens a return; checks on items and duplicates', async () => {
    const base = {
      orderId: delivered.id,
      shopId: seller.shopId,
      kind: 'return',
      reason: 'faulty',
      description: 'Stops after 10 minutes',
    };
    assert.equal(
      (await api('POST', '/api/cases', { ...base, items: [{ productId: fanId, qty: 3 }] }, buyer.token)).status,
      400,
    );
    assert.equal((await api('POST', '/api/cases', { ...base, items: [] }, buyer.token)).status, 400);
    assert.equal(
      (await api('POST', '/api/cases', { ...base, items: [{ productId: fanId, qty: 1 }] }, other.token)).status,
      404,
    );

    const opened = await api('POST', '/api/cases', { ...base, items: [{ productId: fanId, qty: 1 }] }, buyer.token);
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.equal(opened.body.items[0].name, 'Standing Fan');
    caseId = opened.body.id;

    const dup = await api('POST', '/api/cases', { ...base, items: [{ productId: fanId, qty: 1 }] }, buyer.token);
    assert.equal(dup.status, 409);

    const early = await api('PATCH', `/api/cases/${caseId}/escalate`, {}, buyer.token);
    assert.equal(early.status, 409, 'the shop gets 3 days to answer first');
    assert.equal((await api('GET', '/api/cases/shop', undefined, seller.token)).body[0].id, caseId);
  });

  test('the shop rejects, the buyer escalates, staff refund the buyer', async () => {
    assert.equal(
      (await api('PATCH', `/api/cases/${caseId}/respond`, { accept: false, note: 'ok' }, seller.token)).status,
      400,
    );
    const rejected = await api(
      'PATCH',
      `/api/cases/${caseId}/respond`,
      { accept: false, note: 'It was working when sent' },
      seller.token,
    );
    assert.equal(rejected.body.status, 'rejected');
    assert.equal(
      (await api('PATCH', `/api/cases/${caseId}/respond`, { accept: true, resolution: 'repair' }, buyer.token)).status,
      403,
    );

    const escalated = await api('PATCH', `/api/cases/${caseId}/escalate`, { note: 'It really is faulty' }, buyer.token);
    assert.equal(escalated.body.status, 'escalated');

    const queue = (await api('GET', '/api/admin/cases?status=escalated', undefined, admin.token)).body;
    assert.equal(queue[0].id, caseId);
    assert.equal(queue[0].refundableLeft, 1045);

    const decided = await api(
      'PATCH',
      `/api/admin/cases/${caseId}/decide`,
      { outcome: 'refund', refundAmount: 500, note: 'Photos show a fault' },
      admin.token,
    );
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.status, 'resolved');
    assert.equal(decided.body.refundAmount, 500);
    assert.deepEqual(
      decided.body.events.map((e) => e.action),
      ['opened', 'rejected', 'escalated', 'decided: refund'],
    );

    const mine = (await api('GET', '/api/orders/mine', undefined, buyer.token)).body.find((o) => o.id === delivered.id);
    assert.equal(mine.shipments[0].refunded, 500);
    assert.equal(mine.shipments[0].latestCase.status, 'resolved');
  });

  test('a shop accepting a "not received" case refunds at most what is left', async () => {
    const opened = await api(
      'POST',
      '/api/cases',
      {
        orderId: delivered.id,
        shopId: seller.shopId,
        kind: 'not_received',
        reason: 'not_received',
        description: 'Only one fan came',
      },
      buyer.token,
    );
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    const accepted = await api(
      'PATCH',
      `/api/cases/${opened.body.id}/respond`,
      { accept: true, resolution: 'refund', refundAmount: 5000, note: 'Sorry' },
      seller.token,
    );
    assert.equal(accepted.body.refundAmount, 545); // 1045 paid, 500 already refunded
  });

  test('the monthly statement deducts return refunds', async () => {
    const month = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 7);
    const st = (await api('GET', `/api/seller/statement?month=${month}`, undefined, seller.token)).body;
    assert.equal(st.totals.refunds, 1045);
    assert.equal(st.refunds.length, 2);
    // Two delivered parcels of K1000 + K45, paid straight to the shop: it owes 2 × K50 commission.
    // Refunds of K500 + K545 cover the K1000 goods and K45 delivery, so exactly K50 commission comes back.
    assert.equal(st.totals.payout, -100 - 1045 + 50);
  });
});

describe('staff tools', () => {
  test('only staff can use the admin API', async () => {
    assert.equal((await api('GET', '/api/admin/stats', undefined, buyer.token)).status, 403);
    assert.equal((await api('GET', '/api/admin/stats')).status, 401);
    const stats = await api('GET', '/api/admin/stats', undefined, admin.token);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.refundsDue, 4);
    const me = (await api('GET', '/api/session/me', undefined, admin.token)).body;
    assert.equal(me.isAdmin, true);
    assert.equal((await api('GET', '/api/session/me', undefined, buyer.token)).body.isAdmin, false);
  });

  test('new shops stay hidden until staff approve them; rejected shops can fix and resubmit', async () => {
    const owner = await signIn('0977888999', 'Kalaba');
    const body = {
      name: 'Kalaba Electronics',
      phone: '0977888999',
      province: 'copperbelt',
      town: 'Ndola',
      area: 'Broadway',
      momoNetwork: 'mtn', momoNumber: '0966555000', momoName: 'Shop Owner', couriers: ['pickup', 'platinum'],
    };
    // Owner details are required to apply.
    assert.equal((await api('POST', '/api/shops', body, owner.token)).status, 400);
    const bad = await api(
      'POST',
      '/api/shops',
      { ...body, ownerFullName: 'Kalaba Mulenga', nrc: '12345' },
      owner.token,
    );
    assert.equal(bad.status, 400);
    const created = await api(
      'POST',
      '/api/shops',
      { ...body, ownerFullName: 'Kalaba Mulenga', nrc: '345678/90/1' },
      owner.token,
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const shopId = created.body.id;
    assert.equal(created.body.verification, 'pending');

    // The owner can prepare the shop; buyers can't see it.
    const radio = (
      await api('POST', '/api/products', { name: 'Car Radio', category: 'auto', price: 650, stock: 5 }, owner.token)
    ).body;
    assert.ok(
      (await api('GET', `/api/products?shop=${shopId}`, undefined, owner.token)).body.total === 1,
      'owner sees own products',
    );
    assert.equal((await api('GET', `/api/products/${radio.id}`, undefined, owner.token)).status, 200);
    assert.equal((await api('GET', `/api/products?shop=${shopId}`)).body.total, 0);
    assert.equal((await api('GET', `/api/products/${radio.id}`)).status, 404);
    assert.equal((await api('GET', `/api/shops/${shopId}`)).status, 404);
    assert.ok(!(await api('GET', '/api/shops')).body.some((s) => s.id === shopId));
    assert.ok((await api('GET', '/api/shops', undefined, owner.token)).body.some((s) => s.id === shopId));
    const order = await api(
      'POST',
      '/api/orders',
      { items: [{ productId: radio.id, qty: 1 }], shipping, couriers: { [shopId]: 'pickup' }, payment: 'momo' },
      buyer.token,
    );
    assert.equal(order.status, 409);
    assert.equal((await api('POST', '/api/conversations', { shopId, body: 'Hello?' }, buyer.token)).status, 404);

    // Staff see it in the review queue with the owner's details.
    const queue = (await api('GET', '/api/admin/shops?status=pending', undefined, admin.token)).body;
    const entry = queue.find((s) => s.id === shopId);
    assert.equal(entry.nrc, '345678/90/1');
    assert.equal(entry.ownerFullName, 'Kalaba Mulenga');
    assert.equal(entry.productCount, 1);
    assert.equal(
      (await api('PATCH', `/api/admin/shops/${shopId}/verification`, { status: 'rejected' }, admin.token)).status,
      400,
      'a rejection needs a reason',
    );
    await api(
      'PATCH',
      `/api/admin/shops/${shopId}/verification`,
      { status: 'rejected', note: 'NRC number does not match the name' },
      admin.token,
    );
    const rejected = (await api('GET', '/api/seller/verification', undefined, owner.token)).body;
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.note, 'NRC number does not match the name');

    // The owner corrects their details and is approved.
    await api('POST', '/api/seller/verification', { ownerFullName: 'Kalaba Mulenga', nrc: '345678/90/2' }, owner.token);
    assert.equal((await api('GET', '/api/seller/verification', undefined, owner.token)).body.status, 'pending');
    await api('PATCH', `/api/admin/shops/${shopId}/verification`, { status: 'verified' }, admin.token);

    const shop = (await api('GET', `/api/shops/${shopId}`)).body;
    assert.equal(shop.verified, true);
    assert.equal(shop.nrc, undefined, 'NRC is never public');
    assert.equal((await api('GET', `/api/products/${radio.id}`)).status, 200);
    const stats = (await api('GET', '/api/stats/provinces')).body;
    assert.ok(stats.copperbelt.shops >= 3);
  });

  test('suspending a shop hides its products and stops orders', async () => {
    assert.equal(
      (await api('PATCH', `/api/admin/shops/${seller.shopId}/suspension`, { suspended: true }, admin.token)).status,
      400,
    );
    await api(
      'PATCH',
      `/api/admin/shops/${seller.shopId}/suspension`,
      { suspended: true, reason: 'Many complaints' },
      admin.token,
    );
    assert.equal((await api('GET', `/api/products/${fanId}`)).status, 404);
    assert.equal((await api('GET', `/api/products?shop=${seller.shopId}`)).body.total, 0);
    const blocked = await order();
    assert.equal(blocked.status, 409);
    const own = (await api('GET', '/api/seller/verification', undefined, seller.token)).body;
    assert.equal(own.suspendReason, 'Many complaints');

    await api('PATCH', `/api/admin/shops/${seller.shopId}/suspension`, { suspended: false }, admin.token);
    assert.equal((await api('GET', `/api/products/${fanId}`)).status, 200);
  });

  test('staff remove and restore listings; the seller sees why', async () => {
    await api('POST', `/api/admin/products/${fanId}/remove`, { reason: 'Photo shows a different brand' }, admin.token);
    assert.equal((await api('GET', `/api/products/${fanId}`)).status, 404);
    const removed = (await api('GET', '/api/seller/removed-products', undefined, seller.token)).body;
    assert.equal(removed[0].removedReason, 'Photo shows a different brand');
    await api('POST', `/api/admin/products/${fanId}/restore`, undefined, admin.token);
    assert.equal((await api('GET', `/api/products/${fanId}`)).status, 200);
  });

  test('removing a review recalculates the rating', async () => {
    const [o] = (await api('GET', '/api/orders/mine', undefined, buyer.token)).body.filter(
      (x) => x.shipments[0].status === 'delivered',
    );
    const review = await api(
      'POST',
      '/api/reviews',
      { orderId: o.id, productId: fanId, rating: 1, comment: 'rude words' },
      buyer.token,
    );
    assert.equal((await api('GET', `/api/products/${fanId}`)).body.reviewCount, 1);
    await api('DELETE', `/api/admin/reviews/${review.body.id}`, { reason: 'Abusive language' }, admin.token);
    const product = (await api('GET', `/api/products/${fanId}`)).body;
    assert.equal(product.reviewCount, 0);
    assert.equal(product.rating, 0);
  });

  test('suspended users are signed out and cannot sign back in', async () => {
    assert.equal(
      (
        await api(
          'PATCH',
          `/api/admin/users/${admin.user.id}/suspension`,
          { suspended: true, reason: 'test' },
          admin.token,
        )
      ).status,
      400,
    );
    await api(
      'PATCH',
      `/api/admin/users/${other.user.id}/suspension`,
      { suspended: true, reason: 'Fraudulent orders' },
      admin.token,
    );
    const refused = await api('GET', '/api/session/me', undefined, other.token);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /suspended/);
    await api('PATCH', `/api/admin/users/${other.user.id}/suspension`, { suspended: false }, admin.token);
    assert.equal((await signIn('0955222000')).status, 200);
  });

  test('refunds are marked paid once, and every action is logged', async () => {
    const due = (await api('GET', '/api/admin/refunds?status=due', undefined, admin.token)).body;
    assert.equal(due.length, 4);
    assert.equal(
      (await api('PATCH', `/api/admin/refunds/${due[0].id}/paid`, { reference: 'MP2610.1234' }, admin.token)).status,
      200,
    );
    assert.equal(
      (await api('PATCH', `/api/admin/refunds/${due[0].id}/paid`, { reference: 'MP2610.1234' }, admin.token)).status,
      409,
    );

    const log = (await api('GET', '/api/admin/actions', undefined, admin.token)).body;
    const actions = log.map((a) => a.action);
    for (const expected of [
      'refund paid',
      'user suspended',
      'review removed',
      'listing removed',
      'shop suspended',
      'shop verified',
      'case decided: refund',
    ]) {
      assert.ok(actions.includes(expected), `missing ${expected}`);
    }
    assert.ok(log.every((a) => a.admin === 'Staff Member'));
  });

  test('staff can find orders and cancel a parcel that was already sent', async () => {
    const placed = (await order()).body;
    await advance(placed, 'dispatched');
    const found = (await api('GET', `/api/admin/orders?q=${placed.id.toLowerCase()}`, undefined, admin.token)).body;
    assert.equal(found[0].id, placed.id);
    const res = await api(
      'POST',
      `/api/admin/orders/${placed.id}/shipments/${seller.shopId}/cancel`,
      { reason: 'Courier lost the parcel' },
      admin.token,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.refund, 1045);
  });
});
