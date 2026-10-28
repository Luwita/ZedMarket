import { newId } from './http.js';

// In-app notifications (the bell). Orders, payments, cancellations, returns, refunds, payouts, quotes and shop
// decisions are shown here and on the Notifications page; nothing is sent by text message.
// `q` is the database or the current transaction.
export async function notify(q, userId, { kind, title, body = '', link = null }) {
  if (!userId) return;
  await q.query('INSERT INTO notifications (id, user_id, kind, title, body, link) VALUES ($1, $2, $3, $4, $5, $6)', [
    newId('ntf'),
    userId,
    kind,
    title,
    body.slice(0, 300),
    link,
  ]);
}

export async function notifyShopOwner(q, shopId, message) {
  const [shop] = await q.query('SELECT owner_id FROM shops WHERE id = $1', [shopId]);
  if (shop?.owner_id) await notify(q, shop.owner_id, message);
}

export async function notifyBuyerOfOrder(q, orderId, message) {
  const [order] = await q.query('SELECT buyer_id FROM orders WHERE id = $1', [orderId]);
  if (order) await notify(q, order.buyer_id, message);
}
