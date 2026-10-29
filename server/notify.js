import { newId } from './http.js';

// Notifications people must not miss also go out by email, when an email provider is set up: orders, payments,
// cancellations, returns, refunds, payouts, price quotes and offers, and decisions about a shop. Vouchers,
// announcements, listings and support replies stay in the app only, so a campaign to everyone never sends
// thousands of emails.
const EMAIL_KINDS = new Set(['order', 'payment', 'cancelled', 'case', 'refund', 'payout', 'quote', 'offer', 'shop']);

let mailer = null;
let siteUrl = '';
// Called once when the API starts. Without a real provider (or with `null`) notifications stay in the app only.
export function sendNotificationsByEmail(sender, site = '') {
  mailer = sender && sender.provider !== 'console' ? sender : null;
  siteUrl = site.replace(/\/+$/, '');
}

export function emailText(title, body = '', link = null) {
  const open = link && siteUrl ? `\n\nOpen it: ${siteUrl}${link}` : siteUrl ? `\n\nOpen Zed Market: ${siteUrl}` : '';
  return `${[title, body].filter(Boolean).join('\n\n')}${open}\n\n-- Zed Market`;
}

// In-app notifications (the bell), with an email copy for the important ones.
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
  if (!mailer || !EMAIL_KINDS.has(kind)) return;
  const [user] = await q.query('SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (!user?.email) return;
  // An email that can't be sent never fails the order or payment it belongs to; the bell still has it.
  const send = () =>
    Promise.resolve()
      .then(() => mailer.send(user.email, title, emailText(title, body, link)))
      .catch((err) => console.error(`[email] notification not sent to ${user.email}: ${err.message}`));
  if (q.afterCommit) q.afterCommit(send);
  else send();
}

export async function notifyShopOwner(q, shopId, message) {
  const [shop] = await q.query('SELECT owner_id FROM shops WHERE id = $1', [shopId]);
  if (shop?.owner_id) await notify(q, shop.owner_id, message);
}

export async function notifyBuyerOfOrder(q, orderId, message) {
  const [order] = await q.query('SELECT buyer_id FROM orders WHERE id = $1', [orderId]);
  if (order) await notify(q, order.buyer_id, message);
}
