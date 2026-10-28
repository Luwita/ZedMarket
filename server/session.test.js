import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { createDb, migrate } from './db.js';

// Owners by email: on the live site only once Clerk has verified the address, so nobody can become an owner
// by signing up with the owner's email before they do.
let db;
let server;
let base;
const people = {
  'tok-unverified': { id: 'auth-a', email: 'Owner@ZedMarket.co.zm', emailVerified: false, name: 'Impostor' },
  'tok-verified': { id: 'auth-b', email: 'owner@zedmarket.co.zm', emailVerified: true, name: 'Owner' },
};

before(async () => {
  db = await createDb({ url: '', dataDir: '' });
  await migrate(db);
  server = createApp(db, {
    uploadDir: '.',
    production: true,
    adminEmails: ['owner@zedmarket.co.zm'],
    auth: { verifyToken: async (t) => people[t] ?? null },
  }).listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.close();
  await db.close();
});

const me = async (token) => (await fetch(`${base}/api/session/me`, { headers: { authorization: `Bearer ${token}` } })).json();

test('an owner email counts only once it is verified', async () => {
  const impostor = await me('tok-unverified');
  assert.equal(impostor.isAdmin, false);
  assert.equal(impostor.phone, null, 'no phone until one is verified');
  const owner = await me('tok-verified');
  assert.equal(owner.staffRole, 'owner');
});

test('a staff member added by email takes over that account only with the verified address', async () => {
  const [{ id }] = await db.query(
    `INSERT INTO users (id, email, name, account_type, referral_code, is_staff, staff_since)
     VALUES ('usr_staff1', 'staff@zedmarket.co.zm', 'Zed Market staff', 'admin', 'ZSTAFF1', true, now()) RETURNING id`,
  );
  people['tok-staff-unverified'] = { id: 'auth-c', email: 'staff@zedmarket.co.zm', emailVerified: false, name: 'Impostor' };
  people['tok-staff'] = { id: 'auth-d', email: 'staff@zedmarket.co.zm', emailVerified: true, name: 'Staff' };
  const impostor = await me('tok-staff-unverified');
  assert.notEqual(impostor.id, id);
  assert.equal(impostor.isAdmin, false);
  const staff = await me('tok-staff');
  assert.equal(staff.id, id);
  assert.equal(staff.staffRole, 'staff');
});
