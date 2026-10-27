import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireOwner } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { normalizePhone } from '../../src/utils/format.js';
import { toProduct, toReview } from '../mappers.js';
import { cancelShipment, eraseUser, loadOrders, logAdmin, refreshRatings, refundableLeft } from '../queries.js';
import { CASE_SELECT, addReturnRefund, toCase, updateCase } from './cases.js';
import { notify, notifyShopOwner } from '../notify.js';
import { shopBalances } from '../payouts.js';
import { loadDelivery } from '../delivery.js';
import { couriers } from '../../src/data/couriers.js';

const reason = z
  .string()
  .trim()
  .min(3, 'Give a reason; it is shown to the person affected and kept in the log')
  .max(500);
const search = z.object({
  q: z.string().trim().max(100).optional().default(''),
  status: z.string().max(20).optional(),
});
const like = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Zed Market staff tools. Every change is written to the activity log with the staff member and the reason.
// `deleteIdentity(authId)` deletes a Neon Auth sign-in when an owner deletes someone's account.
export function adminRoutes(
  db,
  { adminPhones = [], adminEmails = [], sms = null, exposeCodes = false, authReady = true, deleteIdentity = async () => {} } = {},
) {
  const owners = new Set(adminPhones.map(normalizePhone).filter(Boolean));
  const ownerEmails = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const isOwner = (u) => (u.phone && owners.has(u.phone)) || (u.email && ownerEmails.has(u.email.toLowerCase()));
  const router = Router();
  router.use(requireAdmin);

  router.get('/stats', async (_req, res) => {
    const [row] = await db.query(`SELECT
      (SELECT count(*) FROM users WHERE deleted_at IS NULL)::int AS users,
      (SELECT count(*) FROM shops WHERE deleted_at IS NULL)::int AS shops,
      (SELECT count(*) FROM shops WHERE verification = 'pending' AND deleted_at IS NULL)::int AS shops_to_verify,
      (SELECT count(*) FROM products WHERE deleted_at IS NULL)::int AS products,
      (SELECT count(*) FROM orders WHERE created_at > now() - interval '7 days')::int AS orders_7d,
      (SELECT COALESCE(sum(total), 0) FROM orders WHERE created_at > now() - interval '7 days') AS sales_7d,
      (SELECT count(*) FROM shipments WHERE status = 'pending' AND updated_at < now() - interval '2 days')::int AS late_dispatch,
      (SELECT count(*) FROM cases WHERE status = 'escalated')::int AS escalated_cases,
      (SELECT count(*) FROM cases WHERE status = 'open')::int AS open_cases,
      (SELECT count(*) FROM refunds WHERE status = 'due')::int AS refunds_due,
      (SELECT COALESCE(sum(amount), 0) FROM refunds WHERE status = 'due') AS refunds_due_amount,
      (SELECT count(*) FROM support_tickets WHERE status = 'open' AND staff_unread > 0)::int AS support_waiting`);
    const balances = await shopBalances(db);
    const ready = balances.filter((b) => b.available > 0);
    const owing = balances.filter((b) => b.owed > 0);
    // What still has to be set up before real customers use the site.
    const delivery = await loadDelivery(db);
    const [setup] = await db.query(`SELECT
      EXISTS (SELECT 1 FROM settings WHERE key = 'commissionRate') AS commission_set,
      EXISTS (SELECT 1 FROM commission_account) AS commission_account_set,
      (SELECT count(*) FROM shops WHERE momo_number IS NULL AND owner_id IS NOT NULL)::int AS shops_without_momo`);
    res.json({
      setup: {
        sms:
          !sms?.provider || sms.provider === 'console'
            ? 'off'
            : /sandbox/.test(sms.provider)
              ? 'sandbox'
              : /gateway/.test(sms.provider)
                ? 'phone'
                : 'live',
        couriersUnconfirmed: couriers.filter((c) => !c.confirmed && !c.disabled).map((c) => c.name),
        pointsConfirmed: !!delivery.points,
        signInCodesShown: exposeCodes,
        signInReady: authReady,
        commissionSet: setup.commission_set,
        commissionAccountSet: setup.commission_account_set,
        shopsWithoutMomo: setup.shops_without_momo,
      },
      users: row.users,
      shops: row.shops,
      shopsToVerify: row.shops_to_verify,
      products: row.products,
      orders7d: row.orders_7d,
      sales7d: Number(row.sales_7d),
      lateDispatch: row.late_dispatch,
      escalatedCases: row.escalated_cases,
      openCases: row.open_cases,
      refundsDue: row.refunds_due,
      refundsDueAmount: Number(row.refunds_due_amount),
      supportWaiting: row.support_waiting,
      payoutsReady: ready.length,
      payoutsReadyAmount: ready.reduce((n, b) => n + b.available, 0),
      commissionOwedShops: owing.length,
      commissionOwed: owing.reduce((n, b) => n + b.owed, 0),
    });
  });

  // ----- Shops -----
  router.get('/shops', async (req, res) => {
    const { q, status } = parse(search, req.query);
    const rows = await db.query(
      `SELECT sh.*, u.name AS owner_name, u.phone AS owner_phone,
              (SELECT count(*) FROM products p WHERE p.shop_id = sh.id AND p.deleted_at IS NULL)::int AS product_count
         FROM shops sh LEFT JOIN users u ON u.id = sh.owner_id
        WHERE sh.deleted_at IS NULL
          AND ($1 = '' OR sh.name ILIKE $2 OR sh.town ILIKE $2 OR u.phone LIKE $3)
          AND ($4::text IS NULL OR sh.verification = $4 OR ($4 = 'suspended' AND sh.suspended_at IS NOT NULL))
        ORDER BY (sh.verification = 'pending') DESC, sh.created_at DESC LIMIT 200`,
      [q, like(q), `%${q.replace(/\D/g, '') || '~'}%`, status || null],
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        province: r.province,
        town: r.town,
        area: r.area,
        phone: r.phone,
        tpin: r.tpin,
        ownerName: r.owner_name,
        ownerPhone: r.owner_phone ? `0${r.owner_phone}` : null,
        ownerFullName: r.owner_full_name,
        nrc: r.nrc,
        pacra: r.pacra,
        verification: r.verification,
        verificationNote: r.verification_note,
        suspended: !!r.suspended_at,
        suspendReason: r.suspend_reason,
        productCount: r.product_count,
        since: r.since,
      })),
    );
  });

  router.patch('/shops/:id/verification', async (req, res) => {
    const body = parse(
      z.object({ status: z.enum(['verified', 'rejected']), note: z.string().trim().max(500).default('') }),
      req.body,
    );
    if (body.status === 'rejected' && body.note.length < 3) throw new HttpError(400, 'Tell the shop what to fix');
    await db.tx(async (t) => {
      const rows = await t.query(
        'UPDATE shops SET verification = $2, verification_note = $3 WHERE id = $1 RETURNING id',
        [req.params.id, body.status, body.note || null],
      );
      if (!rows.length) throw new HttpError(404, 'Shop not found');
      await logAdmin(t, req.user.id, `shop ${body.status}`, 'shop', req.params.id, body.note);
      await notifyShopOwner(
        t,
        req.params.id,
        body.status === 'verified'
          ? { kind: 'shop', title: '🎉 Your shop is approved and live', body: 'Buyers across Zambia can now find your products.', link: '/seller' }
          : { kind: 'shop', title: "Your shop wasn't approved yet", body: body.note, link: '/seller?tab=settings' }
      );
    });
    res.json({ ok: true });
  });

  // Delete a shop for good (owners only). Parcels not yet delivered are cancelled and their buyers told.
  // A shop that never sold anything disappears completely. One with past orders is kept as a hidden record so
  // buyers keep their order history and commission still owed stays on the books; its owner can open a new shop.
  router.post('/shops/:id/delete', requireOwner, async (req, res) => {
    const { reason: why } = parse(z.object({ reason }), req.body);
    const result = await db.tx(async (t) => {
      const [shop] = await t.query('SELECT * FROM shops WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [
        req.params.id,
      ]);
      if (!shop) throw new HttpError(404, 'Shop not found');
      if (shop.owner_id) {
        await notify(t, shop.owner_id, {
          kind: 'shop',
          title: `Zed Market removed your shop ${shop.name}`,
          body: why,
          link: '/help',
        });
      }
      const open = await t.query(
        `SELECT order_id FROM shipments WHERE shop_id = $1 AND status IN ('pending', 'dispatched')`,
        [shop.id],
      );
      for (const s of open) {
        await cancelShipment(t, s.order_id, shop.id, 'admin', `${shop.name} is no longer on Zed Market`);
      }
      const [history] = await t.query(
        `SELECT (SELECT count(*) FROM shipments WHERE shop_id = $1)::int
              + (SELECT count(*) FROM payouts WHERE shop_id = $1)::int AS records`,
        [shop.id],
      );
      const kept = history.records > 0;
      if (kept) {
        await t.query(
          `UPDATE products SET deleted_at = now(), removed_reason = 'Shop removed', featured_until = NULL
            WHERE shop_id = $1 AND deleted_at IS NULL`,
          [shop.id],
        );
        await t.query(
          `UPDATE shops SET deleted_at = now(), owner_id = NULL, suspended_at = COALESCE(suspended_at, now()),
                  suspend_reason = $2 WHERE id = $1`,
          [shop.id, `Deleted: ${why}`],
        );
      } else {
        const mine = '(SELECT id FROM products WHERE shop_id = $1)';
        await t.query(
          `UPDATE buying_requests SET accepted_offer_id = NULL
            WHERE accepted_offer_id IN (SELECT id FROM request_offers WHERE shop_id = $1)`,
          [shop.id],
        );
        await t.query('DELETE FROM request_offers WHERE shop_id = $1', [shop.id]);
        await t.query(`UPDATE request_offers SET product_id = NULL WHERE product_id IN ${mine}`, [shop.id]);
        await t.query('DELETE FROM conversations WHERE shop_id = $1', [shop.id]); // their messages go with them
        await t.query(`UPDATE messages SET product_id = NULL WHERE product_id IN ${mine}`, [shop.id]);
        await t.query(`UPDATE conversations SET product_id = NULL WHERE product_id IN ${mine}`, [shop.id]);
        await t.query('DELETE FROM price_requests WHERE shop_id = $1', [shop.id]);
        await t.query('DELETE FROM coupons WHERE shop_id = $1', [shop.id]);
        await t.query(`UPDATE products SET source_product_id = NULL WHERE source_product_id IN ${mine}`, [shop.id]);
        await t.query('DELETE FROM products WHERE shop_id = $1', [shop.id]);
        await t.query('DELETE FROM shops WHERE id = $1', [shop.id]);
      }
      await logAdmin(t, req.user.id, 'shop deleted', 'shop', shop.id, `${shop.name}: ${why}`);
      return { ok: true, kept, cancelled: open.length };
    });
    res.json(result);
  });

  router.patch('/shops/:id/suspension', async (req, res) => {
    const body = parse(z.object({ suspended: z.boolean(), reason: reason.optional() }), req.body);
    if (body.suspended && !body.reason) throw new HttpError(400, 'Give a reason for suspending this shop');
    await db.tx(async (t) => {
      const rows = await t.query(
        `UPDATE shops SET suspended_at = CASE WHEN $2 THEN now() ELSE NULL END, suspend_reason = $3
          WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [req.params.id, body.suspended, body.suspended ? body.reason : null],
      );
      if (!rows.length) throw new HttpError(404, 'Shop not found');
      await logAdmin(
        t,
        req.user.id,
        body.suspended ? 'shop suspended' : 'shop restored',
        'shop',
        req.params.id,
        body.reason ?? '',
      );
      await notifyShopOwner(t, req.params.id, {
        kind: 'shop',
        title: body.suspended ? 'Your shop has been suspended' : 'Your shop is open again',
        body: body.reason ?? '',
        link: '/seller',
      });
    });
    res.json({ ok: true });
  });

  // ----- Listings -----
  router.get('/products', async (req, res) => {
    const { q, status } = parse(search, req.query);
    const rows = await db.query(
      `SELECT p.*, sh.name AS shop_name FROM products p JOIN shops sh ON sh.id = p.shop_id
        WHERE ($1 = '' OR p.name ILIKE $2 OR sh.name ILIKE $2 OR p.id = $1)
          AND ($3::text IS NULL OR ($3 = 'removed' AND p.removed_reason IS NOT NULL AND p.deleted_at IS NOT NULL)
                                OR ($3 = 'live' AND p.deleted_at IS NULL))
        ORDER BY p.created_at DESC LIMIT 100`,
      [q, like(q), status || null],
    );
    res.json(
      rows.map((r) => ({
        ...toProduct(r),
        shopName: r.shop_name,
        removed: !!r.deleted_at,
        removedReason: r.removed_reason,
      })),
    );
  });

  router.post('/products/:id/remove', async (req, res) => {
    const body = parse(z.object({ reason }), req.body);
    await db.tx(async (t) => {
      const rows = await t.query(
        `UPDATE products SET deleted_at = now(), removed_reason = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [req.params.id, body.reason],
      );
      if (!rows.length) throw new HttpError(404, 'Listing not found or already removed');
      await logAdmin(t, req.user.id, 'listing removed', 'product', req.params.id, body.reason);
      const [p] = await t.query('SELECT name, shop_id FROM products WHERE id = $1', [req.params.id]);
      await notifyShopOwner(t, p.shop_id, { kind: 'listing', title: `Zed Market removed “${p.name}”`, body: body.reason, link: '/seller' });
    });
    res.json({ ok: true });
  });

  router.post('/products/:id/restore', async (req, res) => {
    await db.tx(async (t) => {
      const rows = await t.query(
        `UPDATE products SET deleted_at = NULL, removed_reason = NULL
          WHERE id = $1 AND removed_reason IS NOT NULL RETURNING id`,
        [req.params.id],
      );
      if (!rows.length) throw new HttpError(404, 'Only listings removed by staff can be restored');
      await logAdmin(t, req.user.id, 'listing restored', 'product', req.params.id);
    });
    res.json({ ok: true });
  });

  // ----- Reviews -----
  router.get('/reviews', async (req, res) => {
    const { q } = parse(search, req.query);
    const rows = await db.query(
      `SELECT r.*, p.name AS product_name FROM reviews r JOIN products p ON p.id = r.product_id
        WHERE ($1 = '' OR r.comment ILIKE $2 OR p.name ILIKE $2 OR r.author_name ILIKE $2)
        ORDER BY r.created_at DESC LIMIT 100`,
      [q, like(q)],
    );
    res.json(rows.map(toReview));
  });

  router.delete('/reviews/:id', async (req, res) => {
    const body = parse(z.object({ reason }), req.body);
    await db.tx(async (t) => {
      const [row] = await t.query('DELETE FROM reviews WHERE id = $1 RETURNING product_id, shop_id, comment', [
        req.params.id,
      ]);
      if (!row) throw new HttpError(404, 'Review not found');
      await refreshRatings(t, row.product_id, row.shop_id);
      await logAdmin(
        t,
        req.user.id,
        'review removed',
        'review',
        req.params.id,
        `${body.reason} — "${row.comment.slice(0, 120)}"`,
      );
    });
    res.json({ ok: true });
  });

  // ----- Users -----
  router.get('/users', async (req, res) => {
    const { q } = parse(search, req.query);
    const digits = q.replace(/\D/g, '').replace(/^(260|0)/, '');
    const rows = await db.query(
      `SELECT u.*, (SELECT id FROM shops WHERE owner_id = u.id) AS shop_id,
              (SELECT count(*) FROM orders WHERE buyer_id = u.id)::int AS order_count
         FROM users u
        WHERE u.deleted_at IS NULL AND ($1 = '' OR u.name ILIKE $2 OR ($3 <> '' AND u.phone LIKE $3 || '%'))
        ORDER BY u.created_at DESC LIMIT 100`,
      [q, like(q), digits],
    );
    res.json(
      rows.map((u) => ({
        id: u.id,
        name: u.name,
        phone: u.phone ? `0${u.phone}` : null,
        email: u.email,
        accountType: u.account_type,
        role: isOwner(u) ? 'owner' : u.is_staff ? 'staff' : null,
        shopId: u.shop_id,
        orderCount: u.order_count,
        suspended: !!u.suspended_at,
        suspendReason: u.suspend_reason,
        since: u.created_at,
      })),
    );
  });

  router.patch('/users/:id/suspension', async (req, res) => {
    const body = parse(z.object({ suspended: z.boolean(), reason: reason.optional() }), req.body);
    if (req.params.id === req.user.id) throw new HttpError(400, "You can't suspend your own account");
    if (body.suspended && !body.reason) throw new HttpError(400, 'Give a reason for suspending this account');
    const [target] = await db.query('SELECT phone, email, is_staff FROM users WHERE id = $1', [req.params.id]);
    if (target && isOwner(target)) throw new HttpError(403, 'Owners can only be changed in ADMIN_PHONES or ADMIN_EMAILS on the server');
    if (target?.is_staff && req.user.staffRole !== 'owner') throw new HttpError(403, 'Only owners can suspend staff');
    await db.tx(async (t) => {
      const rows = await t.query(
        `UPDATE users SET suspended_at = CASE WHEN $2 THEN now() ELSE NULL END, suspend_reason = $3
          WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [req.params.id, body.suspended, body.suspended ? body.reason : null],
      );
      if (!rows.length) throw new HttpError(404, 'User not found');
      await logAdmin(
        t,
        req.user.id,
        body.suspended ? 'user suspended' : 'user restored',
        'user',
        req.params.id,
        body.reason ?? '',
      );
    });
    res.json({ ok: true });
  });

  // Delete a customer's account for good (owners only), e.g. a fake or abusive account, or at the person's request.
  // Same as deleting your own account: personal data is removed, past orders stay without naming them, and the
  // sign-in is deleted. Parcels not yet delivered are cancelled, as they can't reach a deleted account.
  router.post('/users/:id/delete', requireOwner, async (req, res) => {
    const { reason: why } = parse(z.object({ reason }), req.body);
    if (req.params.id === req.user.id) throw new HttpError(400, "You can't delete your own account here");
    const result = await db.tx(async (t) => {
      const [target] = await t.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [
        req.params.id,
      ]);
      if (!target) throw new HttpError(404, 'User not found');
      if (isOwner(target) || target.is_staff) {
        throw new HttpError(403, 'Staff and owner accounts are removed under Staff, or in ADMIN_PHONES on the server');
      }
      const [shop] = await t.query('SELECT name FROM shops WHERE owner_id = $1 AND deleted_at IS NULL', [target.id]);
      if (shop) throw new HttpError(409, `This person owns ${shop.name}. Delete the shop under Shops first.`);
      const open = await t.query(
        `SELECT s.order_id, s.shop_id FROM shipments s JOIN orders o ON o.id = s.order_id
          WHERE o.buyer_id = $1 AND s.status IN ('pending', 'dispatched')`,
        [target.id],
      );
      for (const s of open) await cancelShipment(t, s.order_id, s.shop_id, 'admin', "The buyer's account was closed");
      await eraseUser(t, target.id);
      await logAdmin(t, req.user.id, 'user deleted', 'user', target.id, `${target.name}: ${why}`);
      return { authId: target.auth_id, cancelled: open.length };
    });
    if (result.authId) await deleteIdentity(result.authId);
    res.json({ ok: true, cancelled: result.cancelled });
  });

  // ----- Orders -----
  router.get('/orders', async (req, res) => {
    const { q } = parse(search, req.query);
    const rows = await db.query(
      `SELECT * FROM orders
        WHERE $1 = '' OR upper(id) = upper($1) OR buyer_phone LIKE $2 OR buyer_name ILIKE $3
        ORDER BY created_at DESC LIMIT 50`,
      [q, `%${q.replace(/\D/g, '') || '~'}%`, like(q)],
    );
    res.json(await loadOrders(db, rows));
  });

  router.post('/orders/:orderId/shipments/:shopId/cancel', async (req, res) => {
    const body = parse(z.object({ reason }), req.body);
    const result = await db.tx(async (t) => {
      const r = await cancelShipment(t, req.params.orderId, req.params.shopId, 'admin', body.reason);
      await logAdmin(t, req.user.id, 'parcel cancelled', 'order', req.params.orderId, body.reason);
      return r;
    });
    res.json(result);
  });

  // ----- Disputes -----
  router.get('/cases', async (req, res) => {
    const { status } = parse(search, req.query);
    const rows = await db.query(
      `${CASE_SELECT} WHERE ($1::text IS NULL OR c.status = $1)
        ORDER BY (c.status = 'escalated') DESC, c.updated_at DESC LIMIT 100`,
      [status || null],
    );
    const withLeft = [];
    for (const r of rows) withLeft.push({ ...toCase(r), refundableLeft: await refundableLeft(db, r.shipment_id) });
    res.json(withLeft);
  });

  // Staff make the final decision: refund the buyer (any amount up to what's left on the parcel) or side with the shop.
  router.patch('/cases/:id/decide', async (req, res) => {
    const body = parse(
      z.object({
        outcome: z.enum(['refund', 'reject']),
        refundAmount: z.coerce.number().positive().optional(),
        note: reason,
      }),
      req.body,
    );
    const [row] = await db.query('SELECT * FROM cases WHERE id = $1', [req.params.id]);
    if (!row) throw new HttpError(404, 'Case not found');
    if (!['open', 'rejected', 'escalated'].includes(row.status))
      throw new HttpError(409, 'This case is already closed');
    await db.tx(async (t) => {
      if (body.outcome === 'refund') {
        const amount = await addReturnRefund(t, row, body.refundAmount ?? (await refundableLeft(t, row.shipment_id)));
        await updateCase(
          t,
          row.id,
          'staff',
          'decided: refund',
          body.note,
          `status = 'resolved', resolution = 'refund', refund_amount = $3`,
          [amount],
        );
      } else {
        await updateCase(
          t,
          row.id,
          'staff',
          'decided: no refund',
          body.note,
          `status = 'resolved', resolution = 'rejected'`,
        );
      }
      await logAdmin(t, req.user.id, `case decided: ${body.outcome}`, 'case', row.id, body.note);
      const message = {
        kind: 'case',
        title: body.outcome === 'refund' ? 'Zed Market decided: refund the buyer' : 'Zed Market decided: no refund',
        body: body.note,
        link: `/cases/${row.id}`,
      };
      await notify(t, row.buyer_id, message);
      await notifyShopOwner(t, row.shop_id, message);
    });
    const [full] = await db.query(`${CASE_SELECT} WHERE c.id = $1`, [row.id]);
    res.json(toCase(full));
  });

  // ----- Refunds -----
  router.get('/refunds', async (req, res) => {
    const { status } = parse(search, req.query);
    const rows = await db.query(
      `SELECT r.*, o.buyer_name, o.buyer_phone, o.payment_method, o.payment_status, sh.name AS shop_name, sh.phone AS shop_phone
         FROM refunds r JOIN orders o ON o.id = r.order_id JOIN shops sh ON sh.id = r.shop_id
        WHERE ($1::text IS NULL OR r.status = $1) ORDER BY (r.status = 'due') DESC, r.created_at LIMIT 200`,
      [status || null],
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        shopName: r.shop_name,
        buyerName: r.buyer_name,
        buyerPhone: r.buyer_phone,
        paymentMethod: r.payment_method,
        // The buyer paid the shop directly (Mobile Money or cash), so the shop has the money to give back.
        heldByShop: r.payment_status !== 'paid',
        shopPhone: r.shop_phone,
        reason: r.reason,
        amount: Number(r.amount),
        status: r.status,
        reference: r.reference,
        date: r.created_at,
        paidAt: r.paid_at,
      })),
    );
  });

  router.patch('/refunds/:id/paid', async (req, res) => {
    const { reference } = parse(
      z.object({ reference: z.string().trim().min(3, 'Enter the Mobile Money or bank reference').max(80) }),
      req.body,
    );
    await db.tx(async (t) => {
      const rows = await t.query(
        `UPDATE refunds SET status = 'paid', reference = $2, paid_at = now() WHERE id = $1 AND status = 'due'
          RETURNING buyer_id, amount, order_id`,
        [req.params.id, reference],
      );
      if (!rows.length) throw new HttpError(409, 'Refund not found or already paid');
      await notify(t, rows[0].buyer_id, {
        kind: 'refund',
        title: `Refund of K${Number(rows[0].amount)} sent`,
        body: `For order ${rows[0].order_id}. Reference ${reference}.`,
        link: '/account',
      });
      await logAdmin(t, req.user.id, 'refund paid', 'refund', req.params.id, reference);
    });
    res.json({ ok: true });
  });

  // ----- Activity log -----
  router.get('/actions', async (_req, res) => {
    const rows = await db.query(
      `SELECT a.*, u.name AS admin_name FROM admin_actions a JOIN users u ON u.id = a.admin_id
        ORDER BY a.created_at DESC LIMIT 200`,
    );
    res.json(
      rows.map((a) => ({
        id: a.id,
        admin: a.admin_name,
        action: a.action,
        targetType: a.target_type,
        targetId: a.target_id,
        note: a.note,
        date: a.created_at,
      })),
    );
  });

  return router;
}
