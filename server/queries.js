// Database helpers shared by several route files.
import { categories } from '../src/data/catalog.js';
import { expandSearch } from '../src/data/search.js';
import { formatK } from '../src/utils/format.js';
import { HttpError, newId } from './http.js';
import { notify, notifyShopOwner } from './notify.js';
import { toOrder, toProduct } from './mappers.js';

// Buyers only see shops that staff have approved and that aren't suspended.
export const LIVE_SHOP = `(sh.verification = 'verified' AND sh.suspended_at IS NULL)`;
export const isLive = (shopRow) => shopRow.verification === 'verified' && !shopRow.suspended_at;

export async function myShopOrFail(db, user) {
  if (!user.shopId) throw new HttpError(403, 'Open a shop first');
  const [shop] = await db.query('SELECT * FROM shops WHERE id = $1', [user.shopId]);
  return shop;
}

// Orders with their parcels and items; `shopId` limits parcels to one shop (the seller's view).
export async function loadOrders(db, orderRows, shopId = null) {
  if (!orderRows.length) return [];
  const shipments = await db.query(
    `SELECT s.*, sh.name AS shop_name, sh.province AS shop_province, sh.town AS shop_town, sh.area AS shop_area, sh.phone AS shop_phone,
            sh.tpin AS shop_tpin, sh.vat_registered AS shop_vat_registered,
            sh.momo_network AS shop_momo_network, sh.momo_number AS shop_momo_number, sh.momo_name AS shop_momo_name,
            (SELECT json_build_object('id', c.id, 'status', c.status, 'kind', c.kind, 'resolution', c.resolution)
               FROM cases c WHERE c.shipment_id = s.id ORDER BY c.created_at DESC LIMIT 1) AS latest_case,
            (SELECT COALESCE(sum(r.amount), 0) FROM refunds r WHERE r.shipment_id = s.id) AS refunded,
            (SELECT bool_and(r.status = 'paid') FROM refunds r WHERE r.shipment_id = s.id) AS refunds_paid,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'product_id', i.product_id, 'name', i.name, 'options', i.options, 'qty', i.qty,
                       'unit_price', i.unit_price, 'price_request_id', i.price_request_id,
                       'review_rating', (SELECT r.rating FROM reviews r WHERE r.order_id = s.order_id AND r.product_id = i.product_id)
                     ) ORDER BY i.name, i.options)
                FROM order_items i WHERE i.shipment_id = s.id), '[]') AS items
       FROM shipments s JOIN shops sh ON sh.id = s.shop_id
      WHERE s.order_id = ANY($1) AND ($2::text IS NULL OR s.shop_id = $2)
      ORDER BY sh.name`,
    [orderRows.map((o) => o.id), shopId],
  );
  return orderRows.map((o) =>
    toOrder(
      o,
      shipments.filter((s) => s.order_id === o.id),
    ),
  );
}

const productParams = (p) => [
  p.name,
  p.category,
  categories.find((c) => c.id === p.category).icon,
  p.description || p.name,
  p.price,
  p.oldPrice ?? null,
  JSON.stringify(p.tiers),
  p.stock,
  p.local,
  JSON.stringify(p.images),
  p.weightKg,
  JSON.stringify(p.options),
  p.lowStockAt,
  p.sourceProductId || null,
];

