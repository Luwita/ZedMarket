// In-memory stand-in for src/api.js used by the React tests (see setupTests.js).
// It mirrors the server's behaviour closely enough to drive the UI; the real rules are tested in server/api.test.js.
import { categories, momoNetworkName, seedProducts } from '../data/catalog';
import { band, bandRank } from '../data/couriers';
import { priceOrder, OrderError } from '../data/pricing';
import { expandSearch } from '../data/search';
import { VOUCHER_MIN_SPEND, WELCOME_VOUCHER } from '../data/fees';
import { EDITABLE_COURIER_FIELDS, couriers as courierList } from '../data/couriers';
import { applyDeliveryConfig } from '../data/delivery';
import { pickupPoints } from '../data/pickupPoints';
import { seedShops } from '../data/shops';
import { normalizePhone } from '../utils/format';

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const FAKE_CODE = '123456';
let db;
let token = null;

export function __reset() {
  db = {
    shops: seedShops.map((s) => ({ ...s, ownerId: null, ownRates: null, ...momoFor(s) })),
    products: seedProducts.map((p) => ({ ...p, images: [...p.images] })),
    users: [],
    sessions: {},
    orders: [],
    reviews: [],
    conversations: [],
    coupons: [],
    priceRequests: [],
    cases: [],
    refunds: [],
    actions: [],
    notifications: [],
    tickets: [],
    requests: [],
    vouchers: [],
  };
  token = null;
  applyDeliveryConfig({}); // back to the starting courier rates and example points
}
__reset();

const copy = (v) => JSON.parse(JSON.stringify(v));
const isLiveShop = (s) => (s.verification ?? 'verified') === 'verified' && !s.suspended;
const viewer = () => {
  try {
    return currentUser();
  } catch {
    return null;
  }
};
const visibleShop = (s) => s && (isLiveShop(s) || s.ownerId === viewer()?.id);
const currentUser = () => {
  const user = db.users.find((u) => u.id === db.sessions[token]);
  if (!user) throw new ApiError(401, 'Please sign in first');
  const isAdmin = !!user.admin || !!user.staff;
  return {
    ...user,
    isAdmin,
    staffRole: user.admin ? 'owner' : user.staff ? 'staff' : null,
    // Staff accounts never act as a shop.
    shopId: isAdmin ? null : (db.shops.find((s) => s.ownerId === user.id)?.id ?? null),
  };
};
const myShop = () => {
  const shop = db.shops.find((s) => s.ownerId === currentUser().id);
  if (!shop) throw new ApiError(403, 'Open a shop first');
  return shop;
};

// Test helpers: start a test already signed in, optionally as the owner of a shop.
export function __signIn({
  name = 'Test User',
  phone = '0977000111',
  accountType = 'buyer',
  shop,
  admin = false,
  email,
  password,
} = {}) {
  const user = { id: `usr_${db.users.length + 1}`, name, phone, accountType, admin, referralCode: `ZMTEST${db.users.length + 1}` };
  if (email) {
    user.email = email;
    if (password) (db.passwords ??= {})[email] = password;
  }
  db.users.push(user);
  token = `tok_${user.id}`;
  db.sessions[token] = user.id;
  if (shop)
    db.shops.push({
      since: 2026,
      rating: 0,
      ownRates: null,
      verification: 'verified',
      verified: true,
      ...momoFor(shop),
      ...shop,
      ownerId: user.id,
    });
  return token;
}
export const __addProduct = (product) =>
  db.products.push({
    images: [],
    tiers: [],
    options: [],
    sold: 0,
    rating: 0,
    reviewCount: 0,
    weightKg: 1,
    lowStockAt: 5,
    ...product,
  });
export const __db = () => db;

// Shops in tests take Mobile Money on their shop phone unless a test says otherwise.
function momoFor(shop) {
  return { takesMomo: true, momoNetwork: 'mtn', momoNumber: (shop.phone ?? '').replace(/\s/g, ''), momoName: shop.name };
}
const payTo = (shop) =>
  shop.takesMomo
    ? { network: shop.momoNetwork, networkName: momoNetworkName(shop.momoNetwork), number: shop.momoNumber, name: shop.momoName }
    : null;

export const getToken = () => token;
export const setToken = (t) => {
  token = t;
};

// ----- Sign-in, standing in for Clerk -----
// Accounts sign up with email and password (`db.passwords`). A new account confirms its email with the code 123456.
const startSession = (user) => {
  const t = `tok_${user.id}_${Date.now()}`;
  db.sessions[t] = user.id;
  token = t;
};

export const restoreSession = async () => !!(token && db.sessions[token]);

let pendingSignUp = null;

export async function signUp({ name, email, password }) {
  db.passwords ??= {};
  if (db.users.some((u) => u.email === email.toLowerCase())) throw new ApiError(422, 'That email address is taken');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Invalid email');
  pendingSignUp = {
    user: {
      id: `usr_${db.users.length + 1}`,
      name,
      email: email.toLowerCase(),
      phone: null,
      accountType: 'buyer',
      referralCode: `ZM${String(db.users.length + 1).padStart(6, '0')}`,
    },
    password,
  };
  return { needsCode: true };
}

export async function verifyCode(code) {
  if (code !== FAKE_CODE) throw new ApiError(400, 'That code is not correct');
  if (!pendingSignUp) throw new ApiError(400, 'Start again: enter your email and password first.');
  db.passwords ??= {};
  const { user, password } = pendingSignUp;
  pendingSignUp = null;
  db.users.push(user);
  db.passwords[user.email] = password;
  startSession(user);
}

export async function signIn({ email, password }) {
  const user = db.users.find((u) => u.email === email.toLowerCase());
  if (!user || db.passwords?.[user.email] !== password) throw new ApiError(401, 'Password or email is incorrect');
  startSession(user);
  return {};
}

export async function signInWithGoogle() {
  throw new ApiError(0, 'Google sign-in is not available in tests');
}
export const finishGoogleSignIn = async () => {};

export async function welcome({ name, accountType, referralCode }) {
  const user = db.users.find((u) => u.id === currentUser().id);
  Object.assign(user, { ...(name ? { name } : {}), ...(accountType ? { accountType } : {}) });
  const inviter = referralCode && db.users.find((u) => u.referralCode === referralCode.toUpperCase() && u.id !== user.id);
  if (inviter && !user.referredBy) {
    user.referredBy = inviter.id;
    db.vouchers.push(newVoucher(user.id, WELCOME_VOUCHER, 'welcome'));
  }
  return currentUser();
}

export async function changePassword({ currentPassword, newPassword }) {
  const user = currentUser();
  if (db.passwords?.[user.email] !== currentPassword) throw new ApiError(400, 'Invalid password');
  db.passwords[user.email] = newPassword;
}
let resetFor = null;
export async function requestPasswordReset(email) {
  resetFor = email.toLowerCase();
  return {};
}
export async function resetPassword({ otp, password }) {
  if (otp !== FAKE_CODE) throw new ApiError(400, 'That code is not correct');
  const user = db.users.find((u) => u.email === resetFor);
  if (!user) throw new ApiError(400, 'No account has this email address');
  (db.passwords ??= {})[user.email] = password;
  startSession(user);
}

export const me = async () => currentUser();
export const logout = async () => {
  delete db.sessions[token];
  return { ok: true };
};

const live = () => db.products.filter((p) => !p.deletedAt);
export const getShops = async () =>
  copy(
    db.shops.filter(visibleShop).map((s) => ({ ...s, productCount: live().filter((p) => p.shopId === s.id).length })),
  );

