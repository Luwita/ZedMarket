import { Router } from 'express';
import { requireUser } from '../auth.js';
import { HttpError } from '../http.js';
import { eraseUser, loadOrders } from '../queries.js';

// The user's rights under Zambia's Data Protection Act: a copy of their data, and deletion.
// `deleteIdentity(authId)` deletes the person's Neon Auth sign-in when they delete their account.
export function accountRoutes(db, { deleteIdentity = async () => {} } = {}) {
  const router = Router();
  router.use(requireUser);

  router.get('/export', async (req, res) => {
    const id = req.user.id;
    const [user] = await db.query('SELECT id, name, phone, account_type, created_at FROM users WHERE id = $1', [id]);
    const orders = await loadOrders(
      db,
      await db.query('SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at', [id]),
    );
    const reviews = await db.query(
      'SELECT product_id, rating, comment, created_at FROM reviews WHERE user_id = $1 ORDER BY created_at',
      [id],
    );
    const messages = await db.query(
      `SELECT c.shop_id, m.sender_role, m.body, m.created_at FROM messages m
         JOIN conversations c ON c.id = m.conversation_id WHERE c.buyer_id = $1 ORDER BY m.created_at`,
      [id],
    );
    const priceRequests = await db.query(
      'SELECT product_id, qty, target_price, note, status, quoted_price, created_at FROM price_requests WHERE buyer_id = $1',
      [id],
    );
    const shop = req.user.shopId ? (await db.query('SELECT * FROM shops WHERE id = $1', [req.user.shopId]))[0] : null;
    res.set('Content-Disposition', 'attachment; filename="zed-market-my-data.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      user: { ...user, phone: user.phone ? `0${user.phone}` : null },
      shop,
      orders,
      reviews,
      messages,
      priceRequests,
    });
  });

  // Removes personal data. Orders stay (shops need their sales records) but no longer name or reach the person.
  router.delete('/', async (req, res) => {
    const id = req.user.id;
    const [row] = await db.query('SELECT auth_id FROM users WHERE id = $1', [id]);
    if (req.user.shopId) {
      throw new HttpError(409, 'Close your shop before deleting your account. Contact support to close it.');
    }
    const [open] = await db.query(
      `SELECT 1 FROM orders o JOIN shipments s ON s.order_id = o.id
        WHERE o.buyer_id = $1 AND s.status <> 'delivered' LIMIT 1`,
      [id],
    );
    if (open) throw new HttpError(409, 'You have orders on the way. You can delete your account once they arrive.');

    await db.tx((t) => eraseUser(t, id));
    if (row.auth_id) await deleteIdentity(row.auth_id);
    res.json({ ok: true });
  });

  return router;
}
