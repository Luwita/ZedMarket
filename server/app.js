import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { authenticate, neonAuthWebhook, neonDeleteIdentity, neonPhoneLookup, sessionRoutes } from './auth.js';
import { authProxy, devCookieSecret, finishOAuthSignIn, neonTokenVerifier, neonWebhookVerifier } from './neonAuth.js';
import { HttpError } from './http.js';
import { catalogRoutes } from './routes/catalog.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { buyingRequestRoutes } from './routes/buyingRequests.js';
import { notificationRoutes } from './routes/notifications.js';
import { supportAdminRoutes, supportRoutes } from './routes/support.js';
import { voucherRoutes } from './routes/vouchers.js';
import { caseRoutes } from './routes/cases.js';
import { messageRoutes } from './routes/messages.js';
import { orderRoutes } from './routes/orders.js';
import { priceRequestRoutes } from './routes/priceRequests.js';
import { promotionRoutes } from './routes/promotions.js';
import { reviewRoutes } from './routes/reviews.js';
import { sellerRoutes } from './routes/seller.js';
import { adminToolRoutes, bannerRoutes } from './routes/adminTools.js';
import { adminControlRoutes } from './routes/adminControl.js';
import { getSettings } from './settings.js';
import { sendNotificationsBySms } from './notify.js';
import { deliveryAdminRoutes, deliveryRoutes } from './routes/delivery.js';

// `auth`: Neon Auth settings. `baseUrl` is the branch's Neon Auth URL; tests pass their own `verifyToken`,
// `lookupPhone` and `verifyWebhook` instead.
export function createApp(
  db,
  { uploadDir, buildDir, sms, email, exposeCodes = false, adminPhones = [], adminEmails = [], production = false, auth = {} } = {},
) {
  const {
    baseUrl,
    cookieSecret = devCookieSecret(),
    verifyToken = baseUrl ? neonTokenVerifier(baseUrl) : null,
    lookupPhone = neonPhoneLookup(db),
    verifyWebhook = baseUrl ? neonWebhookVerifier(baseUrl) : async () => false,
    deleteIdentity = neonDeleteIdentity(db),
  } = auth;
  const app = express();
  sendNotificationsBySms(sms ?? null);
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the host's HTTPS proxy, so cookies and links use https

  // These two read the raw request, so they come before JSON parsing.
  if (baseUrl) {
    app.use('/api/auth', authProxy({ baseUrl, cookieSecret }));
    app.use(finishOAuthSignIn({ baseUrl, cookieSecret })); // the page Google sends people back to
  }
  app.use('/api/webhooks/neon-auth', neonAuthWebhook(db, { sms, email, exposeCodes, verifyWebhook, adminPhones, adminEmails }));
  app.use(express.json({ limit: '3mb' })); // room for one base64 photo

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, db: db.kind });
  });

  app.use('/api', authenticate(db, { adminPhones, adminEmails, production, verifyToken, lookupPhone }));
  app.use('/api/session', sessionRoutes(db, { exposeCodes, adminPhones, adminEmails }));
  app.use('/api', catalogRoutes(db));
  app.use('/api', reviewRoutes(db));
  app.use('/api/orders', orderRoutes(db));
  app.use('/api/seller', sellerRoutes(db));
  app.use('/api', promotionRoutes(db));
  app.use('/api/conversations', messageRoutes(db));
  app.use('/api/price-requests', priceRequestRoutes(db));
  app.use('/api/me', accountRoutes(db, { deleteIdentity }));
  app.use('/api/cases', caseRoutes(db));
  app.use('/api/admin/support', supportAdminRoutes(db));
  app.use('/api/admin', adminToolRoutes(db));
  app.use('/api/admin', adminControlRoutes(db, { adminPhones, adminEmails }));
  app.use('/api/admin', deliveryAdminRoutes(db));
  app.use('/api', deliveryRoutes(db));
  app.use('/api/banners', bannerRoutes(db));
  // Public: commission rate and voucher amounts, shown in the seller terms and on the invite page.
  app.get('/api/settings', async (_req, res) => res.json(await getSettings(db)));
  app.use('/api/admin', adminRoutes(db, { adminPhones, adminEmails, sms, exposeCodes, authReady: !!baseUrl, deleteIdentity }));
  app.use('/api/notifications', notificationRoutes(db));
  app.use('/api/support', supportRoutes(db));
  app.use('/api/buying-requests', buyingRequestRoutes(db));
  app.use('/api/me', voucherRoutes(db));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // Photos are stored in the database. A photo's name never changes, so browsers may keep it for 30 days.
  app.get('/uploads/:name', async (req, res, next) => {
    if (!/^[\w.-]+$/.test(req.params.name)) return next();
    const [photo] = await db.query('SELECT content_type, data FROM uploads WHERE name = $1', [req.params.name]);
    if (!photo) return next();
    res.set({ 'Content-Type': photo.content_type, 'Cache-Control': 'public, max-age=2592000, immutable' });
    res.send(Buffer.from(photo.data));
  });
  // Photos saved to disk before they moved into the database.
  if (uploadDir) app.use('/uploads', express.static(uploadDir, { maxAge: '30d', immutable: true }));

  // In production the same server also serves the built React app.
  if (buildDir && existsSync(buildDir)) {
    app.use(express.static(buildDir));
    app.get(/^(?!\/(api|uploads)\/).*/, (_req, res) => res.sendFile(path.join(buildDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (!(err instanceof HttpError)) console.error(err);
    const status = err instanceof HttpError ? err.status : 500;
    res
      .status(status)
      .json({ error: status === 500 ? 'Something went wrong on our side' : err.message, ...(err.details ?? {}) });
  });

  return app;
}
