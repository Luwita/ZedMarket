import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { normalizePhone } from '../src/utils/format.js';
import { HttpError, newId, parse } from './http.js';
import { toUser } from './mappers.js';
import { getSettings } from './settings.js';
import { notify } from './notify.js';

// Accounts are run by Clerk (see clerkAuth.js): people sign up with email or Google. Every API request carries a
// Clerk session token; this file turns it into a ZedMarket user (the users table), creating that user the first
// time they use the API.

// A short, shareable invite code such as CHANDA42K.
async function uniqueReferralCode(db, name) {
  const base = (name || 'ZED').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'ZED';
  for (let i = 0; i < 20; i++) {
    const code = base + randomBytes(2).toString('hex').toUpperCase().slice(0, 3);
    const [taken] = await db.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
    if (!taken) return code;
  }
  return 'ZM' + randomBytes(4).toString('hex').toUpperCase();
}

const phoneSet = (phones = []) => new Set(phones.map(normalizePhone).filter(Boolean));
const emailSet = (emails = []) => new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));

// Owners are the ADMIN_EMAILS addresses (once Clerk has verified them; on a development computer also unverified).
// They are checked on every request, so removing one revokes access at once. Other staff are added in the admin panel.
// Suspended or deleted accounts load as nobody, so they stop working everywhere at once.
function makeLoadUser(owners) {
  return async (db, userId) => {
    const [row] = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!row || row.suspended_at || row.deleted_at) return null;
    const email = row.email?.toLowerCase();
    const isOwner =
      (row.phone && owners.phones.has(row.phone)) ||
      (email && owners.emails.has(email) && (row.email_verified || !owners.production));
    const isAdmin = !!isOwner || row.is_staff;
    const [shop] = isAdmin ? [] : await db.query('SELECT id FROM shops WHERE owner_id = $1', [userId]);
    return {
      ...toUser(row, shop?.id ?? null),
      email: row.email,
      isAdmin,
      staffRole: isOwner ? 'owner' : isAdmin ? 'staff' : null,
    };
  };
}

// Gives a user a phone number verified outside Clerk (`lookupPhone` only returns one in tests). If staff already set
// up an account for that number and this account is still empty, the person takes over that account instead.
// Returns the id of the account the person now uses.
async function attachPhone(db, user, phone) {
  if (!phone || user.phone === phone) return user.id;
  return db.tx(async (t) => {
    const [other] = await t.query('SELECT * FROM users WHERE phone = $1 AND id <> $2 FOR UPDATE', [phone, user.id]);
    if (other && !other.auth_id && !other.deleted_at) {
      const [{ used }] = await t.query(
        `SELECT (EXISTS (SELECT 1 FROM shops WHERE owner_id = $1) OR EXISTS (SELECT 1 FROM orders WHERE buyer_id = $1)) AS used`,
        [user.id],
      );
      if (!used) {
        await t.query('UPDATE users SET auth_id = NULL WHERE id = $1', [user.id]);
        await t.query('DELETE FROM notifications WHERE user_id = $1', [user.id]);
        await t.query('DELETE FROM vouchers WHERE user_id = $1', [user.id]);
        await t.query('DELETE FROM users WHERE id = $1', [user.id]);
        await t.query('UPDATE users SET auth_id = $2, email = $3, email_verified = $4 WHERE id = $1', [
          other.id,
          user.auth_id,
          user.email,
          user.email_verified,
        ]);
        return other.id;
      }
    }
    if (other) return user.id; // the number belongs to another active account; keep it there
    await t.query('UPDATE users SET phone = $2 WHERE id = $1', [user.id, phone]);
    return user.id;
  });
}

// The ZedMarket user for a verified Clerk identity, created the first time they use the API. A staff member added
// by email (before they had an account) takes over that account when they sign in with the verified address.
async function userFor(db, identity, lookupPhone) {
  let [row] = await db.query('SELECT * FROM users WHERE auth_id = $1', [identity.id]);
  if (row?.deleted_at) return row; // a deleted account stays deleted
  if (!row && identity.email && identity.emailVerified) {
    [row] = await db.query(
      `UPDATE users SET auth_id = $1, email_verified = true
        WHERE id = (SELECT id FROM users WHERE lower(email) = lower($2) AND auth_id IS NULL AND is_staff AND deleted_at IS NULL LIMIT 1)
        RETURNING *`,
      [identity.id, identity.email],
    );
  }
  if (!row) {
    const phone = await lookupPhone(identity.id);
    const name = identity.name || identity.email?.split('@')[0] || 'Zed Market Shopper';
    [row] = await db.query(
      `INSERT INTO users (id, auth_id, email, email_verified, name, account_type, referral_code)
       VALUES ($1, $2, $3, $4, $5, 'buyer', $6)
       ON CONFLICT (auth_id) DO UPDATE SET email = EXCLUDED.email RETURNING *`,
      [newId('usr'), identity.id, identity.email, !!identity.emailVerified, name, await uniqueReferralCode(db, name)],
    );
    const id = await attachPhone(db, row, phone);
    [row] = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  } else if (row.email !== identity.email || row.email_verified !== !!identity.emailVerified) {
    [row] = await db.query('UPDATE users SET email = $2, email_verified = $3 WHERE id = $1 RETURNING *', [
      row.id,
      identity.email,
      !!identity.emailVerified,
    ]);
  }
  return row;
}

