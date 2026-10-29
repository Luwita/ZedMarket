import { pointsIn } from './pickupPoints.js';

// Zambian delivery options a shop can offer, with fees (ZMW) and times.
// The values below are starting points from what each courier publishes (October 2026); staff enter the rates
// agreed with each courier in Admin → Delivery, which are saved in the database and applied with
// applyCourierConfig().
//
// Two ways of pricing:
//  - by distance (`distance`): Yango charges like a ride: a minimum fare covering the first km, then a fee per km
//    of the trip (and, by car, per minute). The trip is measured between the shop's and the buyer's map positions;
//    without them a typical trip length is assumed and the price is shown as an estimate.
//  - by band (`rates`): the other couriers charge per parcel by how far it goes and how heavy it is.
//   town     = seller and buyer in the same town
//   province = same province, different town
//   national = different provinces
// Base rates cover a parcel up to INCLUDED_KG; heavier parcels pay `perKg` for every extra kg.
// `maxKg` is the heaviest parcel a courier accepts (no limit when missing).
export const INCLUDED_KG = 5;

export const couriers = [
  {
    id: 'pickup',
    name: 'Collect from shop',
    icon: '🏪',
    description: 'Buyer collects the order in person at the shop.',
    rates: { town: 0, province: 0, national: 0 },
    eta: { town: 'Ready in 2 hours', province: 'Ready in 2 hours', national: 'Ready in 2 hours' },
    cod: true,
  },
  {
    id: 'seller',
    name: "Shop's own delivery",
    icon: '🛵',
    description: "Delivered by the shop's own rider or vehicle.",
    rates: { town: 30, province: 90 },
    perKg: { town: 1, province: 3 },
    eta: { town: 'Same day', province: '1–2 days' },
    cod: true,
  },
  {
    id: 'yango',
    name: 'Yango Delivery',
    icon: '🟡',
    description: 'Delivered to your door by a Yango rider within the same town.',
    // Yango's Lusaka tariff (yango.com/lusaka/tariff): "Delivery by moto" and "Delivery by Car", in-city rates.
    // These are Yango's maximum rates; rush-hour prices can be higher and the shop pays Yango in its app.
    distance: {
      moto: { minFare: 10.17, includedKm: 1, perKm: 4.95 },
      car: { minFare: 19, includedKm: 1.5, perKm: 4.2, perMin: 0.8 },
      motoMaxKg: 10, // heavier parcels go by car
      typicalKm: 8, // assumed trip when a map position is missing
    },
    rates: {},
    maxKg: 20,
    eta: { town: '1–3 hours' },
    // Towns where Yango runs in Zambia (Lusaka, Kitwe, Ndola and Solwezi as of October 2026).
    towns: ['Lusaka', 'Kitwe', 'Ndola', 'Solwezi'],
    cod: true,
  },
  {
    id: 'platinum',
    name: 'Platinum Couriers',
    icon: '📦',
    description: 'Collect your parcel from the Platinum Couriers office in your town.',
    collect: 'Platinum Couriers office',
    // Platinum advertises small parcels "across Zambia for just K30" (no published rate card); bales cost more.
    rates: { town: 30, province: 30, national: 30 },
    perKg: { town: 3, province: 5, national: 8 },
    maxKg: 100,
    eta: { town: 'Same day', province: '1–2 days', national: '2–3 days' },
    cod: true,
  },
  {
    id: 'bus',
    name: 'Intercity bus parcel',
    icon: '🚌',
    description: 'Sent with an intercity bus; collect your parcel from the bus station in your town.',
    collect: 'bus station',
    rates: { province: 60, national: 90 },
    perKg: { province: 2, national: 3 },
    maxKg: 300,
    eta: { province: 'Next day', national: '1–2 days' },
    cod: false,
  },
  {
    id: 'zampost',
    name: 'Zampost EMS',
    icon: '✉️',
    description: 'Collect your parcel from the post office in your town (every district has one).',
    collect: 'post office',
    rates: { town: 50, province: 75, national: 120 },
    perKg: { town: 4, province: 6, national: 9 },
    maxKg: 30,
    eta: { town: '1–2 days', province: '2–3 days', national: '3–5 days' },
    cod: false,
  },
  {
    // Offered for every shop: the shop sends the parcel to a Zed Market Point in the buyer's town.
    id: 'point',
    name: 'Zed Market Point',
    icon: '📍',
    description: "Your parcel waits at a Zed Market collection point in your town. Collect it with your order number.",
    rates: { town: 20, province: 55, national: 90 },
    perKg: { town: 1, province: 3, national: 4 },
    maxKg: 60,
    eta: { town: 'Next day', province: '1–3 days', national: '2–5 days' },
    cod: true,
    network: true,
    // Off until Zed Market has real collection points; staff switch it on in Admin → Delivery.
    disabled: true,
  },
];

// Fields staff can change in Admin → Delivery. Everything else (id, icon, how a courier works) stays in code.
export const EDITABLE_COURIER_FIELDS = ['description', 'rates', 'perKg', 'maxKg', 'eta', 'towns', 'cod', 'disabled', 'distance'];
const DEFAULT_COURIERS = JSON.parse(JSON.stringify(couriers));

