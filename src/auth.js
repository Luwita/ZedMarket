// Clerk (https://clerk.com) runs sign-up and sign-in. The publishable key is in the Clerk dashboard under API keys;
// put it in .env.local as REACT_APP_CLERK_PUBLISHABLE_KEY (and in the host's build settings for the live site).
const publishableKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

let loading = null;

// Clerk is large, so it is downloaded only when needed: to sign in or up, or at start-up for someone who was signed in
// on this browser before (see `wasSignedIn`). Browsing as a guest never loads it.
const HINT = 'zedmarket.signedIn';
export const wasSignedIn = () => {
  try {
    return localStorage.getItem(HINT) === '1';
  } catch {
    return false;
  }
};
export function rememberSignedIn(yes) {
  try {
    if (yes) localStorage.setItem(HINT, '1');
    else localStorage.removeItem(HINT);
  } catch {
    // storage unavailable (private mode): the next visit just starts as a guest until they sign in again
  }
}

// The loaded Clerk client, started on first use. Fails with a readable message when no key is set.
export function loadClerk() {
  if (!publishableKey) {
    return Promise.reject(new Error('Sign-in is not set up yet. Add REACT_APP_CLERK_PUBLISHABLE_KEY and rebuild.'));
  }
  if (!loading) {
    loading = import('@clerk/clerk-js').then(async ({ Clerk }) => {
      const clerk = new Clerk(publishableKey);
      await clerk.load();
      return clerk;
    });
    loading.catch(() => {
      loading = null; // try again next time (e.g. the phone was offline)
    });
  }
  return loading;
}