// Same filters and sorts as the server's search, without the typo tolerance.
export async function searchProducts(f = {}) {
  const shopOf = (p) => db.shops.find((s) => s.id === p.shopId);
  const terms = f.q ? expandSearch(f.q) : null;
  let items = live().filter((p) => {
    const shop = shopOf(p);
    return (
      visibleShop(shop) &&
      (!f.ids || f.ids.split(',').includes(p.id)) &&
      (!terms || terms.some((t) => p.name.toLowerCase().includes(t) || p.category === t)) &&
      (!f.cat || p.category === f.cat) &&
      (!f.prov || shop.province === f.prov) &&
      (!f.town || shop.town === f.town) &&
      (!f.shop || p.shopId === f.shop) &&
      (!f.local || p.local) &&
      (!f.wholesale || p.tiers.length > 0) &&
      (!f.lowStock || p.stock <= p.lowStockAt) &&
      (!f.featured || (p.featuredUntil && new Date(p.featuredUntil) > new Date())) &&
      (!f.max || p.price <= Number(f.max))
    );
  });
  const near = { province: f.nearProv, town: f.nearTown };
  const sorts = {
    nearest: (a, b) => bandRank[band(shopOf(a), near)] - bandRank[band(shopOf(b), near)] || b.sold - a.sold,
    newest: (a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
  };
  items = [...items].sort(sorts[f.sort] ?? ((a, b) => b.sold - a.sold));
  const limit = Number(f.limit) || 24;
  const page = Number(f.page) || 1;
  return { items: copy(items.slice((page - 1) * limit, page * limit)), total: items.length, page, pageSize: limit };
}

export async function getProduct(id) {
  const p = live().find((x) => x.id === id && visibleShop(db.shops.find((s) => s.id === x.shopId)));
  if (!p) throw new ApiError(404, 'Product not found');
  return copy(p);
}

export async function provinceStats() {
  const stats = {};
  db.shops.forEach((s) => {
    stats[s.province] = stats[s.province] ?? { shops: 0, products: 0 };
    stats[s.province].shops += 1;
    stats[s.province].products += live().filter((p) => p.shopId === s.id).length;
  });
  return stats;
}

export async function createShop({ ownerName, ...shop }) {
  if (currentUser().isAdmin) throw new ApiError(403, "Zed Market staff accounts can't open a shop");
  if (!/^\d{6}\/\d{2}\/\d$/.test(shop.nrc ?? '')) throw new ApiError(400, 'Enter your NRC number like 123456/78/1');
  const user = db.users.find((u) => u.id === currentUser().id);
  if (ownerName) user.name = ownerName;
  user.accountType = 'seller';
  const created = {
    ...shop,
    id: `shop_${db.shops.length + 1}`,
    ownerId: user.id,
    rating: 0,
    since: 2026,
    verification: 'pending',
    verified: false,
    takesMomo: !!shop.momoNumber,
  };
  db.shops.push(created);
  return copy(created);
}

export async function updateShop(id, patch) {
  const shop = myShop();
  if (shop.id !== id) throw new ApiError(403, 'You can only edit your own shop');
  Object.assign(shop, patch, { takesMomo: !!(patch.momoNumber ?? shop.momoNumber) });
  return copy(shop);
}

export async function createProduct(data) {
  const shop = myShop();
  const product = {
    id: `prd_${db.products.length + 1}`,
    shopId: shop.id,
    icon: categories.find((c) => c.id === data.category)?.icon,
    sold: 0,
    rating: 0,
    reviewCount: 0,
    weightKg: 1,
    lowStockAt: 5,
    options: [],
    tiers: [],
    images: [],
    ...data,
    badge: 'New',
    createdAt: new Date().toISOString(),
  };
  db.products.push(product);
  return copy(product);
}

export async function updateProduct(id, data) {
  const product = db.products.find((p) => p.id === id && p.shopId === myShop().id);
  if (!product) throw new ApiError(404, 'Product not found in your shop');
  Object.assign(product, data);
  return copy(product);
}

export async function deleteProduct(id) {
  const product = db.products.find((p) => p.id === id && p.shopId === myShop().id);
  if (!product) throw new ApiError(404, 'Product not found in your shop');
  product.deletedAt = new Date().toISOString();
  return { ok: true };
}

export async function bulkCreateProducts(list) {
  const items = [];
  for (const data of list) items.push(await createProduct(data));
  return { created: items.length, items };
}

export const uploadImage = async () => ({ url: `/uploads/img_${Date.now()}.jpg` });

export async function productReviews(id) {
  const items = db.reviews.filter((r) => r.productId === id);
  const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  items.forEach((r) => (histogram[r.rating] += 1));
  const average = items.length ? items.reduce((s, r) => s + r.rating, 0) / items.length : 0;
  return { items: copy(items), count: items.length, average, histogram, page: 1, pageSize: 10 };
}
export const shopReviews = async (id) => copy(db.reviews.filter((r) => r.shopId === id));

export async function createReview({ orderId, productId, rating, comment = '' }) {
  const user = currentUser();
  const order = db.orders.find((o) => o.id === orderId && o.buyerId === user.id);
  const shipment = order?.shipments.find((s) => s.items.some((i) => i.id === productId));
  if (!shipment) throw new ApiError(403, 'You can only review products you bought');
  if (shipment.status !== 'delivered') throw new ApiError(409, 'You can review this once it has been delivered');
  if (db.reviews.some((r) => r.orderId === orderId && r.productId === productId))
    throw new ApiError(409, 'You already reviewed this item');
  const review = {
    id: `rev_${db.reviews.length + 1}`,
    productId,
    productName: shipment.items.find((i) => i.id === productId).name,
    shopId: shipment.shopId,
    orderId,
    author: user.name,
    rating,
    comment,
    reply: null,
    date: new Date().toISOString(),
  };
  db.reviews.push(review);
  shipment.items.filter((i) => i.id === productId).forEach((i) => (i.reviewRating = rating));
  const product = db.products.find((p) => p.id === productId);
  const mine = db.reviews.filter((r) => r.productId === productId);
  product.reviewCount = mine.length;
  product.rating = Math.round((mine.reduce((s, r) => s + r.rating, 0) / mine.length) * 10) / 10;
  return copy(review);
}

export async function replyToReview(id, reply) {
  const review = db.reviews.find((r) => r.id === id && r.shopId === myShop().id);
  if (!review) throw new ApiError(404, 'Review not found for your shop');
  review.reply = reply;
  return copy(review);
}
export const sellerReviews = async () => copy(db.reviews.filter((r) => r.shopId === myShop().id));

export async function sellerReport() {
  const shop = myShop();
  const parcels = db.orders.flatMap((o) => o.shipments.filter((s) => s.shopId === shop.id));
  return {
    days: 30,
    orders: parcels.length,
    units: parcels.reduce((n, s) => n + s.items.reduce((m, i) => m + i.qty, 0), 0),
    revenue: parcels.reduce((n, s) => n + s.subtotal, 0),
    deliveredRevenue: parcels.filter((s) => s.status === 'delivered').reduce((n, s) => n + s.subtotal, 0),
    toDispatch: parcels.filter((s) => s.status === 'pending').length,
    inTransit: parcels.filter((s) => s.status === 'dispatched').length,
    rating: shop.rating ?? 0,
    reviewCount: db.reviews.filter((r) => r.shopId === shop.id).length,
    topProducts: [],
    daily: [],
    lowStock: copy(live().filter((p) => p.shopId === shop.id && p.stock <= p.lowStockAt)),
  };
}

const newVoucher = (userId, amount, reason) => ({
  id: `vch_${db.vouchers.length + 1}`,
  userId,
  amount,
  minSpend: VOUCHER_MIN_SPEND,
  reason,
  expiresAt: new Date(Date.now() + 60 * 864e5).toISOString(),
  usedOrderId: null,
});
const usable = (v) => !v.usedOrderId && new Date(v.expiresAt) > new Date();

// Same pricing as the server, including discount codes, agreed prices and vouchers.
function priceFor(user, { items, shipping, couriers, payment, coupon, voucherId, pickupPoint }) {
  const voucherRow = voucherId && db.vouchers.find((v) => v.id === voucherId && v.userId === user.id && usable(v));
  if (voucherId && !voucherRow) throw new ApiError(409, 'That voucher has been used or has expired');
  const coupons = {};
  if (coupon) {
    const found = db.coupons.filter((c) => c.code === coupon.toUpperCase() && c.active);
    if (!found.length) throw new ApiError(409, `${coupon.toUpperCase()} isn't a valid code for the shops in your cart`);
    found.forEach((c) => (coupons[c.shopId] = { code: c.code, kind: c.kind, value: c.value, minSpend: c.minSpend }));
  }
  const quotes = Object.fromEntries(
    db.priceRequests
      .filter((r) => r.buyerId === user.id && r.status === 'accepted')
      .map((r) => [r.id, { productId: r.productId, qty: r.qty, price: r.quotedPrice }]),
  );
  try {
    return priceOrder({
      lines: items,
      getProduct: (id) => db.products.find((p) => p.id === id && !p.deletedAt),
      getShop: (id) => db.shops.find((sh) => sh.id === id),
      to: { province: shipping.province, town: shipping.town },
      picks: couriers,
      payment,
      coupons,
      quotes,
      voucher: voucherRow && { amount: voucherRow.amount, minSpend: voucherRow.minSpend },
      pickupPoint,
    });
  } catch (err) {
    if (err instanceof OrderError) throw new ApiError(409, err.message);
    throw err;
  }
}

export const quoteOrder = async (body) => copy(priceFor(currentUser(), body));

export async function placeOrder(body) {
  const { shipping, payment } = body;
  const user = currentUser();
  const priced = priceFor(user, body);
  priced.shipments.forEach((sh) =>
    sh.items.forEach((i) => {
      if (!i.quoteId) return;
      db.priceRequests.find((r) => r.id === i.quoteId).status = 'ordered';
    }),
  );
  priced.shipments.forEach((s) =>
    s.items.forEach((i) => {
      const p = db.products.find((x) => x.id === i.id);
      p.stock -= i.qty;
      p.sold += i.qty;
    }),
  );
  const order = {
    id: `ZM-TEST${db.orders.length + 1}`,
    buyerId: user.id,
    date: new Date().toISOString(),
    buyer: { name: shipping.name, phone: shipping.phone },
    shipping: { province: shipping.province, town: shipping.town, address: shipping.address },
    payment: payment === 'cod' ? 'Pay on Delivery' : 'Mobile Money',
    payByMomo: payment !== 'cod',
    paid: false,
    subtotal: priced.subtotal,
    discount: priced.discount,
    delivery: priced.delivery,
    total: priced.total,
    shipments: priced.shipments.map((s) => {
      const shop = db.shops.find((x) => x.id === s.shopId);
      return {
        ...s,
        shopProvince: shop.province,
        shopTown: shop.town,
        shopArea: shop.area,
        shopPhone: shop.phone,
        shopTpin: shop.tpin ?? null,
        shopVatRegistered: !!shop.vatRegistered,
        status: 'pending',
        tracking: '',
        due: s.subtotal - s.discount - (s.voucherDiscount ?? 0) + s.fee,
        paid: false,
        paymentSentAt: null,
        paymentRef: null,
        payTo: payment === 'cod' ? null : payTo(shop),
      };
    }),
  };
  if (body.voucherId) db.vouchers.find((v) => v.id === body.voucherId).usedOrderId = order.id;
  order.voucherDiscount = priced.voucherDiscount ?? 0;
  db.orders.unshift(order);
  return copy(order);
}

export const myOrders = async () => copy(db.orders.filter((o) => o.buyerId === currentUser().id));

export async function shopOrders() {
  const shop = myShop();
  return copy(
    db.orders
      .filter((o) => o.shipments.some((s) => s.shopId === shop.id))
      .map((o) => ({ ...o, shipments: o.shipments.filter((s) => s.shopId === shop.id) })),
  );
}

export async function updateShipment(orderId, shopId, patch) {
  if (myShop().id !== shopId) throw new ApiError(403, 'You can only update your own parcels');
  const order = db.orders.find((o) => o.id === orderId);
  const shipment = order?.shipments.find((s) => s.shopId === shopId);
  if (!shipment) throw new ApiError(404, 'Order not found');
  if (order.payByMomo && !shipment.paid)
    throw new ApiError(409, "Confirm the buyer's Mobile Money payment before sending this parcel");
  Object.assign(shipment, patch);
  return copy({ ...order, shipments: [shipment] });
}

export async function paymentSent(orderId, shopId, reference) {
  const order = db.orders.find((o) => o.id === orderId && o.buyerId === currentUser().id);
  const shipment = order?.shipments.find((s) => s.shopId === shopId);
  if (!shipment) throw new ApiError(404, 'Order not found');
  if (shipment.paid) throw new ApiError(409, 'This payment has already been confirmed');
  Object.assign(shipment, { paymentSentAt: new Date().toISOString(), paymentRef: reference || null });
  const shop = db.shops.find((x) => x.id === shopId);
  note(shop.ownerId, 'payment', `Payment sent for order ${orderId}`, 'Check it has arrived, then confirm it in My shop.', '/seller?tab=orders');
  return copy(order);
}

export async function confirmPayment(orderId, shopId) {
  if (myShop().id !== shopId) throw new ApiError(403, 'You can only update your own parcels');
  const order = db.orders.find((o) => o.id === orderId);
  const shipment = order?.shipments.find((s) => s.shopId === shopId);
  if (!shipment) throw new ApiError(404, 'Order not found');
  if (shipment.paid) throw new ApiError(409, 'This payment has already been confirmed');
  shipment.paid = true;
  order.paid = order.shipments.filter((s) => s.status !== 'cancelled').every((s) => s.paid);
  note(order.buyerId, 'payment', `${myShop().name} received your payment`, `Order ${orderId}`, '/account');
  return copy({ ...order, shipments: [shipment] });
}

// ----- Messages -----
const roleIn = (user, c) => (c.buyerId === user.id ? 'buyer' : user.shopId === c.shopId ? 'seller' : null);
const conversationView = (c, role) => {
  const shop = db.shops.find((x) => x.id === c.shopId);
  const buyer = db.users.find((u) => u.id === c.buyerId);
  const last = c.messages[c.messages.length - 1];
  return {
    id: c.id,
    role,
    shopId: c.shopId,
    shopName: shop.name,
    buyerName: buyer.name,
    withName: role === 'buyer' ? shop.name : buyer.name,
    productId: c.productId,
    productName: db.products.find((p) => p.id === c.productId)?.name ?? null,
    lastMessage: last?.body ?? '',
    lastMessageAt: last?.date ?? c.created,
    unread: c.unread[role],
  };
};
const addMessage = (c, from, body) => {
  c.messages.push({ id: `msg_${c.messages.length + 1}`, from, body, date: new Date().toISOString() });
  c.unread[from === 'buyer' ? 'seller' : 'buyer'] += 1;
};

export async function startConversation({ shopId, productId, body }) {
  const user = currentUser();
  if (!body?.trim()) throw new ApiError(400, 'Write a message');
  if (user.shopId === shopId) throw new ApiError(400, "You can't message your own shop");
  let c = db.conversations.find((x) => x.shopId === shopId && x.buyerId === user.id);
  if (!c) {
    c = {
      id: `cnv_${db.conversations.length + 1}`,
      shopId,
      buyerId: user.id,
      productId,
      messages: [],
      unread: { buyer: 0, seller: 0 },
      created: new Date().toISOString(),
    };
    db.conversations.push(c);
  }
  addMessage(c, 'buyer', body);
  return { id: c.id };
}

export async function listConversations() {
  const user = currentUser();
  return copy(db.conversations.filter((c) => roleIn(user, c)).map((c) => conversationView(c, roleIn(user, c))));
}

export async function unreadMessages() {
  const user = currentUser();
  return { count: db.conversations.reduce((n, c) => n + (roleIn(user, c) ? c.unread[roleIn(user, c)] : 0), 0) };
}

export async function getConversation(id) {
  const user = currentUser();
  const c = db.conversations.find((x) => x.id === id);
  const role = c && roleIn(user, c);
  if (!role) throw new ApiError(404, 'Conversation not found');
  c.unread[role] = 0;
  return copy({ ...conversationView(c, role), messages: c.messages });
}

export async function sendMessage(id, body) {
  const user = currentUser();
  const c = db.conversations.find((x) => x.id === id);
  const role = c && roleIn(user, c);
  if (!role) throw new ApiError(404, 'Conversation not found');
  addMessage(c, role, body);
  return { ok: true };
}

// ----- Promotions -----
export const sellerCoupons = async () => copy(db.coupons.filter((c) => c.shopId === myShop().id));
export async function createCoupon({ code, kind, value, minSpend = 0, maxUses, endsAt }) {
  const coupon = {
    id: `cpn_${db.coupons.length + 1}`,
    shopId: myShop().id,
    code: code.toUpperCase(),
    kind,
    value: Number(value),
    minSpend: Number(minSpend) || 0,
    maxUses: maxUses ? Number(maxUses) : null,
    uses: 0,
    endsAt: endsAt || null,
    active: true,
    expired: false,
  };
  db.coupons.push(coupon);
  return copy(coupon);
}
export async function setCouponActive(id, active) {
  const c = db.coupons.find((x) => x.id === id && x.shopId === myShop().id);
  c.active = active;
  return copy(c);
}
export async function featureProduct(id) {
  const p = db.products.find((x) => x.id === id && x.shopId === myShop().id);
  p.featuredUntil = new Date(Date.now() + 7 * 864e5).toISOString();
  return copy(p);
}
export async function unfeatureProduct(id) {
  const p = db.products.find((x) => x.id === id && x.shopId === myShop().id);
  p.featuredUntil = null;
  return copy(p);
}

// ----- Price requests -----
const requestView = (r) => {
  const product = db.products.find((p) => p.id === r.productId);
  const buyer = db.users.find((u) => u.id === r.buyerId);
  return {
    ...r,
    productName: product.name,
    productPrice: product.price,
    shopName: db.shops.find((x) => x.id === r.shopId).name,
    buyerName: buyer.name,
    buyerPhone: buyer.phone,
  };
};
export async function requestPrice({ productId, qty, options = {}, targetPrice, note = '', province, town }) {
  const user = currentUser();
  const product = db.products.find((p) => p.id === productId);
  const r = {
    id: `prq_${db.priceRequests.length + 1}`,
    productId,
    shopId: product.shopId,
    buyerId: user.id,
    qty: Number(qty),
    options,
    targetPrice: targetPrice ? Number(targetPrice) : null,
    note,
    province,
    town,
    status: 'open',
    quotedPrice: null,
    sellerNote: null,
    validUntil: null,
    date: new Date().toISOString(),
  };
  db.priceRequests.push(r);
  return copy(requestView(r));
}
export const myPriceRequests = async () =>
  copy(db.priceRequests.filter((r) => r.buyerId === currentUser().id).map(requestView));
export const shopPriceRequests = async () =>
  copy(db.priceRequests.filter((r) => r.shopId === myShop().id).map(requestView));
export async function respondToPriceRequest(id, body) {
  const r = db.priceRequests.find((x) => x.id === id && x.shopId === myShop().id && x.status === 'open');
  if (!r) throw new ApiError(409, 'This request has already been answered');
  if (body.decline) Object.assign(r, { status: 'declined', sellerNote: body.note ?? '' });
  else
    Object.assign(r, {
      status: 'quoted',
      quotedPrice: Number(body.price),
      sellerNote: body.note ?? '',
      validUntil: new Date(Date.now() + (body.validDays ?? 3) * 864e5).toISOString(),
    });
  return copy(requestView(r));
}
export async function acceptPriceRequest(id) {
  const r = db.priceRequests.find((x) => x.id === id && x.buyerId === currentUser().id);
  if (!r || r.status !== 'quoted') throw new ApiError(409, 'There is no price to accept yet');
  r.status = 'accepted';
  return copy(requestView(r));
}

// ----- Statements and personal data -----
export async function sellerStatement(month) {
  myShop();
  return {
    month,
    commissionRate: 0.05,
    shop: copy(myShop()),
    lines: [],
    totals: { subtotal: 0, discount: 0, delivery: 0, commission: 0, payout: 0 },
  };
}
export async function exportMyData() {
  const user = currentUser();
  return copy({ user, orders: db.orders.filter((o) => o.buyerId === user.id) });
}
export async function deleteAccount() {
  const user = currentUser();
  if (user.shopId)
    throw new ApiError(409, 'Close your shop before deleting your account. Contact support to close it.');
  db.users = db.users.filter((u) => u.id !== user.id);
  Object.keys(db.sessions).forEach((t) => db.sessions[t] === user.id && delete db.sessions[t]);
  return { ok: true };
}

// ----- Cancellations and cases -----
const findShipment = (orderId, shopId) => {
  const order = db.orders.find((o) => o.id === orderId);
  return { order, shipment: order?.shipments.find((x) => x.shopId === shopId) };
};

export async function cancelShipment(orderId, shopId, reason) {
  const user = currentUser();
  const { order, shipment } = findShipment(orderId, shopId);
  const by = order?.buyerId === user.id ? 'buyer' : user.shopId === shopId ? 'seller' : null;
  if (!by) throw new ApiError(404, 'Order not found');
  if (shipment.status !== 'pending')
    throw new ApiError(409, "This parcel has already been sent, so it can't be cancelled.");
  Object.assign(shipment, { status: 'cancelled', cancelledBy: by, cancelReason: reason });
  shipment.items.forEach((i) => {
    const p = db.products.find((x) => x.id === i.id);
    p.stock += i.qty;
    p.sold -= i.qty;
  });
  const refund = shipment.paid || (order.paid && !order.payByMomo) ? shipment.subtotal - shipment.discount + shipment.fee : 0;
  if (refund) {
    shipment.refunded = refund;
    db.refunds.push({
      id: `rfd_${db.refunds.length + 1}`,
      orderId,
      shopId,
      amount: refund,
      reason: 'cancelled',
      status: 'due',
    });
  }
  return { order: copy(order), refund };
}

const caseView = (c, viewerRole) => ({
  ...c,
  canEscalate: c.status === 'rejected',
  ...(viewerRole ? { viewerRole } : {}),
});
export async function openCase({ orderId, shopId, kind, reason, description = '', items = [], photos = [] }) {
  const user = currentUser();
  const { order, shipment } = findShipment(orderId, shopId);
  if (!order || order.buyerId !== user.id) throw new ApiError(404, 'Order not found');
  if (kind === 'return' && !items.length) throw new ApiError(400, 'Choose the items you want to return');
  const c = {
    id: `case_${db.cases.length + 1}`,
    orderId,
    shopId,
    shopName: db.shops.find((x) => x.id === shopId).name,
    buyerName: order.buyer.name,
    kind,
    reason,
    description,
    items: items.map((i) => ({ ...i, name: shipment.items.find((x) => x.id === i.productId).name })),
    photos,
    status: 'open',
    resolution: null,
    refundAmount: null,
    events: [{ at: new Date().toISOString(), by: 'buyer', action: 'opened', note: description }],
    date: new Date().toISOString(),
  };
  db.cases.push(c);
  shipment.latestCase = { id: c.id, status: 'open', kind };
  return copy(caseView(c));
}
const syncCase = (c) => {
  const { shipment } = findShipment(c.orderId, c.shopId);
  shipment.latestCase = { id: c.id, status: c.status, kind: c.kind, resolution: c.resolution };
  if (c.refundAmount) shipment.refunded = (shipment.refunded ?? 0) + c.refundAmount;
};
export const myCases = async () =>
  copy(db.cases.filter((c) => db.orders.find((o) => o.id === c.orderId).buyerId === currentUser().id));
export const shopCases = async () => copy(db.cases.filter((c) => c.shopId === myShop().id).map((c) => caseView(c)));
export async function getCase(id) {
  const user = currentUser();
  const c = db.cases.find((x) => x.id === id);
  const buyerId = c && db.orders.find((o) => o.id === c.orderId).buyerId;
  const role = !c
    ? null
    : buyerId === user.id
      ? 'buyer'
      : user.shopId === c.shopId
        ? 'shop'
        : user.isAdmin
          ? 'staff'
          : null;
  if (!role) throw new ApiError(404, 'Case not found');
  return copy(caseView(c, role));
}
export async function respondToCase(id, { accept, resolution, refundAmount, note = '' }) {
  const c = db.cases.find((x) => x.id === id && x.shopId === myShop().id);
  if (!c || c.status !== 'open') throw new ApiError(409, 'This case has already been answered');
  const { order, shipment } = findShipment(c.orderId, c.shopId);
  if (accept) {
    c.status = 'accepted';
    c.resolution = resolution;
    if (resolution === 'refund') {
      c.refundAmount = Number(refundAmount) || shipment.subtotal - shipment.discount + shipment.fee;
      db.refunds.push({
        id: `rfd_${db.refunds.length + 1}`,
        orderId: order.id,
        shopId: c.shopId,
        amount: c.refundAmount,
        reason: 'return',
        status: 'due',
      });
    }
  } else {
    c.status = 'rejected';
    c.resolution = 'rejected';
  }
  c.events.push({
    at: new Date().toISOString(),
    by: 'shop',
    action: accept ? `accepted: ${resolution}` : 'rejected',
    note,
  });
  syncCase(c);
  return copy(caseView(c));
}
export async function escalateCase(id, note = '') {
  const c = db.cases.find((x) => x.id === id);
  if (c.status !== 'rejected') throw new ApiError(409, 'The shop has 3 days to answer first');
  c.status = 'escalated';
  c.events.push({ at: new Date().toISOString(), by: 'buyer', action: 'escalated', note });
  syncCase(c);
  return copy(caseView(c));
}
export async function withdrawCase(id) {
  const c = db.cases.find((x) => x.id === id);
  c.status = 'withdrawn';
  syncCase(c);
  return copy(caseView(c));
}

// ----- Verification -----
export async function sellerVerification() {
  const shop = myShop();
  return copy({
    status: shop.verification ?? 'unverified',
    note: shop.verificationNote ?? null,
    ownerFullName: shop.ownerFullName ?? null,
    nrc: shop.nrc ?? null,
    pacra: shop.pacra ?? null,
    suspended: !!shop.suspended,
    suspendReason: shop.suspendReason ?? null,
  });
}
export async function submitVerification({ ownerFullName, nrc, pacra }) {
  if (!/^\d{6}\/\d{2}\/\d$/.test(nrc ?? '')) throw new ApiError(400, 'Enter your NRC number like 123456/78/1');
  Object.assign(myShop(), { ownerFullName, nrc, pacra, verification: 'pending' });
  return { status: 'pending' };
}
export const removedProducts = async () =>
  copy(db.products.filter((p) => p.shopId === myShop().id && p.removedReason && p.deletedAt));

// ----- Staff -----
const staff = () => {
  const user = currentUser();
  if (!user.isAdmin) throw new ApiError(403, 'Staff only');
  return user;
};
const log = (action, targetType, targetId, note = '') =>
  db.actions.unshift({
    id: `act_${db.actions.length + 1}`,
    admin: staff().name,
    action,
    targetType,
    targetId,
    note,
    date: new Date().toISOString(),
  });

export const admin = {
  async stats() {
    staff();
    return {
      users: db.users.length,
      shops: db.shops.length,
      shopsToVerify: db.shops.filter((x) => x.verification === 'pending').length,
      products: live().length,
      orders7d: db.orders.length,
      sales7d: db.orders.reduce((n, o) => n + o.total, 0),
      lateDispatch: 0,
      escalatedCases: db.cases.filter((c) => c.status === 'escalated').length,
      openCases: db.cases.filter((c) => c.status === 'open').length,
      refundsDue: db.refunds.filter((r) => r.status === 'due').length,
      refundsDueAmount: db.refunds.filter((r) => r.status === 'due').reduce((n, r) => n + r.amount, 0),
      supportWaiting: db.tickets.filter((t) => t.status === 'open' && t.staffUnread > 0).length,
      payoutsReady: 0,
      payoutsReadyAmount: 0,
    };
  },
  async shops({ status } = {}) {
    staff();
    return copy(
      db.shops
        .filter((x) => !status || (x.verification ?? 'unverified') === status)
        .map((x) => ({
          ...x,
          verification: x.verification ?? 'unverified',
          productCount: live().filter((p) => p.shopId === x.id).length,
        })),
    );
  },
  async verifyShop(id, status, note) {
    Object.assign(
      db.shops.find((x) => x.id === id),
      { verification: status, verified: status === 'verified', verificationNote: note },
    );
    log(`shop ${status}`, 'shop', id, note);
    return { ok: true };
  },
  async deleteShop(id, reason) {
    owner();
    const shop = db.shops.find((x) => x.id === id);
    if (!shop) throw new ApiError(404, 'Shop not found');
    const parcels = db.orders.flatMap((o) => o.shipments.filter((s) => s.shopId === id));
    const open = parcels.filter((s) => ['pending', 'dispatched'].includes(s.status));
    open.forEach((s) => Object.assign(s, { status: 'cancelled', cancelledBy: 'admin', cancelReason: `${shop.name} is no longer on Zed Market` }));
    db.products.filter((p) => p.shopId === id).forEach((p) => (p.deletedAt = new Date().toISOString()));
    if (shop.ownerId) note(shop.ownerId, 'shop', `Zed Market removed your shop ${shop.name}`, reason, '/help');
    db.shops.splice(db.shops.indexOf(shop), 1);
    log('shop deleted', 'shop', id, `${shop.name}: ${reason}`);
    return { ok: true, kept: parcels.length > 0, cancelled: open.length };
  },
  async suspendShop(id, suspended, reason) {
    Object.assign(
      db.shops.find((x) => x.id === id),
      { suspended, suspendReason: suspended ? reason : null },
    );
    log(suspended ? 'shop suspended' : 'shop restored', 'shop', id, reason);
    return { ok: true };
  },
  async products({ q = '', status } = {}) {
    staff();
    return copy(
      db.products
        .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
        .filter((p) => !status || (status === 'removed' ? p.removedReason : !p.deletedAt))
        .slice(0, 100)
        .map((p) => ({ ...p, shopName: db.shops.find((x) => x.id === p.shopId)?.name, removed: !!p.deletedAt })),
    );
  },
  async removeProduct(id, reason) {
    Object.assign(
      db.products.find((p) => p.id === id),
      { deletedAt: new Date().toISOString(), removedReason: reason },
    );
    log('listing removed', 'product', id, reason);
    return { ok: true };
  },
  async restoreProduct(id) {
    Object.assign(
      db.products.find((p) => p.id === id),
      { deletedAt: null, removedReason: null },
    );
    log('listing restored', 'product', id);
    return { ok: true };
  },
  reviews: async () => (staff(), copy(db.reviews)),
  async removeReview(id, reason) {
    db.reviews = db.reviews.filter((r) => r.id !== id);
    log('review removed', 'review', id, reason);
    return { ok: true };
  },
  users: async () =>
    (staff(),
    copy(
      db.users.map((u) => ({
        ...u,
        role: u.admin ? 'owner' : u.staff ? 'staff' : null,
        shopId: db.shops.find((sh) => sh.ownerId === u.id)?.id ?? null,
        orderCount: 0,
        suspended: !!u.suspended,
      })),
    )),
  async suspendUser(id, suspended, reason) {
    Object.assign(
      db.users.find((u) => u.id === id),
      { suspended, suspendReason: suspended ? reason : null },
    );
    log(suspended ? 'user suspended' : 'user restored', 'user', id, reason);
    return { ok: true };
  },
  async deleteUser(id, reason) {
    owner();
    const u = db.users.find((x) => x.id === id);
    if (!u) throw new ApiError(404, 'User not found');
    if (db.shops.some((sh) => sh.ownerId === id)) throw new ApiError(409, 'Delete the shop under Shops first.');
    const open = db.orders.filter((o) => o.buyerId === id).flatMap((o) => o.shipments.filter((sh) => ['pending', 'dispatched'].includes(sh.status)));
    open.forEach((sh) => Object.assign(sh, { status: 'cancelled', cancelledBy: 'admin', cancelReason: "The buyer's account was closed" }));
    db.users.splice(db.users.indexOf(u), 1);
    log('user deleted', 'user', id, `${u.name}: ${reason}`);
    return { ok: true, cancelled: open.length };
  },
  orders: async () => (staff(), copy(db.orders)),
  async cancelShipment(orderId, shopId, reason) {
    const { shipment } = findShipment(orderId, shopId);
    Object.assign(shipment, { status: 'cancelled', cancelledBy: 'admin', cancelReason: reason });
    log('parcel cancelled', 'order', orderId, reason);
    return { refund: 0 };
  },
  cases: async ({ status } = {}) => (
    staff(),
    copy(db.cases.filter((c) => !status || c.status === status).map((c) => ({ ...caseView(c), refundableLeft: 1000 })))
  ),
  async decideCase(id, { outcome, refundAmount, note }) {
    const c = db.cases.find((x) => x.id === id);
    c.status = 'resolved';
    c.resolution = outcome === 'refund' ? 'refund' : 'rejected';
    if (outcome === 'refund') {
      c.refundAmount = Number(refundAmount);
      db.refunds.push({
        id: `rfd_${db.refunds.length + 1}`,
        orderId: c.orderId,
        shopId: c.shopId,
        amount: c.refundAmount,
        reason: 'return',
        status: 'due',
      });
    }
    c.events.push({ at: new Date().toISOString(), by: 'staff', action: `decided: ${outcome}`, note });
    syncCase(c);
    log(`case decided: ${outcome}`, 'case', id, note);
    return copy(caseView(c));
  },
  refunds: async ({ status } = {}) => (
    staff(),
    copy(
      db.refunds
        .filter((r) => !status || r.status === status)
        .map((r) => ({
          ...r,
          buyerName: 'Buyer',
          buyerPhone: '',
          paymentMethod: 'mtn',
          shopName: '',
          date: new Date().toISOString(),
        })),
    )
  ),
  async markRefundPaid(id, reference) {
    Object.assign(
      db.refunds.find((r) => r.id === id),
      { status: 'paid', reference },
    );
    log('refund paid', 'refund', id, reference);
    return { ok: true };
  },
  actions: async () => (staff(), copy(db.actions)),
};

// ---------- Notifications, support, buying requests, vouchers ----------
const note = (userId, kind, title, body = '', link = null) =>
  db.notifications.unshift({
    id: `ntf_${db.notifications.length + 1}`,
    userId,
    kind,
    title,
    body,
    link,
    read: false,
    date: new Date().toISOString(),
  });
export const __notify = note;

export const notifications = async () => copy(db.notifications.filter((n) => n.userId === currentUser().id));
export async function counts() {
  const user = currentUser();
  const shop = db.shops.find((s) => s.ownerId === user.id);
  const { count } = await unreadMessages();
  return {
    notifications: db.notifications.filter((n) => n.userId === user.id && !n.read).length,
    messages: count + db.tickets.filter((t) => t.userId === user.id).reduce((n, t) => n + t.userUnread, 0),
    toDispatch: shop
      ? db.orders.flatMap((o) => o.shipments).filter((x) => x.shopId === shop.id && x.status === 'pending').length
      : 0,
  };
}
export async function markNotificationsRead(ids) {
  const user = currentUser();
  db.notifications
    .filter((n) => n.userId === user.id && (!ids || ids.includes(n.id)))
    .forEach((n) => (n.read = true));
  return { ok: true };
}

const ticketView = (t, reader) => ({
  id: t.id,
  subject: t.subject,
  status: t.status,
  orderId: null,
  userName: db.users.find((u) => u.id === t.userId)?.name,
  userPhone: db.users.find((u) => u.id === t.userId)?.phone,
  unread: reader === 'staff' ? t.staffUnread : t.userUnread,
  lastMessageAt: t.messages.at(-1).date,
  date: t.messages[0].date,
});
const supportMessage = (t, fromStaff, author, body) => {
  t.messages.push({ id: `smg_${t.messages.length + 1}`, fromStaff, author, body, date: new Date().toISOString() });
  if (fromStaff) t.userUnread += 1;
  else t.staffUnread += 1;
  t.status = 'open';
};
export async function openSupportTicket({ subject, body }) {
  const user = currentUser();
  if (!subject?.trim() || !body?.trim()) throw new ApiError(400, 'Tell us what it is about');
  const t = {
    id: `tkt_${db.tickets.length + 1}`,
    userId: user.id,
    subject,
    status: 'open',
    userUnread: 0,
    staffUnread: 0,
    messages: [],
  };
  supportMessage(t, false, user.name, body);
  db.tickets.push(t);
  return { id: t.id };
}
export const supportTickets = async () =>
  copy(db.tickets.filter((t) => t.userId === currentUser().id).map((t) => ticketView(t, 'user')));
export async function supportTicket(id) {
  const t = db.tickets.find((x) => x.id === id && x.userId === currentUser().id);
  if (!t) throw new ApiError(404, 'Not found');
  t.userUnread = 0;
  return copy({ ...ticketView(t, 'user'), messages: t.messages });
}
export async function replySupport(id, body) {
  const user = currentUser();
  supportMessage(
    db.tickets.find((x) => x.id === id && x.userId === user.id),
    false,
    user.name,
    body,
  );
  return { ok: true };
}
export const adminSupport = {
  async list(status) {
    staff();
    return copy(db.tickets.filter((t) => !status || t.status === status).map((t) => ticketView(t, 'staff')));
  },
  async get(id) {
    staff();
    const t = db.tickets.find((x) => x.id === id);
    t.staffUnread = 0;
    return copy({ ...ticketView(t, 'staff'), messages: t.messages });
  },
  async reply(id, body) {
    staff();
    const t = db.tickets.find((x) => x.id === id);
    supportMessage(t, true, 'Zed Market support', body);
    note(t.userId, 'support', 'Zed Market replied to your question', body, `/help/${id}`);
    return { ok: true };
  },
  async setStatus(id, status) {
    staff();
    db.tickets.find((x) => x.id === id).status = status;
    return { ok: true };
  },
};

const buyingView = (r, user) => {
  const shop = user && db.shops.find((s) => s.ownerId === user.id);
  const mine = user?.id === r.buyerId;
  return {
    ...r,
    buyerName: db.users.find((u) => u.id === r.buyerId)?.name.split(' ')[0],
    mine,
    offerCount: r.offers.length,
    offers: mine ? r.offers : r.offers.filter((o) => o.shopId === shop?.id),
  };
};
export const buyingRequests = async ({ q = '', cat = '', prov = '' } = {}) =>
  copy(
    db.requests
      .filter((r) => r.status === 'open')
      .filter((r) => (!cat || r.category === cat) && (!prov || r.province === prov))
      .filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase()))
      .map((r) => buyingView(r, viewer())),
  );