export async function insertProduct(q, shopId, p) {
  const [row] = await q.query(
    `INSERT INTO products (id, shop_id, badge, name, category, icon, description, price, old_price, tiers, stock, local,
                           images, weight_kg, options, low_stock_at, source_product_id)
     VALUES ($1, $2, 'New', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
    [newId('prd'), shopId, ...productParams(p)],
  );
  return toProduct(row);
}

export async function updateProduct(q, id, shopId, p) {
  const [row] = await q.query(
    `UPDATE products SET name = $3, category = $4, icon = $5, description = $6, price = $7, old_price = $8, tiers = $9,
            stock = $10, local = $11, images = $12, weight_kg = $13, options = $14, low_stock_at = $15,
            source_product_id = COALESCE($16, source_product_id)
      WHERE id = $1 AND shop_id = $2 AND deleted_at IS NULL RETURNING *`,
    [id, shopId, ...productParams(p)],
  );
  return row ? toProduct(row) : null;
}

// Builds the product search query. Matching is typo-tolerant (pg_trgm) and understands local synonyms.
// `viewerShopId`: the signed-in owner also sees their own shop's products while it is waiting for approval.
export async function searchProducts(db, f, viewerShopId = null) {
  const params = [];
  const add = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = ['p.deleted_at IS NULL'];
  where.push(viewerShopId ? `(${LIVE_SHOP} OR sh.id = ${add(viewerShopId)})` : LIVE_SHOP);
  let rank = null; // relevance expression, only when searching

  if (f.ids) where.push(`p.id = ANY(${add(f.ids.split(',').slice(0, 100))})`);
  if (f.q) {
    // Only what the shopper typed gets typo tolerance and matches shop names and towns; synonyms must appear
    // as written in the product, otherwise e.g. the synonym "african print" would fuzzily match "Printer".
    // 0.55 keeps real typos (solr → Solar 0.60, chitenje → Chitenge 0.67) and drops near-misses (kitwe → Kit 0.50).
    const terms = add(expandSearch(f.q));
    const typed = add(f.q.trim().toLowerCase());
    where.push(`(word_similarity(${typed}::text, p.name) > 0.55
      OR strpos(lower(sh.name), ${typed}::text) > 0
      OR lower(sh.town) = ${typed}::text
      OR EXISTS (
        SELECT 1 FROM unnest(${terms}::text[]) term
         WHERE strpos(lower(p.name), term) > 0
            OR p.category = term
            OR (length(term) >= 4 AND starts_with(p.category, term))
            OR (length(term) >= 4 AND strpos(lower(p.description), term) > 0)))`);
    rank = `GREATEST(word_similarity(${typed}::text, p.name),
               (SELECT max(CASE WHEN strpos(lower(p.name), term) > 0 THEN 1 ELSE 0 END) FROM unnest(${terms}::text[]) term))`;
  }
  if (f.cat) where.push(`p.category = ${add(f.cat)}`);
  if (f.prov) where.push(`sh.province = ${add(f.prov)}`);
  if (f.town) where.push(`sh.town = ${add(f.town)}`);
  if (f.shop) where.push(`p.shop_id = ${add(f.shop)}`);
  if (f.local) where.push('p.local');
  if (f.wholesale) where.push(`jsonb_array_length(p.tiers) > 0`);
  if (f.lowStock) where.push('p.stock <= p.low_stock_at');
  if (f.featured) where.push('p.featured_until > now()');
  if (f.max) where.push(`p.price <= ${add(f.max)}`);

  const from = `FROM products p JOIN shops sh ON sh.id = p.shop_id WHERE ${where.join(' AND ')}`;
  const [{ total }] = await db.query(`SELECT count(*)::int AS total ${from}`, [...params]);

  const sort = f.sort || (f.q ? 'relevance' : 'popular');
  // Only add the buyer's location as parameters when sorting by distance: Postgres rejects unused parameters.
  let distance = null;
  if (sort === 'nearest' && f.nearProv && f.nearTown) {
    const prov = add(f.nearProv);
    distance = `CASE WHEN sh.province = ${prov} AND sh.town = ${add(f.nearTown)} THEN 0
                     WHEN sh.province = ${prov} THEN 1 ELSE 2 END`;
  }
  const orderBy = {
    // A bare number in ORDER BY means a column position, so missing parts are left out rather than set to 0.
    relevance: [rank && `${rank} DESC`, 'p.sold DESC'],
    nearest: [distance, rank && `${rank} DESC`, 'p.sold DESC'],
    popular: 'p.sold DESC',
    newest: 'p.created_at DESC',
    deals: 'CASE WHEN p.old_price > p.price THEN (p.old_price - p.price) / p.old_price ELSE 0 END DESC',
    'price-asc': 'p.price ASC',
    'price-desc': 'p.price DESC',
    rating: 'p.rating DESC, p.review_count DESC',
  }[sort];
  const orderSql = [orderBy].flat().filter(Boolean).join(', ');

  const rows = await db.query(
    `SELECT p.* ${from} ORDER BY ${orderSql}, p.id LIMIT ${add(f.limit)} OFFSET ${add((f.page - 1) * f.limit)}`,
    params,
  );
  return { items: rows.map(toProduct), total, page: f.page, pageSize: f.limit };
}

// Keeps product and shop ratings in step with their reviews.
export async function refreshRatings(q, productId, shopId) {
  await q.query(
    `UPDATE products SET rating = COALESCE((SELECT round(avg(rating), 1) FROM reviews WHERE product_id = $1), 0),
            review_count = (SELECT count(*) FROM reviews WHERE product_id = $1)
      WHERE id = $1`,
    [productId],
  );
  await q.query(
    `UPDATE shops SET rating = COALESCE((SELECT round(avg(rating), 1) FROM reviews WHERE shop_id = $1), 0),
            review_count = (SELECT count(*) FROM reviews WHERE shop_id = $1)
      WHERE id = $1`,
    [shopId],
  );
}

// Cancels a parcel: puts stock back, gives back a discount-code use and an agreed price, and records a refund
// if the buyer had paid. `by` is 'buyer', 'seller' or 'admin'; staff can also cancel parcels already sent.
// Removes a person's personal data, when they delete their account or Zed Market does. Orders stay (shops need
// their sales records) but no longer name or reach the person. Runs inside a transaction `t`.
export async function eraseUser(t, id) {
  await t.query(`UPDATE orders SET buyer_name = 'Deleted user', buyer_phone = '', address = '' WHERE buyer_id = $1`, [id]);
  await t.query(`UPDATE reviews SET author_name = 'Former customer' WHERE user_id = $1`, [id]);
  await t.query('DELETE FROM conversations WHERE buyer_id = $1', [id]);
  await t.query(`UPDATE price_requests SET note = '' WHERE buyer_id = $1`, [id]);
  // The row keeps its auth_id so a still-valid sign-in token can't recreate the account; the caller deletes the
  // Clerk sign-in itself, so the same email can sign up again as a new, unrelated account.
  await t.query(`UPDATE users SET name = 'Deleted user', phone = NULL, email = NULL, deleted_at = now() WHERE id = $1`, [id]);
}

export async function cancelShipment(t, orderId, shopId, by, reason) {
  const [s] = await t.query(
    `SELECT s.*, o.payment_status, o.buyer_id, o.buyer_name, o.buyer_phone
       FROM shipments s JOIN orders o ON o.id = s.order_id
      WHERE s.order_id = $1 AND s.shop_id = $2 FOR UPDATE OF s`,
    [orderId, shopId],
  );
  if (!s) throw new HttpError(404, 'Order not found');
  const cancellable = by === 'admin' ? ['pending', 'dispatched'] : ['pending'];
  if (!cancellable.includes(s.status)) {
    throw new HttpError(
      409,
      s.status === 'cancelled'
        ? 'This parcel is already cancelled'
        : by === 'admin'
          ? 'Delivered parcels are handled as returns, not cancellations'
          : "This parcel has already been sent, so it can't be cancelled. If there's a problem when it arrives, report it from your orders.",
    );
  }
  await t.query(
    `UPDATE shipments SET status = 'cancelled', cancelled_by = $2, cancel_reason = $3, updated_at = now() WHERE id = $1`,
    [s.id, by, reason],
  );
  const items = await t.query('SELECT * FROM order_items WHERE shipment_id = $1', [s.id]);
  for (const i of items) {
    await t.query('UPDATE products SET stock = stock + $2, sold = GREATEST(sold - $2, 0) WHERE id = $1', [
      i.product_id,
      i.qty,
    ]);
    if (i.price_request_id) {
      await t.query(`UPDATE price_requests SET status = 'accepted' WHERE id = $1 AND status = 'ordered'`, [
        i.price_request_id,
      ]);
    }
  }
  if (s.coupon_code) {
    await t.query('UPDATE coupons SET uses = GREATEST(uses - 1, 0) WHERE shop_id = $1 AND code = $2', [
      s.shop_id,
      s.coupon_code,
    ]);
  }
  // Return the voucher if every parcel of the order is now cancelled.
  const [order] = await t.query(
    `SELECT o.voucher_id, bool_and(x.status = 'cancelled') AS all_cancelled
       FROM orders o JOIN shipments x ON x.order_id = o.id WHERE o.id = $1 GROUP BY o.voucher_id`,
    [orderId]
  );
  if (order?.voucher_id && order.all_cancelled) {
    await t.query('UPDATE vouchers SET used_order_id = NULL WHERE id = $1', [order.voucher_id]);
  }

  const message = {
    kind: 'cancelled',
    title: `Order ${orderId} was cancelled`,
    body: reason,
    link: by === 'buyer' ? '/seller?tab=orders' : '/account',
  };
  if (by === 'buyer') await notifyShopOwner(t, s.shop_id, message);
  else await notify(t, s.buyer_id, message);

  let refund = 0;
  if (s.payment_status === 'paid' || s.paid_at) {
    refund = Number(s.subtotal) - Number(s.discount) - Number(s.voucher_discount ?? 0) + Number(s.fee);
    if (refund > 0) {
      await t.query(
        `INSERT INTO refunds (id, order_id, shipment_id, shop_id, buyer_id, reason, amount)
         VALUES ($1, $2, $3, $4, $5, 'cancelled', $6)`,
        [newId('rfd'), orderId, s.id, s.shop_id, s.buyer_id, refund],
      );
      // The buyer paid the shop's Mobile Money number, so the shop is the one holding the money.
      if (s.paid_at) {
        await notifyShopOwner(t, s.shop_id, {
          kind: 'refund',
          title: `Send ${formatK(refund)} back for order ${orderId}`,
          body: `The parcel was cancelled after ${s.buyer_name} paid you. Refund ${s.buyer_phone} by Mobile Money, then send the transaction ID to Zed Market support.`,
          link: '/seller?tab=orders',
        });
      }
    }
  }
  return { refund };
}

// How much can still be refunded on a parcel (goods after discount, plus delivery, minus earlier refunds).
export async function refundableLeft(q, shipmentId) {
  const [row] = await q.query(
    `SELECT s.subtotal - s.discount - s.voucher_discount + s.fee
              - COALESCE((SELECT sum(amount) FROM refunds r WHERE r.shipment_id = s.id), 0)
              AS left_amount
       FROM shipments s WHERE s.id = $1`,
    [shipmentId],
  );
  return Math.max(0, Number(row?.left_amount ?? 0));
}

export async function logAdmin(q, adminId, action, targetType, targetId, note = '') {
  await q.query(
    'INSERT INTO admin_actions (id, admin_id, action, target_type, target_id, note) VALUES ($1, $2, $3, $4, $5, $6)',
    [newId('act'), adminId, action, targetType, targetId, note],
  );
}
