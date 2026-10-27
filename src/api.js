// Thin client for the Zed Market API. In development, CRA proxies /api to the server on port 4000.
import { authClient } from './auth';
import { normalizePhone } from './utils/format';

// Accounts are run by Neon Auth. While someone is signed in, each API request carries a short-lived Neon Auth
// token (15 minutes), fetched again shortly before it runs out. Nobody signed in: no token is asked for.
let signedIn = false;
let cached = null; // { token, exp }

const expiryOf = (jwt) => {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp ?? 0;
  } catch {
    return 0;
  }
};

async function authToken() {
  if (!signedIn) return null;
  if (cached && cached.exp * 1000 > Date.now() + 30e3) return cached.token;
  try {
    const { data } = await authClient.token();
    cached = data?.token ? { token: data.token, exp: expiryOf(data.token) } : null;
  } catch {
    cached = null;
  }
  return cached?.token ?? null;
}

export const getToken = () => (signedIn ? cached?.token ?? 'signed-in' : null);
export function setToken(token) {
  if (!token) {
    signedIn = false;
    cached = null;
  }
}

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data; // e.g. per-row errors from a bulk upload
  }
}

async function request(method, path, body) {
  const token = await authToken();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach Zed Market. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data);
  }
  return data;
}

// ----- Sign-in (Neon Auth) -----
// Neon Auth answers { data, error }; some calls throw instead. Either way the person sees a readable message.
async function neon(call, fallback) {
  let result;
  try {
    result = await call();
  } catch (err) {
    throw new ApiError(err.status ?? 0, err.message || fallback);
  }
  if (result?.error) throw new ApiError(result.error.status ?? 400, result.error.message || fallback);
  return result?.data;
}
const asE164 = (phone) => `+260${normalizePhone(phone)}`;
const startSession = () => {
  signedIn = true;
  cached = null;
};

// Whether someone is signed in on this browser (also finishes a Google sign-in on the page it returns to).
export async function restoreSession() {
  try {
    const { data } = await authClient.getSession();
    signedIn = !!data?.session;
  } catch {
    signedIn = false;
  }
  cached = null;
  return signedIn;
}

export async function signUp({ name, email, password }) {
  await neon(() => authClient.signUp.email({ name, email, password }), "Couldn't create your account");
  startSession();
}

export async function signIn({ email, password }) {
  await neon(() => authClient.signIn.email({ email, password }), "Couldn't sign you in");
  startSession();
}

// Leaves the page for Google; Google sends the person back to `returnTo` on ZedMarket, signed in.
export async function signInWithGoogle(returnTo = '/login') {
  await neon(
    () => authClient.signIn.social({ provider: 'google', callbackURL: `${window.location.origin}${returnTo}` }),
    "Couldn't open Google sign-in",
  );
}

// Texts a 6-digit code to a phone number: to add it to the signed-in account, or to sign in with it.
export const sendPhoneCode = (phone) =>
  neon(() => authClient.phoneNumber.sendOtp({ phoneNumber: asE164(phone) }), "Couldn't send the code. Try again.");

// `link`: add the number to the signed-in account; otherwise sign in with an already-added number.
export async function verifyPhone({ phone, code, link }) {
  await neon(
    () => authClient.phoneNumber.verify({ phoneNumber: asE164(phone), code, ...(link ? { updatePhoneNumber: true } : {}) }),
    'That code is not correct',
  );
  startSession();
}

// Changes the password of the signed-in account (and signs out its other devices).
export const changePassword = ({ currentPassword, newPassword }) =>
  neon(
    () => authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }),
    "Couldn't change the password",
  );

// Forgotten password: a 6-digit code is emailed, then the code sets a new password.
export const requestPasswordReset = (email) =>
  neon(() => authClient.emailOtp.requestPasswordReset({ email }), "Couldn't send the code. Try again.");