// Replaces the editable fields with saved values (or the defaults for couriers with nothing saved).
// The courier objects are updated in place so every import sees the new rates.
export function applyCourierConfig(saved = {}) {
  for (const courier of couriers) {
    const base = DEFAULT_COURIERS.find((d) => d.id === courier.id);
    const override = saved[courier.id];
    for (const key of EDITABLE_COURIER_FIELDS) {
      const value = override && key in override ? override[key] : base[key];
      if (value === undefined) delete courier[key];
      else courier[key] = JSON.parse(JSON.stringify(value));
    }
    courier.confirmed = !!override;
  }
}
applyCourierConfig();

export const getCourier = (id) => couriers.find((c) => c.id === id);

// Options a shop chooses itself (Zed Market Points are offered for every shop).
export const shopCouriers = couriers.filter((c) => !c.network);
// Delivery options shown to shops and buyers (a courier staff switched off is hidden).
export const activeCouriers = () => couriers.filter((c) => !c.disabled);

// Every delivery option open for a shop's parcels: its own choices plus the Zed Market network.
export const offeredBy = (shop) => [...new Set([...shop.couriers, ...couriers.filter((c) => c.network).map((c) => c.id)])];

export function band(from, to) {
  if (from.province === to.province && from.town === to.town) return 'town';
  if (from.province === to.province) return 'province';
  return 'national';
}

export const bandRank = { town: 0, province: 1, national: 2 };

// Road distance in km between two map positions ({ lat, lng }), or null if either is missing.
// Straight-line distance × 1.3, the usual allowance for roads not running straight.
export function roadKm(from, to) {
  if (![from?.lat, from?.lng, to?.lat, to?.lng].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(to.lat - from.lat) / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lng - from.lng) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(a)) * 1.3 * 10) / 10;
}

// A Yango-style fare: minimum fare for the first km, then per km (and per minute by car, at ~25 km/h in town).
function distanceFare(pricing, km, weightKg) {
  const vehicle = weightKg > pricing.motoMaxKg ? 'car' : 'moto';
  const t = pricing[vehicle];
  const minutes = (km / 25) * 60;
  const fee = Number(t.minFare) + Math.max(0, km - Number(t.includedKm)) * Number(t.perKm) + minutes * Number(t.perMin ?? 0);
  return { fee: Math.ceil(fee), vehicle };
}

// Price and time for one courier taking a parcel of `weightKg` from a shop to a buyer, or null if not offered.
// `to` may carry the buyer's map position (lat, lng) for couriers priced by distance.
export function quote(courierId, shop, to, weightKg = 1) {
  const courier = getCourier(courierId);
  if (!courier || courier.disabled) return null;
  const b = band(shop, to);
  if (courier.towns && (b !== 'town' || !courier.towns.includes(shop.town))) return null;
  if (courier.maxKg && weightKg > courier.maxKg) return null;
  if (courier.distance) {
    const measured = roadKm(shop, to);
    const km = measured ?? Number(courier.distance.typicalKm);
    const { fee, vehicle } = distanceFare(courier.distance, km, weightKg);
    return { courier, fee, eta: courier.eta[b], band: b, weightKg, km, estimated: measured === null, vehicle };
  }
  if (courier.id === 'point' && !pointsIn(to).length) return null;
  const rates = courier.id === 'seller' && shop.ownRates ? { ...courier.rates, ...shop.ownRates } : courier.rates;
  if (rates[b] === undefined || rates[b] === null || rates[b] === '') return null;
  const extraKg = Math.max(0, Math.ceil(weightKg - INCLUDED_KG));
  const fee = Number(rates[b]) + extraKg * (courier.perKg?.[b] ?? 0);
  return { courier, fee, eta: courier.eta[b], band: b, weightKg };
}

// All options a shop offers to a buyer location for a parcel weight, cheapest first.
export function quotesFor(shop, to, weightKg = 1) {
  return offeredBy(shop)
    .map((id) => quote(id, shop, to, weightKg))
    .filter(Boolean)
    .sort((a, b) => a.fee - b.fee);
}

// Cheapest option that actually brings the parcel to the buyer (excludes collecting from the shop).
export const bestDelivery = (shop, to, weightKg = 1) =>
  quotesFor(shop, to, weightKg).find((q) => q.courier.id !== 'pickup') ?? null;

// How long after a parcel is sent it is marked delivered automatically, if the buyer never presses "I've received it".
// Delivered to the door: 24 hours inside the shop's province, 48 to another province. Parcels the buyer has to collect
// themselves (from the shop, a bus station, a courier or post office, or a Zed Market Point) get a day more.
export const AUTO_DELIVER_HOURS = { near: 24, far: 48, collectExtra: 24 };
export const REMIND_BEFORE_HOURS = 6;
export function autoDeliverHours(courierId, sameProvince) {
  const collects = courierId === 'pickup' || !!collectPlace(courierId) || courierId === 'point';
  return (sameProvince ? AUTO_DELIVER_HOURS.near : AUTO_DELIVER_HOURS.far) + (collects ? AUTO_DELIVER_HOURS.collectExtra : 0);
}

// Where the buyer collects a parcel, for couriers that don't deliver to the door (e.g. "post office"), or null.
export const collectPlace = (courierId) => getCourier(courierId)?.collect ?? null;

// Couriers that can't take a parcel this heavy, for explaining missing options.
export const tooHeavyFor = (shop, weightKg) =>
  offeredBy(shop)
    .map(getCourier)
    .filter((c) => c && !c.disabled && c.maxKg && weightKg > c.maxKg);

export const formatKg = (kg) => (kg >= 10 ? `${Math.round(kg)} kg` : `${Number(kg.toFixed(1))} kg`);