// Adds req.user (and req.identity, the Clerk account) when a valid Clerk session token is sent.
// `verifyToken(token)` returns { id, email, emailVerified, name } or null.
export const authenticate = (
  db,
  { adminPhones = [], adminEmails = [], production = false, verifyToken, lookupPhone = async () => null },
) => {
  const loadUser = makeLoadUser({ phones: phoneSet(adminPhones), emails: emailSet(adminEmails), production });
  return async (req, _res, next) => {
    try {
      const token = req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
      const identity = token && verifyToken ? await verifyToken(token) : null;
      if (identity) {
        req.identity = identity;
        let row = await userFor(db, identity, lookupPhone);
        // Copy in a newly verified number (the person may have just linked one).
        if (!row.phone) {
          const phone = await lookupPhone(identity.id);
          if (phone) {
            const id = await attachPhone(db, row, phone);
            [row] = await db.query('SELECT * FROM users WHERE id = $1', [id]);
          }
        }
        if (row.suspended_at) req.suspended = true;
        req.user = await loadUser(db, row.id);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

export const requireUser = (req, _res, next) => {
  if (req.suspended) {
    throw new HttpError(403, 'This account is suspended. Contact support@zedmarket.co.zm if you think this is a mistake.');
  }
  if (!req.user) throw new HttpError(401, 'Please sign in first');
  next();
};

export const requireAdmin = (req, res, next) =>
  requireUser(req, res, () => {
    if (!req.user.isAdmin) throw new HttpError(403, 'Staff only');
    next();
  });

// Owners (ADMIN_EMAILS) manage the staff list and platform settings.
export const requireOwner = (req, res, next) =>
  requireUser(req, res, () => {
    if (req.user.staffRole !== 'owner') throw new HttpError(403, 'Only Zed Market owners can do this');
    next();
  });

// /api/session: the signed-in person's ZedMarket account.
export function sessionRoutes(db) {
  const router = Router();

  router.get('/me', requireUser, (req, res) => res.json(req.user));

  // Right after signing up: the name, the kind of account, and a friend's invite code. The invite code counts
  // only once, on a new account, and earns a welcome voucher (the friend is rewarded later, on delivery).
  router.post('/welcome', requireUser, async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2, 'Enter your name').max(80).optional(),
        accountType: z.enum(['buyer', 'business', 'seller']).optional(),
        referralCode: z.string().trim().max(20).optional(),
      }),
      req.body,
    );
    const [row] = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const fresh = Date.now() - new Date(row.created_at).getTime() < 24 * 3600e3;
    // A new account's invite code is made from the name given at sign-up (unless someone already used it).
    const [invited] = await db.query('SELECT 1 FROM users WHERE referred_by = $1 LIMIT 1', [row.id]);
    const code = fresh && body.name && !invited ? await uniqueReferralCode(db, body.name) : null;
    await db.query(
      `UPDATE users SET name = COALESCE($2, name), referral_code = COALESCE($4, referral_code),
              account_type = CASE WHEN account_type = 'admin' THEN account_type ELSE COALESCE($3, account_type) END
        WHERE id = $1`,
      [row.id, body.name ?? null, body.accountType ?? null, code],
    );
    if (body.referralCode && fresh && !row.referred_by) {
      const [inviter] = await db.query(
        'SELECT id FROM users WHERE referral_code = upper($1) AND deleted_at IS NULL AND id <> $2',
        [body.referralCode, row.id],
      );
      if (inviter) {
        const { welcomeVoucher, voucherMinSpend, voucherDays } = await getSettings(db);
        await db.tx(async (t) => {
          await t.query('UPDATE users SET referred_by = $2 WHERE id = $1', [row.id, inviter.id]);
          await t.query(
            `INSERT INTO vouchers (id, user_id, amount, min_spend, reason, related_user_id, expires_at)
             VALUES ($1, $2, $3, $4, 'welcome', $5, now() + make_interval(days => $6))`,
            [newId('vch'), row.id, welcomeVoucher, voucherMinSpend, inviter.id, voucherDays],
          );
          await notify(t, row.id, {
            kind: 'voucher',
            title: `Welcome! K${welcomeVoucher} off your first order`,
            body: `Your friend's invite gave you a K${welcomeVoucher} voucher for orders of K${voucherMinSpend} or more.`,
            link: '/account?tab=invite',
          });
        });
      }
    }
    const [updated] = await db.query('SELECT * FROM users WHERE id = $1', [row.id]);
    res.json({ ...req.user, name: updated.name, accountType: updated.account_type });
  });

  return router;
}
