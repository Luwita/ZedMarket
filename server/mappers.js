// Turn database rows into the camelCase shapes the React app uses.
import { momoNetworkName } from '../src/data/catalog.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));
export const displayPhone = (normalised) => (normalised ? `0${normalised}` : null);

export const toUser = (row, shopId = null) => ({
  id: row.id,
  name: row.name,
  phone: displayPhone(row.phone),
  accountType: row.account_type,
  shopId,
});

export const toShop = (row) => ({
  id: row.id,
  ownerId: row.owner_id,
  name: row.name,
  logo: row.logo,
  category: row.category,
  province: row.province,
  town: row.town,
  area: row.area,
  phone: row.phone,
  couriers: row.couriers,
  ownRates: row.own_rates,
  rating: num(row.rating),
  reviewCount: row.review_count ?? 0,
  productCount: row.product_count ?? null,
  verified: row.verification === 'verified',
  verification: row.verification ?? 'unverified',
  suspended: !!row.suspended_at,
  tpin: row.tpin ?? null,
  banner: row.banner ?? null,
  about: row.about ?? null,
  openingHours: row.opening_hours ?? null,
  vatRegistered: row.vat_registered ?? false,
  takesMomo: !!row.momo_number,
  lat: num(row.lat),
  lng: num(row.lng),
  since: row.since,
});

// A shop's Mobile Money number: shown to its owner, to staff, and to buyers on their own orders.
const toMomo = (network, number, name) =>
  number ? { network, networkName: momoNetworkName(network), number: displayPhone(number), name } : null;

// The owner's and staff's view of a shop, with the Mobile Money details buyers pay to.
export const toOwnShop = (row) => ({
  ...toShop(row),
  momoNetwork: row.momo_network ?? '',
  momoNumber: row.momo_number ? displayPhone(row.momo_number) : '',
  momoName: row.momo_name ?? '',
});

export const toProduct = (row) => ({
  id: row.id,
  shopId: row.shop_id,
  name: row.name,
  category: row.category,
  condition: row.condition ?? 'new',
  icon: row.icon,
  description: row.description,
  price: num(row.price),
  oldPrice: num(row.old_price),
  tiers: row.tiers,
  stock: row.stock,
  sold: row.sold,
  rating: num(row.rating),
  reviewCount: row.review_count ?? 0,
  badge: row.badge,
  local: row.local,
  images: row.images,
  weightKg: num(row.weight_kg) ?? 1,
  options: row.options ?? [],
  lowStockAt: row.low_stock_at ?? 5,
  featuredUntil: row.featured_until ?? null,
  sourceProductId: row.source_product_id ?? null,
  createdAt: row.created_at,
});

// `shipments` rows must carry shop_name, shop_province, shop_town and an `items` JSON array.
// With Mobile Money the buyer pays each shop separately, so every parcel has its own `paid`.
export const toOrder = (order, shipments) => {
  const payByMomo = order.payment_status === 'momo_direct';
  const isPaid = (s) => order.payment_status === 'paid' || !!s.paid_at;
  const live = shipments.filter((s) => s.status !== 'cancelled');
  return {
    id: order.id,
    date: order.created_at,
    buyer: { name: order.buyer_name, phone: order.buyer_phone },
    shipping: { province: order.province, town: order.town, address: order.address, lat: num(order.lat), lng: num(order.lng) },
    payment: order.payment_method,
    payByMomo,
    paid: live.length > 0 && live.every(isPaid),
    paymentStatus: order.payment_status,
    subtotal: num(order.subtotal),
    discount: num(order.discount) ?? 0,
    voucherDiscount: num(order.voucher_discount) ?? 0,
    delivery: num(order.delivery),
    total: num(order.total),
    shipments: shipments.map((s) => ({
      id: s.id,
      shopId: s.shop_id,
      shopName: s.shop_name,
      shopProvince: s.shop_province,
      shopTown: s.shop_town,
      shopArea: s.shop_area,
      shopPhone: s.shop_phone,
      shopTpin: s.shop_tpin,
      shopVatRegistered: s.shop_vat_registered,
      items: s.items.map((i) => ({
        id: i.product_id,
        name: i.name,
        options: i.options ?? '',
        qty: i.qty,
        price: num(i.unit_price),
        reviewRating: i.review_rating ?? null,
        quoteId: i.price_request_id ?? null,
      })),
      subtotal: num(s.subtotal),
      discount: num(s.discount) ?? 0,
      couponCode: s.coupon_code,
      voucherDiscount: num(s.voucher_discount) ?? 0,
      pickupPoint: s.pickup_point ?? null,
      courier: s.courier,
      courierName: s.courier_name,
      fee: num(s.fee),
      eta: s.eta,
      status: s.status,
      tracking: s.tracking,
      deliveredAt: s.delivered_at ?? null,
      cancelledBy: s.cancelled_by ?? null,
      cancelReason: s.cancel_reason ?? null,
      latestCase: s.latest_case ?? null,
      refunded: num(s.refunded) ?? 0,
      refundsPaid: s.refunds_paid ?? null,
      // What the buyer pays this shop: goods after discounts and any Zed Market voucher, plus delivery.
      due: num(s.subtotal) - (num(s.discount) ?? 0) - (num(s.voucher_discount) ?? 0) + num(s.fee),
      paid: isPaid(s),
      paidAt: s.paid_at ?? null,
      paymentSentAt: s.payment_sent_at ?? null,
      paymentRef: s.payment_ref ?? null,
      payTo: payByMomo ? toMomo(s.shop_momo_network, s.shop_momo_number, s.shop_momo_name) : null,
    })),
  };
};

export const toReview = (row) => ({
  id: row.id,
  productId: row.product_id,
  productName: row.product_name,
  shopId: row.shop_id,
  orderId: row.order_id,
  author: row.author_name,
  rating: row.rating,
  comment: row.comment,
  reply: row.reply,
  repliedAt: row.replied_at,
  date: row.created_at,
});
