import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import * as api from '../api';
import LocationFields from '../components/LocationFields';
import { useStore } from '../context/StoreContext';
import { paymentMethods } from '../data/catalog';
import { formatKg, quotesFor, tooHeavyFor } from '../data/couriers';
import { pointsIn } from '../data/pickupPoints';
import { parcelWeight } from '../data/pricing';
import { formatLocation } from '../data/zambia';
import { formatK } from '../utils/format';
import { currentPosition, distanceLabel } from '../utils/geo';
import { groupByShop } from './Cart';
import Icon from '../components/Icon';

const PHONE = /^(\+?260|0)?[79]\d{8}$/;

export default function Checkout() {
  const { selectedItems: items, subtotal, user, authReady, catalogStatus, cartStatus, location, placeOrder } = useStore();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    province: location.province,
    town: location.town,
    address: '',
    payment: 'momo',
  });
  const [picked, setPicked] = useState({}); // shopId -> courier id
  const [errors, setErrors] = useState({});
  const [processing, setProcessing] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [coupon, setCoupon] = useState(null); // { code, priced } once the server has accepted a code
  const [couponState, setCouponState] = useState({ busy: false, error: null });
  const [vouchers, setVouchers] = useState([]);
  const [voucherId, setVoucherId] = useState('');
  const [voucherQuote, setVoucherQuote] = useState({ priced: null, error: null });
  const [pointId, setPointId] = useState('');
  const [spot, setSpot] = useState(null); // the buyer's map position, for couriers priced by distance
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!user) return;
    api
      .myVouchers()
      .then((list) => setVouchers(list.filter((v) => v.usable)))
      .catch(() => {});
  }, [user]);

  // The signed-in user can arrive after the first render; fill in their details without overwriting typing.
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      name: f.name || (user.name === 'Zed Market Shopper' ? '' : user.name),
      phone: f.phone || user.phone,
    }));
  }, [user]);

  const ready = catalogStatus !== 'loading' && cartStatus !== 'loading' && items.every((i) => i.shop);
  const to = { province: form.province, town: form.town, ...(spot ?? {}) };
  const shipments = ready
    ? groupByShop(items).map(({ shop, items: lines }) => {
        const weightKg = parcelWeight(lines);
        const options = quotesFor(shop, to, weightKg);
        const chosen =
          options.find((o) => o.courier.id === picked[shop.id]) ??
          options.find((o) => !['pickup', 'point'].includes(o.courier.id)) ??
          options[0] ??
          null;
        return {
          shop,
          lines,
          weightKg,
          tooHeavy: tooHeavyFor(shop, weightKg),
          options,
          chosen,
          subtotal: lines.reduce((s, l) => s + l.total, 0),
        };
      })
    : [];

  // What the server needs to price the order: only choices, never prices.
  const cartPayload = {
    items: items.map(({ product, qty, options, quoteId }) => ({ productId: product.id, qty, options, quoteId })),
    couriers: Object.fromEntries(shipments.filter((s) => s.chosen).map((s) => [s.shop.id, s.chosen.courier.id])),
    payment: form.payment,
  };
  const points = pointsIn(to);
  const usesPoint = shipments.some((s) => s.chosen?.courier.id === 'point');
  const pickupPoint = usesPoint ? (points.find((p) => p.id === pointId) ?? points[0])?.id ?? null : null;
  cartPayload.pickupPoint = pickupPoint;
  const payloadKey = JSON.stringify({ ...cartPayload, to });

  // Keep a discount up to date when the cart, town, couriers or payment change.
  const appliedCode = coupon?.code;
  useEffect(() => {
    if (!appliedCode) return undefined;
    let cancelled = false;
    const { to: shipping, ...rest } = JSON.parse(payloadKey);
    api
      .quoteOrder({ ...rest, shipping, coupon: appliedCode })
      .then((priced) => !cancelled && setCoupon({ code: appliedCode, priced }))
      .catch((err) => {
        if (cancelled) return;
        setCoupon(null);
        setCouponState({ busy: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [appliedCode, payloadKey]);

  // The server works out how much of the voucher applies, and to which parcels.
  useEffect(() => {
    if (!voucherId) {
      setVoucherQuote({ priced: null, error: null });
      return undefined;
    }
    let cancelled = false;
    const { to: shipping, ...rest } = JSON.parse(payloadKey);
    api
      .quoteOrder({ ...rest, shipping, coupon: appliedCode, voucherId })
      .then((priced) => !cancelled && setVoucherQuote({ priced, error: null }))
      .catch((err) => !cancelled && setVoucherQuote({ priced: null, error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [voucherId, appliedCode, payloadKey]);

  if (!ready || !authReady) return null;
  if (!items.length && !processing) return <Navigate to="/cart" replace />;
  if (!user) {
    return (
      <div className="container section narrow">
        <div className="card empty">
          <div className="empty-icon">🔐</div>
          <h2>Sign in to check out</h2>
          <p className="muted">Sign in or create an account in a few seconds. It lets you track your order.</p>
          <Link to="/login?next=/checkout" className="btn btn-primary">
            Sign in or create an account
          </Link>
        </div>
      </div>
    );
  }

  const delivery = shipments.reduce((sum, s) => sum + (s.chosen?.fee ?? 0), 0);
  const discount = coupon?.priced.discount ?? 0;
  const voucherDiscount = voucherQuote.priced?.voucherDiscount ?? 0;
  const total = subtotal - discount - voucherDiscount + delivery;
  const discountFor = (shopId) => coupon?.priced.shipments.find((s) => s.shopId === shopId)?.discount ?? 0;
  const codAllowed = shipments.every((s) => s.chosen?.courier.cod);
  const byDistance = shipments.some((s) => s.options.some((o) => o.courier.distance));
  const locate = async () => {
    setLocating(true);
    try {
      setSpot(await currentPosition());
      setErrors((er) => ({ ...er, spot: null }));
    } catch (err) {
      setErrors((er) => ({ ...er, spot: err.message }));
    } finally {
      setLocating(false);
    }
  };
  const noMomo = shipments.filter((s) => !s.shop.takesMomo).map((s) => s.shop.name);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const applyCode = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setCouponState({ busy: true, error: null });
    try {
      const priced = await api.quoteOrder({ ...cartPayload, shipping: to, coupon: code });
      setCoupon({ code, priced });
      setCouponState({ busy: false, error: null });
    } catch (err) {
      setCoupon(null);
      setCouponState({ busy: false, error: err.message });
    }
  };

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Enter your full name';
    if (!PHONE.test(form.phone.replace(/\s/g, ''))) errs.phone = 'Enter a valid Zambian number, e.g. 097 123 4567';
    if (!form.address.trim()) errs.address = 'Enter a street, plot number or landmark';
    if (form.payment === 'momo' && noMomo.length)
      errs.payment = `${noMomo.join(', ')} can't take Mobile Money yet. Choose Pay on Delivery, or remove its items.`;
    if (form.payment === 'cod' && !codAllowed)
      errs.payment = 'Pay on Delivery is not available with bus parcel or Zampost. Choose another courier or payment.';
    if (voucherId && voucherQuote.error) errs.voucher = voucherQuote.error;
    if (shipments.some((s) => !s.chosen)) errs.delivery = 'One of the shops cannot deliver to your town';
    setErrors(errs);
    return !Object.keys(errs).length;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setProcessing(true);
    try {
      // The server re-prices everything from its own catalogue; only choices are sent.
      const order = await placeOrder({
        ...cartPayload,
        shipping: { name: form.name, phone: form.phone, ...to, address: form.address },
        coupon: coupon?.code,
        voucherId: voucherId || undefined,
      });
      navigate(`/order/${order.id}`, { replace: true, state: { order } });
    } catch (err) {
      setErrors({ submit: err.message });
      setProcessing(false);
    }
  };

  const field = (key, label, props = {}) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input id={key} value={form[key]} onChange={set(key)} className={errors[key] ? 'invalid' : ''} {...props} />
      {errors[key] && <span className="error">{errors[key]}</span>}
    </div>
  );

  return (
    <div className="container section">
      <h1>Checkout</h1>
      <form className="cart-layout" onSubmit={submit} noValidate>
        <div>
          <section className="card form-card">
            <h3>1. Where should we deliver?</h3>
            <div className="form-grid">
              {field('name', 'Full name', { autoComplete: 'name' })}
              {field('phone', 'Phone number', { type: 'tel', placeholder: '097 123 4567', autoComplete: 'tel' })}
              <LocationFields value={to} onChange={(loc) => setForm((f) => ({ ...f, ...loc }))} idPrefix="co" />
            </div>
            {field('address', 'Street address or landmark', { placeholder: 'Plot 123, near the market' })}
          </section>

          <section className="card form-card">
            <h3>2. Choose delivery</h3>
            {errors.delivery && <span className="error">{errors.delivery}</span>}
            {shipments.map((s) => (
              <div key={s.shop.id} className="shipment">
                <div className="shipment-head">
                  <strong>
                    {s.shop.logo ?? '🏪'} {s.shop.name}
                  </strong>
                  <span className="muted small">
                    From {formatLocation(s.shop)} · {s.lines.length} item{s.lines.length > 1 ? 's' : ''} ·{' '}
                    {formatKg(s.weightKg)}
                  </span>
                </div>
                {s.options.length ? (
                  <div className="courier-options">
                    {s.options.map((o) => (
                      <label key={o.courier.id} className={`pay-option ${s.chosen === o ? 'on' : ''}`}>
                        <input
                          type="radio"
                          name={`courier-${s.shop.id}`}
                          checked={s.chosen === o}
                          onChange={() => setPicked((p) => ({ ...p, [s.shop.id]: o.courier.id }))}
                        />
                        <span className="pay-icon">{o.courier.icon}</span>
                        <span className="grow">
                          <strong>{o.courier.name}</strong>
                          <span className="muted small block">
                            {o.courier.id === 'pickup'
                              ? `Collect in ${s.shop.town}`
                              : o.courier.collect
                                ? `Collect from the ${o.courier.collect} in ${form.town} · ${o.eta}`
                                : o.courier.distance
                                  ? `To your door · ${distanceLabel(o)} · ${o.eta}`
                                  : o.courier.id === 'seller'
                                    ? `To your door · ${o.eta}`
                                    : o.eta}
                          </span>
                        </span>
                        <strong>{o.fee ? formatK(o.fee) : 'Free'}</strong>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="error">This shop doesn't deliver to {form.town}. Remove its items or change town.</p>
                )}
                {s.tooHeavy.length > 0 && (
                  <p className="muted small">
                    {formatKg(s.weightKg)} is too heavy for {s.tooHeavy.map((c) => c.name).join(', ')}.
                  </p>
                )}
              </div>
            ))}
            {byDistance && (
              <div className="locate-box">
                {spot ? (
                  <p className="small"><Icon name="pin" size={14} className="inline-icon" />Using your location for an exact Yango price. The rider gets it too.</p>
                ) : (
                  <p className="muted small">
                    Yango charges by distance. Share where you are for the exact price (otherwise it's an estimate).
                  </p>
                )}
                <button type="button" className="btn btn-outline btn-sm" onClick={locate} disabled={locating}>
                  {locating ? 'Finding your location…' : spot ? 'Update my location' : 'Use my location'}
                </button>
                {errors.spot && <span className="error small">{errors.spot}</span>}
              </div>
            )}
            {usesPoint && points.length > 0 && (
              <div className="field point-picker">
                <label htmlFor="co-point">Collect from which Zed Market Point?</label>
                <select id="co-point" value={pickupPoint ?? ''} onChange={(e) => setPointId(e.target.value)}>
                  {points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}, {p.address}
                    </option>
                  ))}
                </select>
                <span className="muted small">
                  {points.find((p) => p.id === pickupPoint)?.hours}. Bring your order number. We text you when it arrives.
                </span>
              </div>
            )}
          </section>

          <section className="card form-card">
            <h3>3. Payment</h3>
            <div className="pay-options">
              {paymentMethods.map((m) => (
                <label key={m.id} className={`pay-option ${form.payment === m.id ? 'on' : ''}`}>
                  <input
                    type="radio"
                    name="payment"
                    value={m.id}
                    checked={form.payment === m.id}
                    onChange={set('payment')}
                  />
                  <span className="pay-icon">{m.icon}</span>
                  <span>
                    <strong>{m.name}</strong>
                    <span className="muted small block">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.payment && <span className="error">{errors.payment}</span>}
            {form.payment === 'momo' ? (
              <p className="escrow-note">
                After you place the order we show you {shipments.length > 1 ? "each shop's" : "the shop's"} Mobile
                Money number and text it to you. Send the money, tap "I've paid", and the shop sends your parcel once
                the money arrives.{shipments.length > 1 && ' You pay each shop separately.'}
              </p>
            ) : (
              <p className="escrow-note">Pay the shop or its courier when you receive your parcel.</p>
            )}
          </section>
        </div>

        <aside className="card summary">
          <h3>Your order</h3>
          {items.map(({ key, product, choice, qty, total: lineTotal, quoteId }) => (
            <div key={key} className="summary-row small">
              <span>
                {qty} × {product.name}
                {choice && ` (${choice})`}
                {quoteId && ' · agreed price'}
              </span>
              <span>{formatK(lineTotal)}</span>
            </div>
          ))}
          <hr />
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{formatK(subtotal)}</span>
          </div>
          {shipments
            .filter((s) => discountFor(s.shop.id) > 0)
            .map((s) => (
              <div key={s.shop.id} className="summary-row green small">
                <span>
                  {coupon.code} at {s.shop.name}
                </span>
                <span>−{formatK(discountFor(s.shop.id))}</span>
              </div>
            ))}
          {shipments.map((s) => (
            <div key={s.shop.id} className="summary-row small">
              <span>
                {s.chosen?.courier.icon} {s.chosen?.courier.name ?? 'No delivery'} ({s.shop.town})
              </span>
              <span>{s.chosen?.fee ? formatK(s.chosen.fee) : 'Free'}</span>
            </div>
          ))}

          {voucherDiscount > 0 && (
            <div className="summary-row green small">
              <span>Zed Market voucher</span>
              <span>−{formatK(voucherDiscount)}</span>
            </div>
          )}
          {vouchers.length > 0 && (
            <div className="coupon-box">
              <select value={voucherId} onChange={(e) => setVoucherId(e.target.value)} aria-label="Voucher">
                <option value="">Use a voucher ({vouchers.length})</option>
                {vouchers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatK(v.amount)} off orders over {formatK(v.minSpend)}
                  </option>
                ))}
              </select>
              {(errors.voucher || voucherQuote.error) && <span className="error small">{voucherQuote.error}</span>}
            </div>
          )}
          <div className="coupon-box">
            {coupon ? (
              <div className="summary-row small">
                <span>
                  <strong>{coupon.code}</strong> applied
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setCoupon(null);
                    setCodeInput('');
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="inline-fields">
                <input
                  placeholder="Discount code"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyCode();
                    }
                  }}
                  aria-label="Discount code"
                />
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={applyCode}
                  disabled={couponState.busy}
                >
                  {couponState.busy ? '…' : 'Apply'}
                </button>
              </div>
            )}
            {couponState.error && <span className="error small">{couponState.error}</span>}
          </div>

          <div className="summary-row total">
            <span>Total</span>
            <span>{formatK(total)}</span>
          </div>
          {errors.submit && <p className="error">{errors.submit}</p>}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={processing}>
            {processing ? 'Placing your order…' : `Place order · ${formatK(total)}`}
          </button>
          <p className="muted small center">
            By placing your order you agree to our <Link to="/legal/terms">terms</Link> and{' '}
            <Link to="/legal/returns">returns policy</Link>.
          </p>
          <Link to="/cart" className="muted small center block">
            ← Back to cart
          </Link>
        </aside>
      </form>
    </div>
  );
}
