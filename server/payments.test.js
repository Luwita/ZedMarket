import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { testAuth, testSignIn } from './testing/auth.js';
import { createDb, migrate } from './db.js';

let server;
let base;
let db;

async function api(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Signs in through the stand-in for Clerk (see testing/auth.js).
async function signIn(phone, extra = {}) {
  return testSignIn(api, phone, extra);
}

const shopBody = {
  name: 'Mutinta Appliances',
  ownerFullName: 'Mutinta Hamoonga',
  nrc: '123456/78/1',
  phone: '0977100100',
  province: 'lusaka',
  town: 'Lusaka',
  area: 'Cairo Road',
  couriers: ['pickup', 'seller'],
  momoNetwork: 'airtel',
  momoNumber: '097 755 5123',
  momoName: 'Mutinta Hamoonga',
};
const shipping = { name: 'Chipo Zulu', phone: '0966200200', province: 'lusaka', town: 'Lusaka', address: 'Plot 5' };

let admin;
let seller;
let buyer;
let fanId;
const order = (payment, extra = {}) =>
  api(
    'POST',
    '/api/orders',
    { items: [{ productId: fanId, qty: 1 }], shipping, couriers: { [seller.shopId]: 'pickup' }, payment, ...extra },
    buyer.token,
  );
const parcel = (id, path, body, token) => api('POST', `/api/orders/${id}/shipments/${seller.shopId}/${path}`, body, token);
// What the person was told in the app (their notifications), oldest first, as "title. body".
const textsTo = async (phone) =>
  (
    await db.query(
      `SELECT n.title, n.body FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone = $1 ORDER BY n.created_at, n.id`,
      [phone],
    )
  ).map((n) => [n.title, n.body].filter(Boolean).join('. '));

before(async () => {
  db = await createDb({ url: '', dataDir: '' });
  await migrate(db);
  server = createApp(db, { auth: testAuth,
    uploadDir: '.',
    adminPhones: ['0955000001'],
  }).listen(0);
  base = `http://localhost:${server.address().port}`;

  admin = await signIn('0955000001');
  seller = await signIn('0977100100', { name: 'Mutinta' });
  buyer = await signIn('0966200200', { name: 'Chipo' });
});

after(async () => {
  server.close();
  await db.close();
});

describe('Mobile Money paid straight to the shop', () => {
  test('a shop must give its Mobile Money number, which only its owner and staff can see', async () => {
    const { momoNumber, ...without } = shopBody;
    const refused = await api('POST', '/api/shops', without, seller.token);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /Mobile Money number/);

    const created = await api('POST', '/api/shops', shopBody, seller.token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.momoNumber, '0977555123');
    seller.shopId = created.body.id;
    await api('PATCH', `/api/admin/shops/${seller.shopId}/verification`, { status: 'verified' }, admin.token);

    const forBuyers = (await api('GET', `/api/shops/${seller.shopId}`)).body;
    assert.equal(forBuyers.takesMomo, true);
    assert.equal(forBuyers.momoNumber, undefined, 'the number is not on the public shop page');
    assert.equal(JSON.stringify((await api('GET', '/api/shops')).body).includes('977555123'), false);
    assert.equal((await api('GET', `/api/shops/${seller.shopId}`, undefined, seller.token)).body.momoName, 'Mutinta Hamoonga');
    assert.equal((await api('GET', `/api/admin/shops/${seller.shopId}`, undefined, admin.token)).body.momoNetwork, 'airtel');

    const product = await api(
      'POST',
      '/api/products',
      { name: 'Standing Fan', category: 'home', price: 500, stock: 10 },
      seller.token,
    );
    fanId = product.body.id;
  });

  test('card and the old instant payments are gone', async () => {
    for (const payment of ['card', 'mtn']) assert.equal((await order(payment)).status, 400);
  });

  test('the buyer gets the number, says they paid, and the shop confirms before it can send', async () => {
    const placed = await order('momo');
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const o = placed.body;
    assert.equal(o.payment, 'Mobile Money');
    assert.equal(o.payByMomo, true);
    assert.equal(o.paid, false);
    assert.equal(o.shipments[0].due, 500);
    assert.deepEqual(o.shipments[0].payTo, {
      network: 'airtel',
      networkName: 'Airtel Money',
      number: '0977555123',
      name: 'Mutinta Hamoonga',
    });

    // Both sides are told in the app.
    assert.match((await textsTo('966200200')).at(-1), /^Pay K500 to Airtel Money 0977555123\. Name: Mutinta Hamoonga\./);
    assert.match((await textsTo('977100100')).at(-1), /New order ZM-\w+\..*Wait for K500 on your Mobile Money/);

    // The parcel can't be sent before the money is confirmed.
    const url = `/api/orders/${o.id}/shipments/${seller.shopId}`;
    const early = await api('PATCH', url, { status: 'dispatched' }, seller.token);
    assert.equal(early.status, 409);
    assert.match(early.body.error, /Confirm the buyer's Mobile Money payment/);

    // Only the buyer can say they paid; only the shop can confirm.
    assert.equal((await parcel(o.id, 'payment-sent', {}, seller.token)).status, 404);
    assert.equal((await parcel(o.id, 'paid', {}, buyer.token)).status, 403);

    const claimed = await parcel(o.id, 'payment-sent', { reference: 'MP261013.1530.A12345' }, buyer.token);
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    assert.equal(claimed.body.shipments[0].paymentRef, 'MP261013.1530.A12345');
    assert.equal(claimed.body.shipments[0].paid, false, 'saying you paid does not mark the parcel paid');
    assert.match((await textsTo('977100100')).at(-1), /Payment sent for order .*Chipo Zulu says they sent K500.*MP261013/);

    const confirmed = await parcel(o.id, 'paid', {}, seller.token);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.shipments[0].paid, true);
    assert.equal(confirmed.body.paid, true);
    assert.match((await textsTo('966200200')).at(-1), /Mutinta Appliances received your payment/);
    assert.equal((await parcel(o.id, 'paid', {}, seller.token)).status, 409, 'confirmed once');

    assert.equal((await api('PATCH', url, { status: 'dispatched' }, seller.token)).status, 200);
    assert.match((await textsTo('966200200')).at(-1), /Ready to collect at Mutinta Appliances/);
    assert.equal((await api('PATCH', url, { status: 'delivered' }, seller.token)).status, 200);

    // The shop already has the money, so it owes Zed Market the 5% commission.
    const balance = (await api('GET', '/api/seller/payouts', undefined, seller.token)).body;
    assert.equal(balance.onHold, -25);
  });

  test('cancelling before the shop confirms records no refund; after it, the shop must send the money back', async () => {
    const unpaid = (await order('momo')).body;
    await parcel(unpaid.id, 'payment-sent', {}, buyer.token);
    const first = await parcel(unpaid.id, 'cancel', { reason: 'Changed my mind' }, buyer.token);
    assert.equal(first.body.refund, 0);

    const paid = (await order('momo')).body;
    await parcel(paid.id, 'paid', {}, seller.token);
    const second = await parcel(paid.id, 'cancel', { reason: 'Out of stock' }, seller.token);
    assert.equal(second.body.refund, 500);
    assert.match((await textsTo('977100100')).at(-1), /Send K500 back for order/);
    const [refund] = (await api('GET', '/api/admin/refunds?status=due', undefined, admin.token)).body;
    assert.equal(refund.amount, 500);
    assert.equal(refund.heldByShop, true);
    assert.equal((await parcel(paid.id, 'paid', {}, seller.token)).status, 409, 'a cancelled parcel cannot be paid');
  });

  test('pay on delivery needs no confirmation', async () => {
    const o = (await order('cod')).body;
    assert.equal(o.payByMomo, false);
    assert.equal(o.shipments[0].payTo, null);
    assert.equal((await parcel(o.id, 'paid', {}, seller.token)).status, 409);
    const url = `/api/orders/${o.id}/shipments/${seller.shopId}`;
    assert.equal((await api('PATCH', url, { status: 'dispatched' }, seller.token)).status, 200);
  });

  test('a shop without a number can only be paid on delivery, and staff see it on the launch list', async () => {
    await db.query('UPDATE shops SET momo_number = NULL WHERE id = $1', [seller.shopId]);
    const refused = await order('momo');
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /hasn't added a Mobile Money number yet/);
    assert.equal((await order('cod')).status, 201);

    const { setup } = (await api('GET', '/api/admin/stats', undefined, admin.token)).body;
    assert.equal(setup.shopsWithoutMomo, 1);
    assert.equal(setup.commissionSet, false);
    assert.equal(setup.pointsConfirmed, false);
    assert.ok(setup.couriersUnconfirmed.includes('Platinum Couriers'));
  });
});