export const resetPassword = ({ email, otp, password }) =>
  neon(() => authClient.emailOtp.resetPassword({ email, otp, password }), 'That code is not correct');

export async function logout() {
  try {
    await authClient.signOut();
  } finally {
    signedIn = false;
    cached = null;
  }
}

export const me = () => request('GET', '/session/me');
export const welcome = (details) => request('POST', '/session/welcome', details);
// Test mode only: the code last sent to a phone number, shown on screen while SMS isn't paid for.
export const testCode = (to) => request('GET', `/session/test-code?to=${encodeURIComponent(to)}`);

export const getShops = () => request('GET', '/shops');
// Search, filter and page products. Empty values are left out of the query string.
export const searchProducts = (params = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false),
  );
  return request('GET', `/products?${query}`);
};
export const getProduct = (id) => request('GET', `/products/${id}`);
export const provinceStats = () => request('GET', '/stats/provinces');
export const createShop = (shop) => request('POST', '/shops', shop);
export const updateShop = (id, shop) => request('PATCH', `/shops/${id}`, shop);
export const createProduct = (product) => request('POST', '/products', product);
export const updateProduct = (id, product) => request('PATCH', `/products/${id}`, product);
export const deleteProduct = (id) => request('DELETE', `/products/${id}`);
export const bulkCreateProducts = (products) => request('POST', '/products/bulk', { products });
export const uploadImage = (dataUrl) => request('POST', '/uploads', { dataUrl });

export const productReviews = (id, page = 1) => request('GET', `/products/${id}/reviews?page=${page}`);
export const shopReviews = (id) => request('GET', `/shops/${id}/reviews`);
export const createReview = (review) => request('POST', '/reviews', review);
export const replyToReview = (id, reply) => request('PATCH', `/reviews/${id}/reply`, { reply });

export const sellerReport = (days = 30) => request('GET', `/seller/report?days=${days}`);
export const sellerReviews = () => request('GET', '/seller/reviews');

export const placeOrder = (order) => request('POST', '/orders', order);
export const myOrders = () => request('GET', '/orders/mine');
export const shopOrders = () => request('GET', '/orders/shop');
export const updateShipment = (orderId, shopId, patch) =>
  request('PATCH', `/orders/${orderId}/shipments/${shopId}`, patch);
export const quoteOrder = (order) => request('POST', '/orders/quote', order);
// Mobile Money goes straight to the shop: the buyer says it was sent, the shop confirms it arrived.
export const paymentSent = (orderId, shopId, reference) =>
  request('POST', `/orders/${orderId}/shipments/${shopId}/payment-sent`, { reference: reference || undefined });
export const confirmPayment = (orderId, shopId) => request('POST', `/orders/${orderId}/shipments/${shopId}/paid`, {});

// ----- Messages -----
export const listConversations = () => request('GET', '/conversations');
export const unreadMessages = () => request('GET', '/conversations/unread');
export const getConversation = (id) => request('GET', `/conversations/${id}`);
export const startConversation = (message) => request('POST', '/conversations', message);
export const sendMessage = (id, body) => request('POST', `/conversations/${id}/messages`, { body });

// ----- Promotions -----
export const sellerCoupons = () => request('GET', '/seller/coupons');
export const createCoupon = (coupon) => request('POST', '/seller/coupons', coupon);
export const setCouponActive = (id, active) => request('PATCH', `/seller/coupons/${id}`, { active });
export const featureProduct = (id) => request('POST', `/products/${id}/feature`);
export const unfeatureProduct = (id) => request('DELETE', `/products/${id}/feature`);

// ----- Wholesale price requests -----
export const requestPrice = (body) => request('POST', '/price-requests', body);
export const myPriceRequests = () => request('GET', '/price-requests/mine');
export const shopPriceRequests = () => request('GET', '/price-requests/shop');
export const respondToPriceRequest = (id, body) => request('PATCH', `/price-requests/${id}/respond`, body);
export const acceptPriceRequest = (id) => request('PATCH', `/price-requests/${id}/accept`);