export const myBuyingRequests = async () =>
  copy(db.requests.filter((r) => r.buyerId === currentUser().id).map((r) => buyingView(r, currentUser())));
export async function buyingRequest(id) {
  const r = db.requests.find((x) => x.id === id);
  if (!r) throw new ApiError(404, 'Request not found');
  return copy(buyingView(r, viewer()));
}
export async function postBuyingRequest(body) {
  const user = currentUser();
  if (!body.title || body.title.trim().length < 3) throw new ApiError(400, 'Say what you are looking for');
  if (!(Number(body.qty) >= 1)) throw new ApiError(400, 'Enter how many you need');
  const r = {
    id: `brq_${db.requests.length + 1}`,
    buyerId: user.id,
    title: body.title.trim(),
    description: body.description ?? '',
    category: body.category || null,
    qty: Number(body.qty),
    unit: body.unit || 'units',
    budget: body.budget ? Number(body.budget) : null,
    province: body.province,
    town: body.town,
    status: 'open',
    acceptedOfferId: null,
    date: new Date().toISOString(),
    offers: [],
  };
  db.requests.unshift(r);
  return copy(buyingView(r, user));
}
export async function sendOffer(id, { price, note: text = '' }) {
  const shop = myShop();
  if (!isLiveShop(shop)) throw new ApiError(403, 'Your shop must be approved before you can send offers');
  if (!(Number(price) > 0)) throw new ApiError(400, 'Enter your price');
  const r = db.requests.find((x) => x.id === id);
  r.offers = r.offers.filter((o) => o.shopId !== shop.id);
  r.offers.push({
    id: `ofr_${shop.id}`,
    shopId: shop.id,
    shopName: shop.name,
    shopTown: shop.town,
    shopVerified: true,
    price: Number(price),
    note: text,
    productId: null,
    date: new Date().toISOString(),
  });
  note(r.buyerId, 'offer', `New offer for "${r.title}"`, `${shop.name}: K${price} each`, `/requests/${r.id}`);
  return { ok: true };
}
export async function acceptOffer(id, offerId) {
  const r = db.requests.find((x) => x.id === id && x.buyerId === currentUser().id);
  Object.assign(r, { status: 'closed', acceptedOfferId: offerId });
  return { ok: true };
}
export async function closeBuyingRequest(id) {
  db.requests.find((x) => x.id === id && x.buyerId === currentUser().id).status = 'closed';
  return { ok: true };
}

