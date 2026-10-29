// Request validation shared by the API routes.
import { z } from 'zod';
import { categories, conditions, momoNetworks } from '../src/data/catalog.js';
import { couriers } from '../src/data/couriers.js';
import { getProvince } from '../src/data/zambia.js';

const COURIER_IDS = couriers.map((c) => c.id);
const MOMO_NETWORK_IDS = momoNetworks.map((n) => n.id);
export const CATEGORY_IDS = categories.map((c) => c.id);
const PHONE = /^(\+?260|0)?[79]\d{8}$/;

const money = z.coerce.number().positive().max(10_000_000);
const optionalRate = z.union([z.coerce.number().min(0).max(100_000), z.literal(''), z.null()]).optional();
const phone = z.string().refine((p) => PHONE.test(p.replace(/\s/g, '')), 'Enter a valid Zambian phone number');

// Map positions inside Zambia (with a margin), or nothing.
const mapLat = z.union([z.coerce.number().min(-19).max(-7.5), z.null()]).optional();
const mapLng = z.union([z.coerce.number().min(21).max(34.5), z.null()]).optional();

const location = {
  province: z.string().refine((p) => getProvince(p), 'Choose a valid province'),
  town: z.string().min(1, 'Choose a town'),
};
const townInProvince = (v) => getProvince(v.province)?.towns.includes(v.town);

export const shopSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your shop name').max(80),
    phone,
    category: z.string().optional().nullable(),
    logo: z.string().max(16).optional().nullable(),
    ...location,
    area: z.string().trim().min(2, 'Enter your street, market or area').max(120),
    tpin: z.union([z.string().regex(/^\d{10}$/, 'A TPIN has 10 digits'), z.literal(''), z.null()]).optional(),
    banner: z.union([z.string().regex(/^\/uploads\/[\w.-]+$/), z.literal(''), z.null()]).optional(),
    about: z.string().trim().max(1000).optional().nullable(),
    openingHours: z.string().trim().max(120).optional().nullable(),
    vatRegistered: z.boolean().default(false),
    // The shop's map position, for pricing deliveries by distance (optional).
    lat: mapLat,
    lng: mapLng,
    // Where buyers send Mobile Money for their orders.
    momoNetwork: z.enum(MOMO_NETWORK_IDS, { message: 'Choose the network of your Mobile Money number' }),
    momoNumber: z
      .string({ message: 'Enter your Mobile Money number' })
      .refine((p) => PHONE.test(p.replace(/\s/g, '')), 'Enter a valid Mobile Money number'),
    momoName: z
      .string({ message: 'Enter the name your Mobile Money number is registered in' })
      .trim()
      .min(3, 'Enter the name your Mobile Money number is registered in')
      .max(80),
    couriers: z
      .array(z.enum(COURIER_IDS))
      .refine((ids) => ids.some((id) => id !== 'pickup'), 'Choose at least one delivery option'),
    ownRates: z.object({ town: optionalRate, province: optionalRate }).optional().nullable(),
  })
  .refine(townInProvince, 'That town is not in the selected province');

const optionSchema = z.object({
  name: z.string().trim().min(1, 'Name each option, e.g. Size').max(30),
  values: z
    .array(z.string().trim().min(1).max(30))
    .min(1, 'Give each option at least one choice')
    .max(20)
    .refine((v) => new Set(v).size === v.length, 'Option choices must be different'),
});

export const productSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a product name').max(140),
    category: z.enum(CATEGORY_IDS, { message: 'Choose a category' }),
    condition: z.enum(conditions.map((c) => c.id)).default('new'),
    price: money,
    oldPrice: money.optional().nullable(),
    stock: z.coerce.number().int('Stock must be a whole number').min(0).max(1_000_000),
    lowStockAt: z.coerce.number().int().min(0).max(1_000_000).default(5),
    weightKg: z.coerce.number().positive('Enter the weight in kg').max(5000).default(1),
    sourceProductId: z.string().max(40).optional().nullable(),
    description: z.string().max(4000).default(''),
    local: z.boolean().default(false),
    images: z
      .array(z.string().regex(/^\/uploads\/[\w.-]+$/, 'Upload photos before saving'))
      .max(4)
      .default([]),
    tiers: z
      .array(z.object({ min: z.coerce.number().int().min(2), price: money }))
      .max(4)
      .default([]),
    options: z
      .array(optionSchema)
      .max(3)
      .default([])
      .refine((o) => new Set(o.map((x) => x.name.toLowerCase())).size === o.length, 'Option names must be different'),
  })
  .transform((p) => ({ ...p, tiers: [...p.tiers].sort((a, b) => a.min - b.min) }))
  .refine((p) => !p.oldPrice || p.oldPrice > p.price, 'Was-price must be higher than the price')
  .refine(
    (p) =>
      p.tiers.every((t, i) => t.price < (i ? p.tiers[i - 1].price : p.price) && (!i || t.min > p.tiers[i - 1].min)),
    'Each wholesale tier needs a higher quantity and a lower price than the one before',
  );

const cartFields = {
  items: z
    .array(
      z.object({
        productId: z.string(),
        qty: z.coerce.number().int().min(1).max(100_000),
        options: z.record(z.string().max(30), z.string().max(30)).optional(),
        quoteId: z.string().max(40).optional().nullable(),
      }),
    )
    .min(1, 'Your cart is empty')
    .max(100),
  couriers: z.record(z.string(), z.enum(COURIER_IDS)),
  payment: z.enum(['momo', 'cod'], { message: 'Choose Mobile Money or Pay on Delivery' }),
  coupon: z.string().trim().max(30).optional().nullable(),
  voucherId: z.string().max(40).optional().nullable(),
  pickupPoint: z.string().max(40).optional().nullable(),
};