describe('commission owed by shops', () => {
  const balance = async () => (await api('GET', '/api/seller/payouts', undefined, seller.token)).body;
  const receive = (amount) =>
    api('POST', '/api/admin/commission', { shopId: seller.shopId, amount, method: 'mtn', reference: 'MP2610.7788' }, admin.token);
  const remind = () => api('POST', '/api/admin/commission/remind', { shopId: seller.shopId }, admin.token);

  test('a shop paid directly owes the commission once the return window has passed', async () => {
    assert.equal((await balance()).owed, 0, 'still on hold');
    await db.query(`UPDATE shipments SET delivered_at = now() - interval '8 days' WHERE status = 'delivered'`);
    const b = await balance();
    assert.equal(b.available, -25);
    assert.equal(b.owed, 25);
    assert.equal(b.payTo, null, 'staff have not said where to pay yet');
    assert.equal((await remind()).status, 409, 'no reminder before there is somewhere to pay');
  });

  test('owners set where shops pay; the shop sees it', async () => {
    const account = { network: 'mtn', number: '0966000111', name: 'Zed Market Ltd' };
    assert.equal((await api('PUT', '/api/admin/commission-account', account, seller.token)).status, 403);
    assert.equal((await api('PUT', '/api/admin/commission-account', account, admin.token)).status, 200);
    assert.deepEqual((await balance()).payTo, account);
    const { setup, commissionOwed, commissionOwedShops } = (await api('GET', '/api/admin/stats', undefined, admin.token)).body;
    assert.equal(setup.commissionAccountSet, true);
    assert.equal(commissionOwed, 25);
    assert.equal(commissionOwedShops, 1);
  });

  test('staff remind the shop, record what it pays, and never more than it owes', async () => {
    assert.equal((await remind()).status, 200);
    assert.match((await textsTo('977100100')).at(-1), /Please pay K25 commission\. Send it to MTN MoMo 0966000111 \(Zed Market Ltd\)/);

    const tooMuch = await receive(30);
    assert.equal(tooMuch.status, 409);
    assert.match(tooMuch.body.error, /only owes K25/);

    const part = await receive(10);
    assert.equal(part.status, 201, JSON.stringify(part.body));
    assert.equal(part.body.kind, 'commission');
    let b = await balance();
    assert.equal(b.owed, 15);
    assert.equal(b.commissionPaid, 10);
    assert.equal(b.paidOut, 0, 'commission received is not a payout to the shop');
    assert.match((await textsTo('977100100')).at(-1), /received your K10 commission.*You still owe K15/);

    assert.equal((await receive(15)).status, 201);
    b = await balance();
    assert.equal(b.owed, 0);
    assert.equal(b.available, 0);
    assert.deepEqual(b.history.map((h) => [h.kind, h.amount]), [
      ['commission', 15],
      ['commission', 10],
    ]);
    assert.equal((await remind()).status, 409, 'nothing left to ask for');
    assert.equal((await receive(1)).status, 409);
    const pay = await api('POST', '/api/admin/payouts', { shopId: seller.shopId, amount: 1, method: 'mtn', reference: 'MP1' }, admin.token);
    assert.equal(pay.status, 409, 'paying commission does not create money to pay out');
  });
});

