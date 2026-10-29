import { HttpError } from './http.js';

// Sends email (order alerts). With RESEND_API_KEY and EMAIL_FROM set, through Resend (https://resend.com); without
// them nothing is sent, and the message is only printed in the server window (development).
//
// EMAIL_FROM must be an address on a domain verified in Resend, e.g. "Zed Market <noreply@zedmarket.co.zm>".
// Before a domain is verified, Resend's test sender (onboarding@resend.dev) only delivers to the Resend account's
// own email address.

export const consoleEmail = {
  provider: 'console',
  async send(to, subject, text) {
    console.log(`[email] to ${to}: ${subject} - ${text}`);
  },
};

export function resendEmail({ apiKey, from, fetchImpl = fetch }) {
  return {
    provider: 'Resend',
    async send(to, subject, text) {
      let res;
      try {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (err) {
        console.error(`[email] Resend unreachable: ${err.message}`);
        throw new HttpError(502, "We couldn't send the email just now. Please try again in a minute.");
      }
      if (!res.ok) {
        console.error(`[email] Resend refused the email to ${to}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        throw new HttpError(502, "We couldn't send the email just now. Please try again in a minute.");
      }
    },
  };
}

export function emailFromEnv(env = process.env) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  return apiKey && from ? resendEmail({ apiKey, from }) : consoleEmail;
}