export const orderSchema = z.object({
  ...cartFields,
  shipping: z
    .object({
      name: z.string().trim().min(2, 'Enter your full name').max(80),
      phone,
      ...location,
      address: z.string().trim().min(3, 'Enter a street, plot number or landmark').max(200),
      lat: mapLat,
      lng: mapLng,
    })
    .refine(townInProvince, 'That town is not in the selected province'),
});

// A price preview only needs to know where the order is going.
export const orderQuoteSchema = z.object({
  ...cartFields,
  shipping: z
    .object({ ...location, lat: mapLat, lng: mapLng })
    .refine(townInProvince, 'That town is not in the selected province'),
});

const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,20}$/, 'Codes are 3–20 letters, numbers or dashes, e.g. LUSAKA10');

export const couponSchema = z
  .object({
    code: couponCode,
    kind: z.enum(['percent', 'amount']),
    value: z.coerce.number().positive('Enter the discount'),
    minSpend: z.coerce.number().min(0).max(10_000_000).default(0),
    maxUses: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional(),
    endsAt: z.union([z.string().date(), z.literal(''), z.null()]).optional(),
  })
  .refine((c) => c.kind !== 'percent' || c.value <= 90, 'A percentage discount can be at most 90%');

export const priceRequestSchema = z
  .object({
    productId: z.string(),
    qty: z.coerce.number().int().min(2, 'Ask for at least 2 units').max(1_000_000),
    options: z.record(z.string().max(30), z.string().max(30)).default({}),
    targetPrice: z.union([z.coerce.number().positive(), z.literal(''), z.null()]).optional(),
    note: z.string().trim().max(1000).default(''),
    ...location,
  })
  .refine(townInProvince, 'That town is not in the selected province');

export const priceResponseSchema = z.union([
  z.object({
    decline: z.literal(true),
    note: z.string().trim().max(1000).default(''),
  }),
  z.object({
    price: z.coerce.number().positive('Enter your price per unit'),
    validDays: z.coerce.number().int().min(1).max(30).default(3),
    note: z.string().trim().max(1000).default(''),
  }),
]);

export const messageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message').max(2000, 'Messages can be at most 2000 characters'),
  productId: z.string().max(40).optional().nullable(),
});

const flag = z.literal('1').optional().or(z.literal('').optional());
const blank = (schema) => z.union([schema, z.literal('')]).optional();

export const SORTS = ['relevance', 'nearest', 'popular', 'newest', 'deals', 'price-asc', 'price-desc', 'rating'];

export const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  cat: blank(z.enum(CATEGORY_IDS)),
  cond: blank(z.enum(conditions.map((c) => c.id))),
  secondHand: flag,
  prov: blank(z.string().max(30)),
  town: blank(z.string().max(40)),
  shop: blank(z.string().max(40)),
  local: flag,
  wholesale: flag,
  lowStock: flag,
  featured: flag,
  max: blank(z.coerce.number().positive()),
  sort: blank(z.enum(SORTS)),
  nearProv: blank(z.string().max(30)),
  nearTown: blank(z.string().max(40)),
  ids: blank(z.string().max(4000)),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export const reviewSchema = z.object({
  orderId: z.string(),
  productId: z.string(),
  rating: z.coerce.number().int().min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars'),
  comment: z.string().trim().max(1000).default(''),
});

export const RETURN_REASONS = ['damaged', 'faulty', 'wrong_item', 'missing_items', 'not_as_described', 'other'];

export const caseSchema = z
  .object({
    orderId: z.string(),
    shopId: z.string(),
    kind: z.enum(['return', 'not_received']),
    reason: z.enum([...RETURN_REASONS, 'not_received']),
    description: z.string().trim().max(2000).default(''),
    items: z
      .array(z.object({ productId: z.string(), qty: z.coerce.number().int().min(1) }))
      .max(50)
      .default([]),
    photos: z
      .array(z.string().regex(/^\/uploads\/[\w.-]+$/, 'Upload photos before sending'))
      .max(4)
      .default([]),
  })
  .refine((c) => c.kind !== 'return' || c.items.length > 0, 'Choose the items you want to return')
  .refine((c) => (c.kind === 'not_received') === (c.reason === 'not_received'), 'Choose a reason')
  .refine((c) => c.reason !== 'other' || c.description.length >= 5, 'Tell us what went wrong');

export const caseResponseSchema = z.union([
  z.object({
    accept: z.literal(true),
    resolution: z.enum(['refund', 'replacement', 'repair']),
    refundAmount: z.coerce.number().positive().optional(),
    note: z.string().trim().max(1000).default(''),
  }),
  z.object({
    accept: z.literal(false),
    note: z.string().trim().min(5, 'Explain why you are rejecting this').max(1000),
  }),
]);

export const verificationSchema = z.object({
  ownerFullName: z.string().trim().min(4, 'Enter your full name as on your NRC').max(100),
  nrc: z
    .string()
    .trim()
    .regex(/^\d{6}\/\d{2}\/\d$/, 'Enter your NRC number like 123456/78/1'),
  pacra: z.string().trim().max(30).optional().default(''),
});