describe('deleting a shop', () => {
  const remove = (shopId, token, reason = 'Asked to close') =>
    api('POST', `/api/admin/shops/${shopId}/delete`, { reason }, token);
  const listed = async () => (await api('GET', '/api/admin/shops', undefined, admin.token)).body.map((s) => s.id);

  test('only owners can delete, and a reason is needed', async () => {
    assert.equal((await remove(seller.shopId, seller.token)).status, 403);
    assert.equal((await remove(seller.shopId, admin.token, '')).status, 400);
    assert.equal((await remove('shop_nope', admin.token)).status, 404);
  });

  test('a shop that never sold anything is removed completely, and its owner can start again', async () => {
    const owner = await signIn('0977300300', { name: 'Bwalya' });
    const body = { ...shopBody, name: 'Bwalya Stores', phone: '0977300300' };
    const shop = (await api('POST', '/api/shops', body, owner.token)).body;
    const product = await api('POST', '/api/products', { name: 'Kettle', category: 'home', price: 200, stock: 5 }, owner.token);
    assert.equal(product.status, 201);
    await api('POST', '/api/seller/coupons', { code: 'BWALYA10', kind: 'percent', value: 10 }, owner.token);

    const res = await remove(shop.id, admin.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { ok: true, kept: false, cancelled: 0 });
    assert.equal((await listed()).includes(shop.id), false);
    assert.equal((await db.query('SELECT 1 FROM shops WHERE id = $1', [shop.id])).length, 0);
    assert.equal((await db.query('SELECT 1 FROM products WHERE id = $1', [product.body.id])).length, 0);
    const [told] = (await api('GET', '/api/notifications', undefined, owner.token)).body;
    assert.match(told.title, /removed your shop Bwalya Stores/);
    assert.equal((await api('POST', '/api/shops', body, owner.token)).status, 201, 'the owner can open a new shop');
  });

  test('a shop with orders is hidden but its buyers keep their history; open parcels are cancelled', async () => {
    const res = await remove(seller.shopId, admin.token, 'Sold fake goods');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.kept, true);
    assert.ok(res.body.cancelled >= 2, 'the parcels not yet delivered were cancelled');

    assert.equal((await listed()).includes(seller.shopId), false);
    assert.equal((await api('GET', `/api/shops/${seller.shopId}`)).status, 404);
    assert.equal((await api('GET', `/api/products/${fanId}`)).status, 404);
    assert.equal((await order('cod')).status, 409, 'nothing more can be ordered from it');

    const mine = (await api('GET', '/api/orders/mine', undefined, buyer.token)).body;
    assert.ok(mine.length > 0);
    assert.ok(mine.every((o) => o.shipments[0].shopName === 'Mutinta Appliances'));
    assert.ok(mine.every((o) => ['delivered', 'cancelled'].includes(o.shipments[0].status)));

    assert.equal((await api('GET', '/api/session/me', undefined, seller.token)).body.shopId, null);
    assert.equal((await remove(seller.shopId, admin.token)).status, 404, 'already deleted');
    const again = await api('POST', '/api/shops', { ...shopBody, name: 'Mutinta Appliances 2' }, seller.token);
    assert.equal(again.status, 201, JSON.stringify(again.body));
  });
});