export const myVouchers = async () =>
  copy(db.vouchers.filter((v) => v.userId === currentUser().id).map((v) => ({ ...v, usable: usable(v) })));
export async function myReferral() {
  const user = db.users.find((u) => u.id === currentUser().id);
  return {
    code: user.referralCode,
    invited: db.users.filter((u) => u.referredBy === user.id).length,
    rewarded: db.vouchers.filter((v) => v.userId === user.id && v.reason === 'referral').length,
  };
}
export const __addVoucher = (userId, amount, reason = 'welcome') => {
  const v = newVoucher(userId, amount, reason);
  db.vouchers.push(v);
  return v;
};

// ---------- Admin tools: banners, campaigns, announcements, payouts, analytics ----------
const extra = () => {
  db.banners ??= [];
  db.campaigns ??= [];
  db.announcements ??= [];
  db.payouts ??= [];
  return db;
};
const audienceUsers = ({ audience, province, phone }) =>
  db.users.filter((u) => {
    if (audience === 'buyers') return ['buyer', 'business'].includes(u.accountType);
    if (audience === 'sellers') return db.shops.some((s) => s.ownerId === u.id);
    if (audience === 'province')
      return db.shops.some((s) => s.ownerId === u.id && s.province === province) ||
        db.orders.some((o) => o.buyerId === u.id && o.shipping.province === province);
    if (audience === 'phone') return normalizePhone(u.phone) === normalizePhone(phone ?? '');
    return true;
  });

