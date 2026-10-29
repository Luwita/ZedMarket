import { Router } from 'express';
import { z } from 'zod';
import { momoNetworkName } from '../../src/data/catalog.js';
import { collectPlace } from '../../src/data/couriers.js';
import { OrderError, priceOrder } from '../../src/data/pricing.js';
import { requireUser } from '../auth.js';
import { HttpError, newId, newOrderId, parse } from '../http.js';
import { toProduct, toShop } from '../mappers.js';
import { getSettings } from '../settings.js';
import { loadDelivery } from '../delivery.js';
import { formatK } from '../../src/utils/format.js';
import { notify, notifyBuyerOfOrder, notifyShopOwner } from '../notify.js';
import { cancelShipment, isLive, loadOrders, myShopOrFail } from '../queries.js';
import { orderQuoteSchema, orderSchema } from '../schemas.js';

const PAYMENT_NAMES = { momo: 'Mobile Money', cod: 'Pay on Delivery' };
const reference = z.string().trim().max(40).optional();

const SHIPMENT_FLOW = { pending: 'dispatched', dispatched: 'delivered' };

// The buyer's discount code, checked against every shop in the cart. Returns { [shopId]: coupon }.
async function loadCoupons(q, code, shopIds, buyerId, lock) {
  if (!code) return { coupons: {}, rows: [] };
  const rows = await q.query(
    `SELECT * FROM coupons WHERE upper(code) = upper($1) AND shop_id = ANY($2) AND active ${lock ? 'FOR UPDATE' : ''}`,
    [code, shopIds],
  );
  if (!rows.length) throw new OrderError(`${code.toUpperCase()} isn't a valid code for the shops in your cart`);
  for (const c of rows) {
    if (c.ends_at && new Date(c.ends_at) < new Date()) throw new OrderError(`${c.code} has expired`);
    if (c.max_uses && c.uses >= c.max_uses) throw new OrderError(`${c.code} has been fully used`);
    const [used] = await q.query(
      `SELECT 1 FROM shipments s JOIN orders o ON o.id = s.order_id
        WHERE o.buyer_id = $1 AND s.shop_id = $2 AND upper(s.coupon_code) = upper($3) AND s.status <> 'cancelled'
        LIMIT 1`,
      [buyerId, c.shop_id, c.code],
    );
    if (used) throw new OrderError(`You have already used ${c.code}`);
  }
  const coupons = Object.fromEntries(
    rows.map((c) => [c.shop_id, { code: c.code, kind: c.kind, value: Number(c.value), minSpend: Number(c.min_spend) }]),
  );
  return { coupons, rows };
}

// Prices a cart for a buyer from the database. With `lock`, rows are locked for the order transaction.
async function priceForBuyer(q, user, body, lock) {
  await loadDelivery(q); // the latest courier rates and Zed Market Points saved by staff
  const lockSql = lock ? 'FOR UPDATE' : '';
  const products = (
    await q.query(`SELECT * FROM products WHERE id = ANY($1) AND deleted_at IS NULL ${lockSql}`, [
      [...new Set(body.items.map((i) => i.productId))],
    ])
  ).map(toProduct);
  const shopIds = [...new Set(products.map((p) => p.shopId))];
  const shopRows = await q.query('SELECT * FROM shops WHERE id = ANY($1)', [shopIds]);
  const closed = shopRows.find((r) => !isLive(r));
  if (closed) throw new HttpError(409, `${closed.name} is not taking orders at the moment`);
  const shops = shopRows.map(toShop);

  // Accepted, unexpired price requests of this buyer.
  const quoteIds = body.items.map((i) => i.quoteId).filter(Boolean);
  const quoteRows = quoteIds.length
    ? await q.query(
        `SELECT * FROM price_requests
          WHERE id = ANY($1) AND buyer_id = $2 AND status = 'accepted' AND valid_until > now() ${lockSql}`,
        [quoteIds, user.id],
      )
    : [];
  const quotes = Object.fromEntries(
    quoteRows.map((r) => [r.id, { productId: r.product_id, qty: r.qty, price: Number(r.quoted_price) }]),
  );

  // A Zed Market voucher of this buyer that is unused and unexpired.
  let voucherRow = null;
  if (body.voucherId) {
    [voucherRow] = await q.query(
      `SELECT * FROM vouchers WHERE id = $1 AND user_id = $2 AND used_order_id IS NULL AND expires_at > now() ${lockSql}`,
      [body.voucherId, user.id]
    );
    if (!voucherRow) throw new HttpError(409, 'That voucher has been used or has expired');
  }

  try {
    const { coupons, rows: couponRows } = await loadCoupons(q, body.coupon, shopIds, user.id, lock);
    const priced = priceOrder({
      lines: body.items,
      getProduct: (id) => products.find((p) => p.id === id),
      getShop: (id) => shops.find((s) => s.id === id),
      to: { province: body.shipping.province, town: body.shipping.town, lat: body.shipping.lat, lng: body.shipping.lng },
      picks: body.couriers,
      payment: body.payment,
      coupons,
      quotes,
      voucher: voucherRow && { amount: Number(voucherRow.amount), minSpend: Number(voucherRow.min_spend) },
      pickupPoint: body.pickupPoint,
    });
    return { priced, couponRows, voucherRow };
  } catch (err) {
    if (err instanceof OrderError) throw new HttpError(409, err.message);
    throw err;
  }
}

