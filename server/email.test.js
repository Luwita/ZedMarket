import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailFromEnv, resendEmail } from './email.js';
import { emailText, notify, sendNotificationsByEmail } from './notify.js';
import { createDb, migrate } from './db.js';

test('emails are only set up when both Resend settings are present', () => {
  assert.equal(emailFromEnv({}).provider, 'console');
  assert.equal(emailFromEnv({ RESEND_API_KEY: 'k' }).provider, 'console');
  assert.equal(emailFromEnv({ RESEND_API_KEY: 'k', EMAIL_FROM: 'Zed <a@b.co>' }).provider, 'Resend');
});

test('Resend gets the sender, recipient and text; a refusal is reported', async () => {
  const calls = [];
  const ok = resendEmail({
    apiKey: 'key',
    from: 'Zed <a@b.co>',
    fetchImpl: async (url, init) => (calls.push({ url, init }), new Response('{}', { status: 200 })),
  });
  await ok.send('x@y.co', 'Hi', 'Body');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer key');
  assert.deepEqual(JSON.parse(calls[0].init.body), { from: 'Zed <a@b.co>', to: ['x@y.co'], subject: 'Hi', text: 'Body' });
  const refused = resendEmail({ apiKey: 'k', from: 'f', fetchImpl: async () => new Response('no', { status: 403 }) });
  await assert.rejects(refused.send('x@y.co', 'Hi', 'Body'), (e) => e.status === 502);
});

test('important notifications are emailed, others stay in the app, and a failure never breaks the order', async () => {
  const db = await createDb({ url: '', dataDir: '' });
  await migrate(db);
  await db.query(
    `INSERT INTO users (id, email, name, account_type, referral_code) VALUES ('u1', 'Chanda@Example.com', 'Chanda', 'buyer', 'ZC1')`,
  );
  const sent = [];
  sendNotificationsByEmail({ provider: 'test', send: async (to, subject, text) => sent.push({ to, subject, text }) }, 'https://shop.example/');
  await notify(db, 'u1', { kind: 'order', title: 'New order ZM-1', body: 'Wait for K500', link: '/order/ZM-1' });
  await notify(db, 'u1', { kind: 'voucher', title: 'A voucher', body: '' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'Chanda@Example.com');
  assert.equal(sent[0].subject, 'New order ZM-1');
  assert.match(sent[0].text, /Open it: https:\/\/shop\.example\/order\/ZM-1/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications'))[0].n, 2, 'both are in the app');

  sendNotificationsByEmail({
    provider: 'test',
    send: async () => {
      throw new Error('down');
    },
  });
  await notify(db, 'u1', { kind: 'payment', title: 'Paid' });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM notifications'))[0].n, 3);
  sendNotificationsByEmail(null);
  assert.ok(emailText('T', 'B').endsWith('-- Zed Market'));
  await db.close();
});