// ----- Statements and personal data -----
export const sellerStatement = (month) => request('GET', `/seller/statement?month=${month}`);
export const exportMyData = () => request('GET', '/me/export');
export const deleteAccount = () => request('DELETE', '/me');

// ----- Cancellations, returns and disputes -----
export const cancelShipment = (orderId, shopId, reason) =>
  request('POST', `/orders/${orderId}/shipments/${shopId}/cancel`, { reason });
export const openCase = (body) => request('POST', '/cases', body);
export const myCases = () => request('GET', '/cases/mine');
export const shopCases = () => request('GET', '/cases/shop');
export const getCase = (id) => request('GET', `/cases/${id}`);
export const respondToCase = (id, body) => request('PATCH', `/cases/${id}/respond`, body);
export const escalateCase = (id, note) => request('PATCH', `/cases/${id}/escalate`, { note });
export const withdrawCase = (id) => request('PATCH', `/cases/${id}/withdraw`);

// ----- Shop verification -----
export const sellerVerification = () => request('GET', '/seller/verification');
export const submitVerification = (body) => request('POST', '/seller/verification', body);
export const removedProducts = () => request('GET', '/seller/removed-products');

// ----- Staff (admin) -----
const qs = (params = {}) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
export const admin = {
  stats: () => request('GET', '/admin/stats'),
  shops: (params) => request('GET', `/admin/shops?${qs(params)}`),
  verifyShop: (id, status, note) => request('PATCH', `/admin/shops/${id}/verification`, { status, note }),
  suspendShop: (id, suspended, reason) => request('PATCH', `/admin/shops/${id}/suspension`, { suspended, reason }),
  deleteShop: (id, reason) => request('POST', `/admin/shops/${id}/delete`, { reason }),
  products: (params) => request('GET', `/admin/products?${qs(params)}`),
  removeProduct: (id, reason) => request('POST', `/admin/products/${id}/remove`, { reason }),
  restoreProduct: (id) => request('POST', `/admin/products/${id}/restore`),
  reviews: (params) => request('GET', `/admin/reviews?${qs(params)}`),
  removeReview: (id, reason) => request('DELETE', `/admin/reviews/${id}`, { reason }),
  users: (params) => request('GET', `/admin/users?${qs(params)}`),
  suspendUser: (id, suspended, reason) => request('PATCH', `/admin/users/${id}/suspension`, { suspended, reason }),
  deleteUser: (id, reason) => request('POST', `/admin/users/${id}/delete`, { reason }),
  orders: (params) => request('GET', `/admin/orders?${qs(params)}`),
  cancelShipment: (orderId, shopId, reason) =>
    request('POST', `/admin/orders/${orderId}/shipments/${shopId}/cancel`, { reason }),
  cases: (params) => request('GET', `/admin/cases?${qs(params)}`),
  decideCase: (id, body) => request('PATCH', `/admin/cases/${id}/decide`, body),
  refunds: (params) => request('GET', `/admin/refunds?${qs(params)}`),
  markRefundPaid: (id, reference) => request('PATCH', `/admin/refunds/${id}/paid`, { reference }),
  actions: () => request('GET', '/admin/actions'),
  analytics: (days) => request('GET', `/admin/analytics?days=${days}`),
  payouts: () => request('GET', '/admin/payouts'),
  payoutHistory: (shopId) => request('GET', `/admin/payouts/history?${qs({ shopId })}`),
  pay: (body) => request('POST', '/admin/payouts', body),
  commissionAccount: () => request('GET', '/admin/commission-account'),
  saveCommissionAccount: (body) => request('PUT', '/admin/commission-account', body),
  receiveCommission: (body) => request('POST', '/admin/commission', body),
  remindCommission: (shopId) => request('POST', '/admin/commission/remind', { shopId }),
  banners: () => request('GET', '/admin/banners'),
  createBanner: (body) => request('POST', '/admin/banners', body),
  updateBanner: (id, body) => request('PATCH', `/admin/banners/${id}`, body),
  deleteBanner: (id) => request('DELETE', `/admin/banners/${id}`),
  campaigns: () => request('GET', '/admin/campaigns'),
  createCampaign: (body) => request('POST', '/admin/campaigns', body),
  announcements: () => request('GET', '/admin/announcements'),
  announce: (body) => request('POST', '/admin/announcements', body),
  requests: (params) => request('GET', `/admin/requests?${qs(params)}`),
  delivery: () => request('GET', '/admin/delivery'),
  saveCourier: (id, body) => request('PUT', `/admin/delivery/couriers/${id}`, body),
  savePoints: (points) => request('PUT', '/admin/delivery/points', { points }),
  staff: () => request('GET', '/admin/staff'),
  addStaff: (body) => request('POST', '/admin/staff', body),
  removeStaff: (id) => request('DELETE', `/admin/staff/${id}`),
  settings: () => request('GET', '/admin/settings'),
  saveSettings: (body) => request('PATCH', '/admin/settings', body),
  shop: (id) => request('GET', `/admin/shops/${id}`),
  editShop: (id, body) => request('PUT', `/admin/shops/${id}`, body),
  editProduct: (id, body) => request('PUT', `/admin/products/${id}`, body),
  setParcelStatus: (orderId, shopId, body) => request('PATCH', `/admin/orders/${orderId}/shipments/${shopId}/status`, body),
  confirmPayment: (orderId, shopId, note) => request('POST', `/admin/orders/${orderId}/shipments/${shopId}/paid`, { note }),
  removeRequest: (id, reason) => request('POST', `/admin/requests/${id}/remove`, { reason }),
};