// When an invited buyer's first parcel is delivered, the friend who invited them gets a reward voucher (once).
async function rewardInviter(t, orderId) {
  const [buyer] = await t.query(
    'SELECT u.id, u.name, u.referred_by FROM orders o JOIN users u ON u.id = o.buyer_id WHERE o.id = $1',
    [orderId]
  );
  if (!buyer?.referred_by) return;
  const { referralReward, voucherMinSpend, voucherDays } = await getSettings(t);
  const rows = await t.query(
    `INSERT INTO vouchers (id, user_id, amount, min_spend, reason, related_user_id, expires_at)
     VALUES ($1, $2, $3, $4, 'referral', $5, now() + make_interval(days => $6))
     ON CONFLICT (user_id, related_user_id) WHERE reason = 'referral' DO NOTHING RETURNING id`,
    [newId('vch'), buyer.referred_by, referralReward, voucherMinSpend, buyer.id, voucherDays]
  );
  if (rows.length) {
    await notify(t, buyer.referred_by, {
      kind: 'voucher',
      title: `You earned K${referralReward}!`,
      body: `${buyer.name.split(' ')[0]} got their first order. Here's a voucher for your next one.`,
      link: '/account?tab=invite',
    });
  }
}

export function orderRoutes(db) {
  const router = Router();
  router.use(requireUser);

  // Exact totals for checkout (discount codes, agreed prices, delivery) without placing the order.
  router.post('/quote', async (req, res) => {
    const { priced } = await priceForBuyer(db, req.user, parse(orderQuoteSchema, req.body), false);
    res.json(priced);
  });

  router.post('/', async (req, res) => {
    const body = parse(orderSchema, req.body);

    const order = await db.tx(async (t) => {
      // Lock products, codes and agreed prices so two buyers can't take the last item or the last code use.
      const { priced, couponRows, voucherRow } = await priceForBuyer(t, req.user, body, true);

      const id = newOrderId();
      // Zed Market never holds the money: Mobile Money goes straight to each shop's number, and the shop
      // confirms it arrived before sending the parcel.
      const byMomo = body.payment === 'momo';
      const paymentStatus = byMomo ? 'momo_direct' : 'cod_due';
      const momoOf = Object.fromEntries(
        (
          await t.query('SELECT id, momo_network, momo_number, momo_name FROM shops WHERE id = ANY($1)', [
            priced.shipments.map((s) => s.shopId),
          ])
        ).map((r) => [r.id, r]),
      );
      const [row] = await t.query(
        `INSERT INTO orders (id, buyer_id, buyer_name, buyer_phone, province, town, address, payment_method,
                             payment_status, subtotal, discount, delivery, total, voucher_id, voucher_discount, lat, lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
        [
          id,
          req.user.id,
          body.shipping.name,
          body.shipping.phone,
          body.shipping.province,
          body.shipping.town,
          body.shipping.address,
          PAYMENT_NAMES[body.payment],
          paymentStatus,
          priced.subtotal,
          priced.discount,
          priced.delivery,
          priced.total,
          voucherRow?.id ?? null,
          priced.voucherDiscount,
          body.shipping.lat ?? null,
          body.shipping.lng ?? null,
        ],
      );
      if (voucherRow) await t.query('UPDATE vouchers SET used_order_id = $2 WHERE id = $1', [voucherRow.id, id]);
      const { commissionRate } = await getSettings(t);
      for (const s of priced.shipments) {
        const shipmentId = newId('shp');
        await t.query(
          `INSERT INTO shipments (id, order_id, shop_id, courier, courier_name, fee, eta, subtotal, discount, coupon_code,
                                  voucher_discount, pickup_point, commission_rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            shipmentId,
            id,
            s.shopId,
            s.courier,
            s.courierName,
            s.fee,
            s.eta,
            s.subtotal,
            s.discount,
            s.couponCode,
            s.voucherDiscount,
            s.pickupPoint,
            commissionRate,
          ],
        );
        const units = s.items.reduce((n, i) => n + i.qty, 0);
        const due = formatK(s.subtotal - s.discount - s.voucherDiscount + s.fee);
        await notifyShopOwner(t, s.shopId, {
          kind: 'order',
          title: `New order ${id}`,
          body: `${units} item${units > 1 ? 's' : ''} worth ${formatK(s.subtotal - s.discount)} for ${body.shipping.town}. ${
            byMomo
              ? `Wait for ${due} on your Mobile Money, confirm it in My shop, then send the parcel.`
              : 'Please send it soon.'
          }`,
          link: '/seller?tab=orders',
        });
        if (byMomo) {
          const momo = momoOf[s.shopId];
          await notify(t, req.user.id, {
            kind: 'payment',
            title: `Pay ${due} to ${momoNetworkName(momo.momo_network)} 0${momo.momo_number}`,
            body: `Name: ${momo.momo_name}. For order ${id} from ${s.shopName}. Then tap "I've paid" in My orders.`,
            link: '/account',
          });
        }
        for (const item of s.items) {
          await t.query(
            `INSERT INTO order_items (id, shipment_id, product_id, name, options, qty, unit_price, price_request_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [newId('itm'), shipmentId, item.id, item.name, item.options, item.qty, item.price, item.quoteId],
          );
          await t.query('UPDATE products SET stock = stock - $2, sold = sold + $2 WHERE id = $1', [item.id, item.qty]);
          if (item.quoteId) {
            await t.query(`UPDATE price_requests SET status = 'ordered', updated_at = now() WHERE id = $1`, [
              item.quoteId,
            ]);
          }
        }
      }
      const usedCoupons = couponRows.filter((c) => priced.shipments.some((s) => s.shopId === c.shop_id));
      for (const c of usedCoupons) await t.query('UPDATE coupons SET uses = uses + 1 WHERE id = $1', [c.id]);
      return row;
    });

    const [full] = await loadOrders(db, [order]);
    res.status(201).json(full);
  });

  // The buyer, or the shop (e.g. out of stock), cancels a parcel that hasn't been sent yet.
  router.post('/:orderId/shipments/:shopId/cancel', async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(2, 'Tell us why').max(300) }), req.body);
    const [order] = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.orderId]);
    if (!order) throw new HttpError(404, 'Order not found');
    const by = order.buyer_id === req.user.id ? 'buyer' : req.user.shopId === req.params.shopId ? 'seller' : null;
    if (!by) throw new HttpError(404, 'Order not found');
    const result = await db.tx((t) => cancelShipment(t, order.id, req.params.shopId, by, reason));
    const [full] = await loadOrders(db, [order], by === 'seller' ? req.params.shopId : null);
    res.json({ order: full, refund: result.refund });
  });

  // The buyer says they have sent the Mobile Money for a parcel, with their transaction ID if they have it.
  router.post('/:orderId/shipments/:shopId/payment-sent', async (req, res) => {
    const body = parse(z.object({ reference }), req.body ?? {});
    const [order] = await db.query('SELECT * FROM orders WHERE id = $1 AND buyer_id = $2', [
      req.params.orderId,
      req.user.id,
    ]);
    if (!order) throw new HttpError(404, 'Order not found');
    await db.tx(async (t) => {
      const s = await unpaidMomoParcel(t, order, req.params.shopId);
      await t.query('UPDATE shipments SET payment_sent_at = now(), payment_ref = $2, updated_at = now() WHERE id = $1', [
        s.id,
        body.reference || null,
      ]);
      await notifyShopOwner(t, s.shop_id, {
        kind: 'payment',
        title: `Payment sent for order ${order.id}`,
        body: `${order.buyer_name} says they sent ${formatK(amountDue(s))} to your Mobile Money${
          body.reference ? ` (ID ${body.reference})` : ''
        }. Check it has arrived, then confirm it in My shop.`,
        link: '/seller?tab=orders',
      });
    });
    const [full] = await loadOrders(db, [order]);
    res.json(full);
  });

  // The shop confirms the buyer's Mobile Money has arrived. Only then can the parcel be sent.
  router.post('/:orderId/shipments/:shopId/paid', async (req, res) => {
    const shop = await myShopOrFail(db, req.user);
    if (shop.id !== req.params.shopId) throw new HttpError(403, 'You can only update your own parcels');
    const order = await confirmPayment(db, req.params.orderId, shop);
    const [full] = await loadOrders(db, [order], shop.id);
    res.json(full);
  });

  router.get('/mine', async (req, res) => {
    const rows = await db.query('SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(await loadOrders(db, rows));
  });

  // Orders containing a parcel from the signed-in owner's shop (only that shop's parcel is included).
  router.get('/shop', async (req, res) => {
    const shop = await myShopOrFail(db, req.user);
    const rows = await db.query(
      `SELECT o.* FROM orders o WHERE EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.shop_id = $1)
        ORDER BY o.created_at DESC`,
      [shop.id],
    );
    res.json(await loadOrders(db, rows, shop.id));
  });

  router.patch('/:orderId/shipments/:shopId', async (req, res) => {
    const shop = await myShopOrFail(db, req.user);
    if (shop.id !== req.params.shopId) throw new HttpError(403, 'You can only update your own parcels');
    const update = parse(shipmentUpdateSchema, req.body);
    if (update.status === 'delivered') {
      throw new HttpError(403, 'Your buyer confirms delivery from their account, then you are told. You can mark a parcel sent.');
    }
    await advanceShipment(db, req.params.orderId, shop, update);
    const [order] = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.orderId]);
    const [full] = await loadOrders(db, [order], shop.id);
    res.json(full);
  });

  // The buyer says the parcel reached them. This is what marks it delivered, and tells the shop.
  router.post('/:orderId/shipments/:shopId/received', async (req, res) => {
    const [order] = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.orderId]);
    if (!order || order.buyer_id !== req.user.id) throw new HttpError(404, 'Order not found');
    const [shop] = await db.query('SELECT * FROM shops WHERE id = $1', [req.params.shopId]);
    if (!shop) throw new HttpError(404, 'Order not found');
    await advanceShipment(db, order.id, shop, { status: 'delivered' }, { confirmedBy: order.buyer_name || 'The buyer' });
    const [full] = await loadOrders(db, [order]);
    res.json(full);
  });

  return router;
}

// Records that a parcel's Mobile Money payment reached the shop, and tells the buyer. Used by the shop, and by
// staff on the shop's behalf (`extra(t, parcel)` runs in the same transaction, e.g. to log it). Returns the order.
export async function confirmPayment(db, orderId, shop, extra = null) {
  const [order] = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!order) throw new HttpError(404, 'Order not found');
  await db.tx(async (t) => {
    const s = await unpaidMomoParcel(t, order, shop.id);
    await t.query('UPDATE shipments SET paid_at = now(), updated_at = now() WHERE id = $1', [s.id]);
    await notify(t, order.buyer_id, {
      kind: 'payment',
      title: `${shop.name} received your payment`,
      body: `${formatK(amountDue(s))} for order ${order.id}. Your parcel is being prepared.`,
      link: '/account',
    });
    if (extra) await extra(t, s);
  });
  return order;
}

const amountDue = (s) => Number(s.subtotal) - Number(s.discount) - Number(s.voucher_discount) + Number(s.fee);

// A parcel still waiting for its Mobile Money payment, locked for the current transaction.
async function unpaidMomoParcel(t, order, shopId) {
  const [s] = await t.query('SELECT * FROM shipments WHERE order_id = $1 AND shop_id = $2 FOR UPDATE', [
    order.id,
    shopId,
  ]);
  if (!s) throw new HttpError(404, 'Order not found');
  if (order.payment_status !== 'momo_direct') throw new HttpError(409, "This order isn't paid by Mobile Money");
  if (s.status === 'cancelled') throw new HttpError(409, 'This parcel was cancelled');
  if (s.paid_at) throw new HttpError(409, 'This payment has already been confirmed');
  return s;
}

export const shipmentUpdateSchema = z.object({
  status: z.enum(['dispatched', 'delivered']),
  tracking: z.string().trim().max(60).optional(),
});

// Moves a parcel to its next status and tells the buyer. Used by the shop, and by staff on the shop's behalf.
// `confirmedBy` is set when the buyer (or the auto-confirm after a few days) is the one marking it delivered.
export async function advanceShipment(db, orderId, shop, body, { confirmedBy = null, auto = false } = {}) {
  const [current] = await db.query(
    `SELECT s.status, s.paid_at, o.payment_status FROM shipments s JOIN orders o ON o.id = s.order_id
      WHERE s.order_id = $1 AND s.shop_id = $2`,
    [orderId, shop.id],
  );
  if (!current) throw new HttpError(404, 'Order not found');
  if (SHIPMENT_FLOW[current.status] !== body.status) {
    throw new HttpError(409, `A ${current.status} parcel can't be marked ${body.status}`);
  }
  if (current.payment_status === 'momo_direct' && !current.paid_at) {
    throw new HttpError(409, "Confirm the buyer's Mobile Money payment before sending this parcel");
  }
  await db.tx(async (t) => {
    const [s] = await t.query(
      `UPDATE shipments SET status = $3, tracking = COALESCE($4, tracking), updated_at = now(),
              delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE delivered_at END
        WHERE order_id = $1 AND shop_id = $2 RETURNING *`,
      [orderId, shop.id, body.status, body.tracking ?? null]
    );
    const pickupHere = s.courier === 'pickup';
    const office = collectPlace(s.courier);
    const [{ town }] = await t.query('SELECT town FROM orders WHERE id = $1', [orderId]);
    await notifyBuyerOfOrder(t, orderId, {
      kind: 'order',
      title:
        body.status === 'delivered'
          ? `Delivered: your order from ${shop.name}`
          : pickupHere
            ? `Ready to collect at ${shop.name}`
            : s.courier === 'point'
              ? `On its way to your Zed Market Point`
              : office
                ? `On its way to the ${office} in ${town}`
                : `On its way: your order from ${shop.name}`,
      body:
        body.status === 'delivered'
          ? 'Happy with it? Rate your items. Something wrong? You can report a problem within 7 days.'
          : [
              s.courier_name,
              s.tracking && `tracking ${s.tracking}`,
              s.pickup_point,
              office && `Collect it with order number ${orderId} and your ID`,
              'When you have it, press "I\'ve received it" in your orders',
            ]
              .filter(Boolean)
              .join(' · '),
      link: '/account',
    });
    if (body.status === 'delivered') {
      await rewardInviter(t, orderId);
      await notifyShopOwner(t, shop.id, {
        kind: 'order',
        title: `Delivered: order ${orderId}`,
        body: auto
          ? 'The buyer did not respond within a few days, so it was marked delivered automatically.'
          : confirmedBy
            ? `${confirmedBy} confirmed they received the parcel.`
            : 'Zed Market marked the parcel delivered.',
        link: '/seller?tab=orders',
      });
    }
  });
}