// Simplified balances: every delivered parcel counts as cleared.
function balanceOf(shopId) {
  const parcels = db.orders.flatMap((o) =>
    o.shipments.filter((s) => s.shopId === shopId && s.status === 'delivered').map((s) => ({ s, o })),
  );
  const earned = parcels.reduce((n, { s, o }) => {
    const goods = s.subtotal - (s.discount ?? 0);
    const commission = Math.round(goods * 5) / 100;
    // Only orders paid to Zed Market earn a payout of the goods; Mobile Money and cash go straight to the shop.
    return n + (o.paid && !o.payByMomo ? goods + s.fee - commission : (s.voucherDiscount ?? 0) - commission);
  }, 0);
  const sumOf = (kind) =>
    extra()
      .payouts.filter((p) => p.shopId === shopId && (p.kind ?? 'payout') === kind)
      .reduce((n, p) => n + p.amount, 0);
  const paidOut = sumOf('payout');
  const commissionPaid = sumOf('commission');
  const available = earned - paidOut + commissionPaid;
  return {
    shopId,
    earned,
    onHold: 0,
    refunds: 0,
    paidOut,
    commissionPaid,
    parcels: parcels.length,
    available,
    owed: Math.max(0, -available),
  };
}

export const banners = async () =>
  copy(extra().banners.filter((b) => b.active).sort((a, b) => a.position - b.position));
