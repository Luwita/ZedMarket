import { createClerkClient, verifyToken } from '@clerk/backend';

// Clerk (https://clerk.com) runs the accounts: sign-up, sign-in, passwords, Google and sessions.
//
//  - The browser signs people in with Clerk directly and sends each API request with a short-lived session token.
//  - The token is checked here against the CLERK_SECRET_KEY. The user's id in the token links to ZedMarket's own
//    users table (users.auth_id); the email and name are read from Clerk.

const CACHE_MS = 60e3;

// Checks a Clerk session token and returns who it belongs to: { id, email, emailVerified, name }, or null if the
// token isn't valid. `clerk` is only passed in tests.
export function clerkTokenVerifier({ secretKey, clerk = createClerkClient({ secretKey }), verify = verifyToken }) {
  const people = new Map(); // id -> { at, identity }

  async function identityOf(id) {
    const cached = people.get(id);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.identity;
    const user = await clerk.users.getUser(id);
    const address = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
    const identity = {
      id,
      email: address?.emailAddress ?? null,
      emailVerified: address?.verification?.status === 'verified',
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    };
    people.set(id, { at: Date.now(), identity });
    return identity;
  }

  return async (token) => {
    try {
      // The installed @clerk/backend returns the token's claims directly and throws when the token is bad; older
      // releases return { data, errors }. Both are handled.
      const result = await verify(token, { secretKey });
      const errors = result?.errors;
      const claims = result?.data ?? result;
      if (errors || !claims?.sub) {
        // Why a token was refused (never the token itself), e.g. a secret key from a different Clerk app.
        console.error(`[auth] Clerk token refused: ${errors?.[0]?.reason ?? 'no user in it'}: ${errors?.[0]?.message ?? ''}`);
        return null;
      }
      return await identityOf(claims.sub);
    } catch (err) {
      console.error(`[auth] could not check a Clerk token: ${err.message}`);
      return null;
    }
  };
}

// Deletes a person's Clerk sign-in. Used when someone deletes their ZedMarket account.
export const clerkDeleteIdentity =
  ({ secretKey, clerk = createClerkClient({ secretKey }) }) =>
  async (authId) => {
    try {
      await clerk.users.deleteUser(authId);
    } catch (err) {
      console.error(`[auth] could not delete the Clerk user ${authId}: ${err.message}`);
    }
  };
