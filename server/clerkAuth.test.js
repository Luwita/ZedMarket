import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clerkDeleteIdentity, clerkTokenVerifier } from './clerkAuth.js';

const person = {
  firstName: 'Chanda',
  lastName: 'Phiri',
  primaryEmailAddressId: 'idn_2',
  emailAddresses: [
    { id: 'idn_1', emailAddress: 'old@example.com', verification: { status: 'unverified' } },
    { id: 'idn_2', emailAddress: 'chanda@example.com', verification: { status: 'verified' } },
  ],
};

const fakeClerk = (calls) => ({
  users: {
    async getUser(id) {
      calls.push(id);
      return person;
    },
    async deleteUser(id) {
      calls.push(`delete ${id}`);
    },
  },
});

test('a valid Clerk token becomes the person, from their primary email address', async () => {
  const calls = [];
  const verify = async (token) => (token === 'good' ? { data: { sub: 'user_1' } } : { errors: [new Error('bad')] });
  const check = clerkTokenVerifier({ secretKey: 'sk_test', clerk: fakeClerk(calls), verify });
  assert.deepEqual(await check('good'), { id: 'user_1', email: 'chanda@example.com', emailVerified: true, name: 'Chanda Phiri' });
  assert.equal(await check('forged'), null);
  await check('good');
  assert.deepEqual(calls, ['user_1'], 'the person is looked up once, then remembered for a minute');
});

test('the claims returned directly (as @clerk/backend 2.x does) are understood too', async () => {
  const check = clerkTokenVerifier({
    secretKey: 'sk_test',
    clerk: fakeClerk([]),
    verify: async (token) => {
      if (token !== 'good') throw new Error('Invalid JWT');
      return { sub: 'user_9', iat: 1, exp: 2 };
    },
  });
  assert.equal((await check('good')).id, 'user_9');
  assert.equal(await check('forged'), null);
});

test('a token that cannot be checked is refused instead of crashing the request', async () => {
  const check = clerkTokenVerifier({ secretKey: 'sk_test', clerk: fakeClerk([]), verify: async () => { throw new Error('offline'); } });
  assert.equal(await check('anything'), null);
});

test('deleting a Clerk sign-in never throws', async () => {
  const calls = [];
  await clerkDeleteIdentity({ clerk: fakeClerk(calls) })('user_1');
  assert.deepEqual(calls, ['delete user_1']);
  const broken = { users: { deleteUser: async () => { throw new Error('gone'); } } };
  await clerkDeleteIdentity({ clerk: broken })('user_2');
});