// ----- Home page banners and seller payouts -----
export const banners = () => request('GET', '/banners');
export const settings = () => request('GET', '/settings');
export const delivery = () => request('GET', '/delivery');
export const sellerPayouts = () => request('GET', '/seller/payouts');

// ----- Notifications (the bell and red dots) -----
export const notifications = () => request('GET', '/notifications');
export const counts = () => request('GET', '/notifications/counts');
export const markNotificationsRead = (ids) => request('POST', '/notifications/read', ids ? { ids } : {});

// ----- Customer support -----
export const supportTickets = () => request('GET', '/support');
export const supportTicket = (id) => request('GET', `/support/${id}`);
export const openSupportTicket = (body) => request('POST', '/support', body);
export const replySupport = (id, body) => request('POST', `/support/${id}/messages`, { body });

// ----- Buying requests -----
export const buyingRequests = (params = {}) =>
  request('GET', `/buying-requests?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`);
export const myBuyingRequests = () => request('GET', '/buying-requests/mine');
export const buyingRequest = (id) => request('GET', `/buying-requests/${id}`);
export const postBuyingRequest = (body) => request('POST', '/buying-requests', body);
export const sendOffer = (id, body) => request('POST', `/buying-requests/${id}/offers`, body);
export const acceptOffer = (id, offerId) => request('PATCH', `/buying-requests/${id}/offers/${offerId}/accept`);
export const closeBuyingRequest = (id) => request('PATCH', `/buying-requests/${id}/close`);

// ----- Invite codes and vouchers -----
export const myVouchers = () => request('GET', '/me/vouchers');
export const myReferral = () => request('GET', '/me/referral');

// ----- Staff: customer support -----
export const adminSupport = {
  list: (status) => request('GET', `/admin/support${status ? `?status=${status}` : ''}`),
  get: (id) => request('GET', `/admin/support/${id}`),
  reply: (id, body) => request('POST', `/admin/support/${id}/messages`, { body }),
  setStatus: (id, status) => request('PATCH', `/admin/support/${id}`, { status }),
};