describe('unpaid Mobile Money orders', () => {
  const ago = (orderId, hours) =>
    db.query(`UPDATE orders SET created_at = now() - make_interval(hours => $2) WHERE id = $1`, [orderId, hours]);
  let shop;
  let fan;

  before(async () => {
    // A fresh shop for these checks (the earlier one was deleted).
    shop = (await api('GET', '/api/session/me', undefined, seller.token)).body.shopId;
    await api('PATCH', `/api/admin/shops/${shop}/verification`, { status: 'verified' }, admin.token);
    fan = (await api('POST', '/api/products', { name: 'Desk Fan', category: 'home', price: 300, stock: 10 }, seller.token)).body.id;
  });
  const place = async () =>
    (
      await api(
        'POST',
        '/api/orders',
        { items: [{ productId: fan, qty: 1 }], shipping, couriers: { [shop]: 'pickup' }, payment: 'momo' },
        buyer.token,
      )
    ).body;

  test('the buyer is reminded halfway, then an unpaid parcel is cancelled and its stock comes back', async () => {
    const { checkUnpaidOrders } = await import('./jobs.js');
    const o = await place();
    assert.deepEqual(await checkUnpaidOrders(db), { buyersReminded: 0, shopsReminded: 0, cancelled: 0 }, 'too early');

    await ago(o.id, 13);
    assert.equal((await checkUnpaidOrders(db)).buyersReminded, 1);
    assert.match((await textsTo('966200200')).at(-1), /Reminder: pay K300 to Airtel Money 0977555123. Order .*: pay by .* or it will be cancelled/);
    assert.equal((await checkUnpaidOrders(db)).buyersReminded, 0, 'reminded once');

    await ago(o.id, 25);
    assert.equal((await checkUnpaidOrders(db)).cancelled, 1);
    const [mine] = (await api('GET', '/api/orders/mine', undefined, buyer.token)).body.filter((x) => x.id === o.id);
    assert.equal(mine.shipments[0].status, 'cancelled');
    assert.equal(mine.shipments[0].cancelReason, 'Not paid within 24 hours');
    assert.equal((await api('GET', `/api/products/${fan}`)).body.stock, 10, 'stock is back on sale');
    assert.match((await textsTo('977100100')).at(-1), /Order .* was cancelled.*didn't pay within 24 hours/);
  });

  test('a payment the buyer says they sent is never cancelled; the shop is reminded instead', async () => {
    const { checkUnpaidOrders } = await import('./jobs.js');
    const o = await place();
    await api('POST', `/api/orders/${o.id}/shipments/${shop}/payment-sent`, { reference: 'MP99' }, buyer.token);
    await ago(o.id, 30);
    await db.query(`UPDATE shipments SET payment_sent_at = now() - interval '13 hours' WHERE order_id = $1`, [o.id]);
    const done = await checkUnpaidOrders(db);
    assert.equal(done.cancelled, 0);
    assert.equal(done.shopsReminded, 1);
    assert.match((await textsTo('977100100')).at(-1), /Please check the payment for order .*MP99/);
  });

  test('owners change the time limit', async () => {
    assert.equal((await api('PATCH', '/api/admin/settings', { unpaidCancelHours: 1 }, admin.token)).status, 400);
    assert.equal((await api('PATCH', '/api/admin/settings', { unpaidCancelHours: 48 }, admin.token)).status, 200);
    assert.equal((await api('GET', '/api/settings')).body.unpaidCancelHours, 48);
  });

  test('staff confirm a payment for a shop, with a reason, and can then send the parcel', async () => {
    const o = await place();
    const confirm = (note, token = admin.token) =>
      api('POST', `/api/admin/orders/${o.id}/shipments/${shop}/paid`, { note }, token);
    assert.equal((await confirm('Shop confirmed by phone', seller.token)).status, 403);
    assert.equal((await confirm('')).status, 400, 'a reason is needed');
    const ok = await confirm('Shop confirmed by phone');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.shipments[0].paid, true);
    assert.match((await textsTo('977100100')).at(-1), /Zed Market confirmed the payment/);
    assert.equal((await confirm('Again')).status, 409);
    const sentNow = await api(
      'PATCH',
      `/api/admin/orders/${o.id}/shipments/${shop}/status`,
      { status: 'dispatched', note: 'Shop asked us to' },
      admin.token,
    );
    assert.equal(sentNow.status, 200);
    const log = (await api('GET', '/api/admin/actions', undefined, admin.token)).body;
    assert.ok(log.some((a) => a.action === 'payment confirmed' && /Shop confirmed by phone/.test(a.note)));
  });
});
