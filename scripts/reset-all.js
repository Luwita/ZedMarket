// Starts the marketplace from scratch: removes every shop, product, order, chat, review, voucher, support
// question and user account, keeping only the owner account you name (and the platform settings).
//
//   node scripts/reset-all.js --keep owner@example.com          (shows what would be deleted)
//   node scripts/reset-all.js --keep owner@example.com --yes    (deletes it)
//
// It runs against the database in DATABASE_URL (server/.env or .env.local), or the local one when that is unset.
// Stop `npm run dev` first if you use the local database. People's Clerk sign-ins are not touched here.
import { createDb, migrate } from '../server/db.js';

const args = process.argv.slice(2);
const keep = args[args.indexOf('--keep') + 1]?.trim().toLowerCase();
if (!keep || !keep.includes('@')) {
  console.log('Say which account to keep: node scripts/reset-all.js --keep owner@example.com [--yes]');
  process.exit(1);
}

const db = await createDb({ dataDir: process.env.PGLITE_DIR ?? 'server/.data/pg' });
await migrate(db);
const count = async (table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
const [owner] = await db.query('SELECT id, name, email FROM users WHERE lower(email) = $1', [keep]);
console.log(owner ? `Keeping ${owner.name} <${owner.email}>` : `No account with ${keep} yet: every user will be removed.`);
console.log(
  `Found ${await count('users')} users, ${await count('shops')} shops, ${await count('products')} products, ${await count('orders')} orders.`,
);
if (!args.includes('--yes')) {
  console.log('Nothing deleted. Add --yes to delete everything except the account above.');
  await db.close();
  process.exit(0);
}
const keepId = owner?.id ?? '';

await db.tx(async (t) => {
  // Shops, products, orders and everything hanging off them (children first).
  for (const sql of [
    'DELETE FROM request_offers',
    'UPDATE buying_requests SET accepted_offer_id = NULL',
    'DELETE FROM messages',
    'DELETE FROM conversations',
    'DELETE FROM refunds',
    'DELETE FROM cases',
    'DELETE FROM reviews',
    'DELETE FROM order_items',
    'DELETE FROM price_requests',
    'DELETE FROM shipments',
    'UPDATE orders SET voucher_id = NULL',
    'UPDATE vouchers SET used_order_id = NULL',
    'DELETE FROM orders',
    'DELETE FROM coupons',
    'DELETE FROM payouts',
    'UPDATE products SET source_product_id = NULL',
    'DELETE FROM products',
    'DELETE FROM shops',
    // People's own records.
    'DELETE FROM support_messages',
    'DELETE FROM support_tickets',
    'DELETE FROM buying_requests',
    'DELETE FROM vouchers',
    'DELETE FROM notifications',
    'DELETE FROM sessions',
    'DELETE FROM test_codes',
    'DELETE FROM otp_codes',
  ]) {
    await t.query(sql);
  }
  // Whatever else points at a user: forget who it was (staff records such as settings keep their values), or
  // delete the row when the column can't be empty.
  const links = await t.query(`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, a.attnotnull AS required
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.connamespace = 'public'::regnamespace`);
  for (const { tbl, col, required } of links) {
    await t.query(
      required
        ? `DELETE FROM ${tbl} WHERE ${col} <> $1`
        : `UPDATE ${tbl} SET ${col} = NULL WHERE ${col} IS NOT NULL AND ${col} <> $1`,
      [keepId],
    );
  }
  await t.query('DELETE FROM users WHERE id <> $1', [keepId]);
});

console.log(
  `Done. Now ${await count('users')} user, ${await count('shops')} shops, ${await count('products')} products, ${await count('orders')} orders.`,
);
await db.close();