export async function sellerPayouts() {
  const shop = myShop();
  return copy({
    ...balanceOf(shop.id),
    history: extra().payouts.filter((p) => p.shopId === shop.id),
    payTo: db.commissionAccount ?? null,
  });
}

Object.assign(admin, {
  async analytics(days) {
    staff();
    const gmv = db.orders.reduce((n, o) => n + o.total, 0);
    return copy({
      days,
      orders: db.orders.length,
      buyers: new Set(db.orders.map((o) => o.buyerId)).size,
      gmv,
      averageOrder: db.orders.length ? gmv / db.orders.length : 0,
      commission: 0,
      vouchers: 0,
      refunds: 0,
      cancellationRate: 0,
      delivered: 0,
      newUsers: db.users.length,
      newShops: 0,
      daily: Array.from({ length: days }, (_, i) => ({
        day: new Date(Date.now() - (days - 1 - i) * 864e5).toISOString(),
        orders: i === days - 1 ? db.orders.length : 0,
        gmv: i === days - 1 ? gmv : 0,
        users: 0,
      })),
      provinces: [],
      shops: [],
      categories: [],
      payments: [],
      couriers: [],
    });
  },
  async payouts() {
    staff();
    return copy(
      db.shops
        .filter((s) => s.ownerId)
        .map((s) => ({ ...balanceOf(s.id), shopName: s.name, shopTown: s.town, shopPhone: s.phone })),
    );
  },
  async payoutHistory() {
    staff();
    return copy(extra().payouts);
  },
  async pay({ shopId, amount, method, reference }) {
    staff();
    if (Number(amount) > balanceOf(shopId).available) throw new ApiError(409, 'More than is available');
    const shop = db.shops.find((s) => s.id === shopId);
    const p = { id: `pay_${extra().payouts.length + 1}`, shopId, shopName: shop.name, amount: Number(amount), method, reference, date: new Date().toISOString() };
    extra().payouts.unshift(p);
    note(shop.ownerId, 'payout', `Zed Market paid you K${amount}`, `Reference ${reference}`, '/seller?tab=report');
    return copy(p);
  },
  async commissionAccount() {
    staff();
    return copy(db.commissionAccount ?? null);
  },
  async saveCommissionAccount(body) {
    staff();
    db.commissionAccount = { ...body };
    return copy(body);
  },
  async receiveCommission({ shopId, amount, method, reference }) {
    staff();
    const shop = db.shops.find((s) => s.id === shopId);
    if (Number(amount) > balanceOf(shopId).owed) throw new ApiError(409, `${shop.name} doesn't owe that much`);
    const p = { id: `pay_${extra().payouts.length + 1}`, kind: 'commission', shopId, shopName: shop.name, amount: Number(amount), method, reference, date: new Date().toISOString() };
    extra().payouts.unshift(p);
    note(shop.ownerId, 'payout', `Zed Market received your K${amount} commission`, `Reference ${reference}`, '/seller?tab=report');
    return copy(p);
  },
  async remindCommission(shopId) {
    staff();
    const shop = db.shops.find((s) => s.id === shopId);
    const { owed } = balanceOf(shopId);
    if (!owed) throw new ApiError(409, `${shop.name} doesn't owe any commission`);
    note(shop.ownerId, 'payout', `Please pay K${owed} commission`, '', '/seller?tab=report');
    return { ok: true, owed };
  },
  async banners() {
    staff();
    return copy(extra().banners.map((b) => ({ ...b, live: b.active })));
  },
  async createBanner(body) {
    staff();
    if (!body.title || body.title.length < 3) throw new ApiError(400, 'Give the banner a title');
    const b = { id: `bnr_${extra().banners.length + 1}`, active: true, position: 0, ...body };
    db.banners.push(b);
    return copy(b);
  },
  async updateBanner(id, patch) {
    staff();
    Object.assign(extra().banners.find((b) => b.id === id), patch);
    return { ok: true };
  },
  async deleteBanner(id) {
    staff();
    db.banners = extra().banners.filter((b) => b.id !== id);
    return { ok: true };
  },
  async campaigns() {
    staff();
    return copy(extra().campaigns);
  },
  async createCampaign(body) {
    staff();
    const users = audienceUsers(body);
    if (body.audience === 'phone' && !users.length) throw new ApiError(404, 'No customer has that phone number');
    const c = {
      id: `cmp_${extra().campaigns.length + 1}`,
      name: body.name,
      amount: Number(body.amount),
      minSpend: Number(body.minSpend),
      audience: body.audience,
      province: body.province,
      expiresAt: new Date(Date.now() + Number(body.days) * 864e5).toISOString(),
      issued: users.length,
      used: 0,
    };
    db.campaigns.unshift(c);
    users.forEach((u) => {
      const v = newVoucher(u.id, c.amount, 'campaign');
      Object.assign(v, { minSpend: c.minSpend, note: c.name, campaignId: c.id, expiresAt: c.expiresAt });
      db.vouchers.push(v);
      note(u.id, 'voucher', `🎁 K${c.amount} voucher: ${c.name}`, '', '/account?tab=invite');
    });
    return { id: c.id, issued: users.length };
  },
  async announcements() {
    staff();
    return copy(extra().announcements);
  },
  async announce(body) {
    staff();
    const users = audienceUsers(body);
    users.forEach((u) => note(u.id, 'announcement', body.title, body.body, body.link || null));
    const a = { id: `ann_${extra().announcements.length + 1}`, ...body, sent: users.length, date: new Date().toISOString() };
    db.announcements.unshift(a);
    return { id: a.id, sent: users.length };
  },
  async requests({ status = 'open' } = {}) {
    staff();
    return copy(
      db.requests
        .filter((r) => (status === 'removed' ? r.status === 'removed' : status === 'all' || r.status === 'open'))
        .map((r) => buyingView(r, null)),
    );
  },
  async removeRequest(id, reason) {
    staff();
    Object.assign(
      db.requests.find((r) => r.id === id),
      { status: 'removed', removedReason: reason },
    );
    return { ok: true };
  },
});

