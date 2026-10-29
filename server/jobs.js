import { momoNetworkName } from '../src/data/catalog.js';
import { formatK } from '../src/utils/format.js';
import { HttpError } from './http.js';
import { notify, notifyShopOwner } from './notify.js';
import { cancelShipment } from './queries.js';
import { advanceShipment } from './routes/orders.js';
import { autoDeliverHours, REMIND_BEFORE_HOURS } from '../src/data/couriers.js';
import { getSettings } from './settings.js';

const MOMO_PARCELS = `FROM shipments s JOIN orders o ON o.id = s.order_id JOIN shops sh ON sh.id = s.shop_id
  WHERE o.payment_status = 'momo_direct' AND s.status = 'pending' AND s.paid_at IS NULL`;

const due = (s) => Number(s.subtotal) - Number(s.discount) - Number(s.voucher_discount) + Number(s.fee);
const zambiaTime = (date) =>
  new Date(date).toLocaleString('en-GB', {
    timeZone: 'Africa/Lusaka',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Mobile Money orders nobody pays for would keep their stock locked, so:
//  - halfway to the limit, the buyer is reminded where to pay and by when;
//  - at the limit, the parcel is cancelled (stock back on sale) and both sides are told;
//  - if the buyer says they paid but the shop hasn't confirmed by halfway, the shop is reminded instead, and the
//    parcel is never cancelled automatically (the money may really have been sent).
// The limit is "Cancel unpaid orders after" in Admin → Settings. Returns what was done, for logs and tests.
export async function checkUnpaidOrders(db) {
  const { unpaidCancelHours: hours } = await getSettings(db);
  const done = { buyersReminded: 0, shopsReminded: 0, cancelled: 0 };

  const toRemind = await db.query(
    `SELECT s.*, o.buyer_id, o.created_at AS ordered_at, sh.name AS shop_name, sh.momo_network, sh.momo_number, sh.momo_name
       ${MOMO_PARCELS} AND s.payment_sent_at IS NULL AND s.payment_reminded_at IS NULL
        AND o.created_at < now() - make_interval(secs => $1 * 1800) AND o.created_at >= now() - make_interval(hours => $1)`,
    [hours],
  );
  for (const s of toRemind) {
    await db.tx(async (t) => {
      const claimed = await t.query(
        'UPDATE shipments SET payment_reminded_at = now() WHERE id = $1 AND payment_reminded_at IS NULL RETURNING id',
        [s.id],
      );
      if (!claimed.length) return;
      const deadline = zambiaTime(new Date(new Date(s.ordered_at).getTime() + hours * 3600e3));
      await notify(t, s.buyer_id, {
        kind: 'payment',
        title: s.momo_number
          ? `Reminder: pay ${formatK(due(s))} to ${momoNetworkName(s.momo_network)} 0${s.momo_number}`
          : `Reminder: pay ${formatK(due(s))} to ${s.shop_name}`,
        body: `Order ${s.order_id} from ${s.shop_name}: pay by ${deadline} or it will be cancelled.`,
        link: '/account',
      });
      done.buyersReminded += 1;
    });
  }

  const toConfirm = await db.query(
    `SELECT s.*, o.buyer_name ${MOMO_PARCELS} AND s.payment_sent_at IS NOT NULL AND s.shop_reminded_at IS NULL
        AND s.payment_sent_at < now() - make_interval(secs => $1 * 1800)`,
    [hours],
  );
  for (const s of toConfirm) {
    await db.tx(async (t) => {
      const claimed = await t.query(
        'UPDATE shipments SET shop_reminded_at = now() WHERE id = $1 AND shop_reminded_at IS NULL RETURNING id',
        [s.id],
      );
      if (!claimed.length) return;
      await notifyShopOwner(t, s.shop_id, {
        kind: 'payment',
        title: `Please check the payment for order ${s.order_id}`,
        body: `${s.buyer_name} says they sent ${formatK(due(s))}${s.payment_ref ? ` (ID ${s.payment_ref})` : ''}. Confirm it in My shop, or call the buyer if it hasn't arrived.`,
        link: '/seller?tab=orders',
      });
      done.shopsReminded += 1;
    });
  }

  const toCancel = await db.query(
    `SELECT s.order_id, s.shop_id ${MOMO_PARCELS} AND s.payment_sent_at IS NULL
        AND o.created_at < now() - make_interval(hours => $1)`,
    [hours],
  );
  for (const s of toCancel) {
    try {
      await db.tx(async (t) => {
        const reason = `Not paid within ${hours} hours`;
        await cancelShipment(t, s.order_id, s.shop_id, 'admin', reason);
        await notifyShopOwner(t, s.shop_id, {
          kind: 'cancelled',
          title: `Order ${s.order_id} was cancelled`,
          body: `The buyer didn't pay within ${hours} hours. The stock is back on sale.`,
          link: '/seller?tab=orders',
        });
      });
      done.cancelled += 1;
    } catch (err) {
      // Paid, sent or cancelled by someone in the meantime: nothing to do.
      if (!(err instanceof HttpError)) throw err;
    }
  }
  return done;
}

// Buyers confirm delivery themselves. A few hours before a parcel would be marked delivered automatically, the buyer is
// asked once whether it arrived (and told they can report a problem). If they still haven't answered when the time is up
// (see autoDeliverHours for how long), it is marked delivered so the shop is still paid. A parcel with an open problem
// report is left for staff to settle. Returns what was done.
export async function autoConfirmDelivered(db) {
  const parcels = await db.query(
    `SELECT s.id, s.order_id, s.shop_id, s.courier, s.receipt_reminded_at, o.buyer_id, sh.name AS shop_name,
            (o.province = sh.province) AS same_province,
            EXTRACT(EPOCH FROM (now() - s.updated_at)) / 3600 AS age_hours
       FROM shipments s JOIN orders o ON o.id = s.order_id JOIN shops sh ON sh.id = s.shop_id
      WHERE s.status = 'dispatched'
        AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.shipment_id = s.id AND c.status IN ('open', 'rejected', 'escalated'))`,
  );
  const done = { delivered: 0, reminded: 0 };
  for (const p of parcels) {
    const window = autoDeliverHours(p.courier, p.same_province);
    try {
      if (Number(p.age_hours) >= window) {
        const [shop] = await db.query('SELECT * FROM shops WHERE id = $1', [p.shop_id]);
        await advanceShipment(db, p.order_id, shop, { status: 'delivered' }, { auto: true });
        done.delivered += 1;
      } else if (Number(p.age_hours) >= window - REMIND_BEFORE_HOURS && !p.receipt_reminded_at) {
        await db.tx(async (t) => {
          const claimed = await t.query(
            'UPDATE shipments SET receipt_reminded_at = now() WHERE id = $1 AND receipt_reminded_at IS NULL RETURNING id',
            [p.id],
          );
          if (!claimed.length) return;
          await notify(t, p.buyer_id, {
            kind: 'order',
            title: `Did your order from ${p.shop_name} arrive?`,
            body: `Order ${p.order_id}: press "I've received it" in your orders. If something is wrong, report a problem now. Otherwise we will mark it delivered in about ${REMIND_BEFORE_HOURS} hours.`,
            link: '/account',
          });
          done.reminded += 1;
        });
      }
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
  }
  return done;
}

// Runs the checks now and then every `minutes`. On a host that sleeps when idle, they run again on waking.
export function startJobs(db, { minutes = 10 } = {}) {
  const run = () =>
    checkUnpaidOrders(db)
      .then((d) => {
        if (d.buyersReminded || d.shopsReminded || d.cancelled) console.log('[jobs] unpaid orders:', JSON.stringify(d));
        return autoConfirmDelivered(db);
      })
      .then((n) => (n.delivered || n.reminded) && console.log('[jobs] parcels:', JSON.stringify(n)))
      .catch((err) => console.error(`[jobs] check failed: ${err.message}`));
  run();
  return setInterval(run, minutes * 60e3).unref();
}
