import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createApp } from './app.js';
import { webhookVerifier } from './neonAuth.js';
import { testAuth } from './testing/auth.js';
import { createDb, migrate } from './db.js';
import { africasTalkingSms, androidGatewaySms, consoleSms, smsFromEnv } from './sms.js';

// A stand-in for fetch that records the request and answers like Africa's Talking.
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(init.body.toString())) });
    if (reply instanceof Error) throw reply;
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status ?? 201 });
  };
  fn.calls = calls;
  return fn;
}
const accepted = {
  body: {
    SMSMessageData: {
      Message: 'Sent to 1/1 Total Cost: ZMW 0.3000',
      Recipients: [{ statusCode: 101, number: '+260977123456', status: 'Success', cost: 'ZMW 0.3000', messageId: 'ATXid_1' }],
    },
  },
};

describe("Africa's Talking SMS", () => {
  test('sends to the Zambian number with the API key, username and sender ID', async () => {
    const fetchImpl = fakeFetch(accepted);
    const sms = africasTalkingSms({ username: 'zedmarket', apiKey: 'key123', senderId: 'ZedMarket', fetchImpl });
    const result = await sms.send('977123456', 'Your Zed Market code is 123456.');
    assert.deepEqual(result, { id: 'ATXid_1', cost: 'ZMW 0.3000' });
    const [call] = fetchImpl.calls;
    assert.equal(call.url, 'https://api.africastalking.com/version1/messaging');
    assert.equal(call.init.headers.apiKey, 'key123');
    assert.deepEqual(call.form, { username: 'zedmarket', to: '+260977123456', message: 'Your Zed Market code is 123456.', from: 'ZedMarket' });
  });

  test('the sandbox username uses the sandbox and no sender ID is needed', async () => {
    const fetchImpl = fakeFetch(accepted);
    await africasTalkingSms({ username: 'sandbox', apiKey: 'k', fetchImpl }).send('966000111', 'Hi');
    assert.equal(fetchImpl.calls[0].url, 'https://api.sandbox.africastalking.com/version1/messaging');
    assert.equal(fetchImpl.calls[0].form.from, undefined);
  });

  test('a refused message, a wrong API key or no connection is reported as not sent', async () => {
    const refused = { body: { SMSMessageData: { Recipients: [{ statusCode: 403, status: 'InvalidPhoneNumber' }] } } };
    const wrongKey = { status: 401, body: 'The supplied authentication is invalid' };
    for (const reply of [refused, wrongKey, new Error('getaddrinfo ENOTFOUND')]) {
      const sms = africasTalkingSms({ username: 'zedmarket', apiKey: 'k', fetchImpl: fakeFetch(reply) });
      await assert.rejects(sms.send('977123456', 'Hi'), (err) => err.status === 502 && /couldn't send the SMS/.test(err.message));
    }
  });

  test('an Android phone can send the texts while testing', async () => {
    const calls = [];
    const sms = androidGatewaySms({
      username: 'ABC123',
      password: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 'msg_1', state: 'Pending' }), { status: 202 });
      },
    });
    assert.deepEqual(await sms.send('977123456', 'Your Zed Market code is 123456.'), { id: 'msg_1', state: 'Pending' });
    assert.equal(calls[0].url, 'https://api.sms-gate.app/3rdparty/v1/messages');
    assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('ABC123:secret').toString('base64')}`);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      textMessage: { text: 'Your Zed Market code is 123456.' },
      phoneNumbers: ['+260977123456'],
    });

    const refused = androidGatewaySms({
      username: 'a',
      password: 'b',
      fetchImpl: async () => new Response('Unauthorized', { status: 401 }),
    });
    await assert.rejects(refused.send('977123456', 'Hi'), (err) => err.status === 502);

    const env = { SMS_GATEWAY_USER: 'a', SMS_GATEWAY_PASS: 'b', AT_USERNAME: 'live', AT_API_KEY: 'k' };
    assert.equal(smsFromEnv(env).provider, 'Android phone gateway', 'the phone wins while its settings are present');
  });

  test('server/.env decides the provider', () => {
    assert.equal(smsFromEnv({}), consoleSms);
    assert.equal(smsFromEnv({ AT_USERNAME: 'sandbox', AT_API_KEY: 'k' }).provider, "Africa's Talking (sandbox)");
  });
});

describe('sign-in codes from Neon Auth', () => {
  // A signing key standing in for Neon Auth's; webhook calls are signed the way Neon Auth signs them.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1' };
  const verifyWebhook = webhookVerifier(async () => [jwk]);
  const sign = (raw, timestamp = Date.now()) => {
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key-1', b64: false })).toString('base64url');
    const signed = Buffer.from(`${timestamp}.${Buffer.from(raw).toString('base64url')}`).toString('base64url');
    const sig = cryptoSign(null, Buffer.from(`${header}.${signed}`), privateKey).toString('base64url');
    return { 'x-neon-signature': `${header}..${sig}`, 'x-neon-signature-kid': 'key-1', 'x-neon-timestamp': String(timestamp) };
  };
  const otp = (phone, code = '482913') =>
    JSON.stringify({ event_type: 'send.otp', event_data: { otp_code: code, delivery_preference: 'sms' }, user: { phone_number: phone } });

  const start = async ({ sms, email, exposeCodes = false }) => {
    const db = await createDb({ url: '', dataDir: '' });
    await migrate(db);
    const server = createApp(db, {
      uploadDir: '.',
      sms,
      email,
      exposeCodes,
      adminPhones: ['0955000001'],
      auth: { ...testAuth, verifyWebhook },
    }).listen(0);
    const base = `http://localhost:${server.address().port}`;
    const hook = (raw, headers = sign(raw)) =>
      fetch(`${base}/api/webhooks/neon-auth`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
    const testCode = async (to) => (await fetch(`${base}/api/session/test-code?to=${encodeURIComponent(to)}`)).json();
    return { db, server, hook, testCode, stop: async () => (server.close(), db.close()) };
  };

  test('a signed send.otp call is delivered by SMS; unsigned, stale or altered calls are refused', async () => {
    const texts = [];
    const app = await start({ sms: { provider: 'test', send: async (phone, message) => texts.push({ phone, message }) } });
    try {
      const raw = otp('+260977123456');
      assert.equal((await app.hook(raw)).status, 200);
      assert.deepEqual(texts, [{ phone: '977123456', message: 'Your Zed Market code is 482913. It expires in 5 minutes.' }]);

      assert.equal((await app.hook(raw, {})).status, 401, 'no signature');
      assert.equal((await app.hook(raw, sign(raw, Date.now() - 10 * 60e3))).status, 401, 'older than 5 minutes');
      assert.equal((await app.hook(otp('+260977123456', '000000'), sign(raw))).status, 401, 'body changed after signing');
      assert.equal(texts.length, 1);
      assert.equal((await app.testCode('0977123456')).error, 'Not found', 'codes are never shown outside test mode');
    } finally {
      await app.stop();
    }
  });

  test('emailed codes (e.g. a password reset) go out by email; without an email provider they fail', async () => {
    const mails = [];
    const app = await start({ sms: consoleSms, email: { provider: 'test', send: async (to, subject, text) => mails.push({ to, subject, text }) } });
    const reset = JSON.stringify({ event_type: 'send.otp', event_data: { otp_code: '555666', delivery_preference: 'email', type: 'forget-password' }, user: { email: 'Chanda@Example.com' } });
    try {
      assert.equal((await app.hook(reset)).status, 200);
      assert.equal(mails.length, 1);
      assert.equal(mails[0].to, 'chanda@example.com');
      assert.equal(mails[0].subject, 'Your Zed Market password reset code');
      assert.match(mails[0].text, /555666/);
    } finally {
      await app.stop();
    }
    const none = await start({ sms: consoleSms });
    try {
      assert.equal((await none.hook(reset)).status, 503);
    } finally {
      await none.stop();
    }
  });

  test('without test mode, a code that cannot be texted fails, so Neon Auth tells the person', async () => {
    const down = africasTalkingSms({ username: 'zedmarket', apiKey: 'k', fetchImpl: fakeFetch(new Error('offline')) });
    const app = await start({ sms: down });
    try {
      assert.equal((await app.hook(otp('+260977123456'))).status, 502);
    } finally {
      await app.stop();
    }
  });

  test('without test mode or an SMS provider, a texted code fails instead of only reaching the server log', async () => {
    const app = await start({ sms: consoleSms });
    try {
      assert.equal((await app.hook(otp('+260977123456'))).status, 503);
    } finally {
      await app.stop();
    }
    const testing = await start({ sms: consoleSms, exposeCodes: true });
    try {
      assert.equal((await testing.hook(otp('+260977123456', '777888'))).status, 200);
      assert.deepEqual(await testing.testCode('0977123456'), { code: '777888' });
    } finally {
      await testing.stop();
    }
  });

  test('in test mode the code is shown on screen even when SMS fails, but never an owner\'s', async () => {
    const down = africasTalkingSms({ username: 'zedmarket', apiKey: 'k', fetchImpl: fakeFetch(new Error('offline')) });
    const app = await start({ sms: down, exposeCodes: true });
    try {
      assert.equal((await app.hook(otp('+260977123456', '111222'))).status, 200);
      assert.deepEqual(await app.testCode('0977 123 456'), { code: '111222' });
      assert.equal((await app.hook(otp('+260955000001', '333444'))).status, 200);
      assert.deepEqual(await app.testCode('0955000001'), { code: null }, 'owner codes only go to the server log');
    } finally {
      await app.stop();
    }
  });
});