// ---------- Staff, settings and acting for shops ----------
const defaultSettings = { commissionRate: 0.05, welcomeVoucher: 50, referralReward: 50, voucherMinSpend: 300, voucherDays: 60, unpaidCancelHours: 24 };
const settingsNow = () => ({ ...defaultSettings, ...(db.settings ?? {}) });
export const settings = async () => copy(settingsNow());
const owner = () => {
  if (currentUser().staffRole !== 'owner') throw new ApiError(403, 'Only Zed Market owners can do this');
};

Object.assign(admin, {
  async staff() {
    staff();
    return copy(
      db.users
        .filter((u) => u.admin || u.staff)
        .map((u) => ({ id: u.id, name: u.name, email: u.email ?? null, phone: u.phone, role: u.admin ? 'owner' : 'staff', since: null })),
    );
  },
  async addStaff({ email, name }) {
    owner();
    let user = db.users.find((u) => u.email === email.toLowerCase());
    if (user && db.shops.some((x) => x.ownerId === user.id)) throw new ApiError(409, `${user.name} owns a shop`);
    if (!user) {
      user = { id: `usr_${db.users.length + 1}`, name: name || 'Zed Market staff', email: email.toLowerCase(), phone: null, accountType: 'admin' };
      db.users.push(user);
    }
    user.staff = true;
    return copy({ id: user.id, name: user.name, email: user.email, role: 'staff' });
  },
  async removeStaff(id) {
    owner();
    db.users.find((u) => u.id === id).staff = false;
    return { ok: true };
  },
  async settings() {
    staff();
    return copy({ values: settingsNow(), defaults: defaultSettings });
  },
  async saveSettings(body) {
    owner();
    db.settings = { ...(db.settings ?? {}), ...body };
    return copy(settingsNow());
  },
  async shop(id) {
    staff();
    return copy(db.shops.find((x) => x.id === id));
  },
  async editShop(id, { note: why, ...body }) {
    staff();
    if (!why || why.trim().length < 3) throw new ApiError(400, 'Give a reason');
    const shop = db.shops.find((x) => x.id === id);
    Object.assign(shop, body);
    note(shop.ownerId, 'shop', 'Zed Market updated your shop details', why, '/seller?tab=settings');
    return copy(shop);
  },
  async editProduct(id, { note: why, ...body }) {
    staff();
    if (!why || why.trim().length < 3) throw new ApiError(400, 'Give a reason');
    const product = db.products.find((p) => p.id === id);
    Object.assign(product, body);
    return copy(product);
  },
  async confirmPayment(orderId, shopId, why) {
    staff();
    const order = db.orders.find((o) => o.id === orderId);
    const shipment = order.shipments.find((x) => x.shopId === shopId);
    if (shipment.paid) throw new ApiError(409, 'This payment has already been confirmed');
    shipment.paid = true;
    order.paid = order.shipments.filter((s) => s.status !== 'cancelled').every((s) => s.paid);
    log('payment confirmed', 'order', orderId, why);
    note(order.buyerId, 'payment', 'The shop received your payment', `Order ${orderId}`, '/account');
    return copy(order);
  },
  async setParcelStatus(orderId, shopId, { status, note: why }) {
    staff();
    const order = db.orders.find((o) => o.id === orderId);
    const shipment = order.shipments.find((x) => x.shopId === shopId);
    const next = { pending: 'dispatched', dispatched: 'delivered' }[shipment.status];
    if (next !== status) throw new ApiError(409, `A ${shipment.status} parcel can't be marked ${status}`);
    shipment.status = status;
    note(order.buyerId, 'order', status === 'delivered' ? 'Delivered' : 'On its way', why, '/account');
    return copy(order);
  },
});

// ---------- Delivery settings ----------
const deliveryView = () => ({
  couriers: Object.fromEntries(
    courierList.map((c) => [c.id, { ...Object.fromEntries(EDITABLE_COURIER_FIELDS.map((k) => [k, c[k]])), confirmed: !!db.delivery?.couriers?.[c.id] }]),
  ),
  points: copy(pickupPoints),
  pointsConfirmed: !!db.delivery?.points,
});
export const delivery = async () => deliveryView();
Object.assign(admin, {
  async delivery() {
    staff();
    return deliveryView();
  },
  async saveCourier(id, body) {
    owner();
    db.delivery = { ...(db.delivery ?? {}), couriers: { ...(db.delivery?.couriers ?? {}), [id]: body } };
    applyDeliveryConfig(db.delivery);
    return deliveryView();
  },
  async savePoints(points) {
    owner();
    db.delivery = { ...(db.delivery ?? {}), points };
    applyDeliveryConfig(db.delivery);
    return deliveryView();
  },
});
