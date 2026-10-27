import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { checkChoice, describeChoice } from '../data/options';
import { formatLocation } from '../data/zambia';
import { formatK } from '../utils/format';
import LocationFields from './LocationFields';
import Icon from './Icon';

const STATUS = {
  open: ['Waiting for the shop', 'status-pending'],
  quoted: ['Price offered', 'status-dispatched'],
  accepted: ['Accepted: ready to order', 'status-delivered'],
  ordered: ['Ordered', 'status-delivered'],
  declined: ['Declined', 'status-declined'],
  expired: ['Expired', 'status-declined'],
};

const StatusPill = ({ status }) => <span className={`status ${STATUS[status][1]}`}>{STATUS[status][0]}</span>;

const until = (date) => new Date(date).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short' });

// Product page: ask the shop for a price on a large quantity.
export function RequestPriceForm({ product, choice, startQty }) {
  const { user, myShop, location } = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ qty: '', targetPrice: '', note: '', ...location });
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  if (myShop?.id === product.shopId) return null;
  if (!user) {
    return (
      <Link to={`/login?next=${encodeURIComponent(pathname)}`} className="btn btn-outline">
        Request a wholesale price
      </Link>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-outline"
        onClick={() => {
          setForm((f) => ({
            ...f,
            qty: String(Math.max(startQty, 10)),
            province: location.province,
            town: location.town,
          }));
          setOpen(true);
        }}
      >
        Request a wholesale price
      </button>
    );
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const problem = checkChoice(product, choice);
    if (problem) return setError(`${problem} above first`);
    setSending(true);
    setError(null);
    try {
      await api.requestPrice({ productId: product.id, options: choice, ...form });
      navigate('/account?tab=quotes');
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return (
    <form className="ask-shop card" onSubmit={submit}>
      <strong>Ask {product.name.length > 40 ? 'the shop' : `for a price on ${product.name}`}</strong>
      <p className="muted small">
        The shop replies with a price per unit, usually within a day. You can then order at that price.
      </p>
      {describeChoice(choice) && <p className="small">Options: {describeChoice(choice)}</p>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="rq-qty">How many units?</label>
          <input id="rq-qty" type="number" min="2" value={form.qty} onChange={set('qty')} />
        </div>
        <div className="field">
          <label htmlFor="rq-target">Your target price per unit (K, optional)</label>
          <input id="rq-target" type="number" min="0" value={form.targetPrice} onChange={set('targetPrice')} />
        </div>
        <LocationFields
          value={{ province: form.province, town: form.town }}
          onChange={(loc) => setForm((f) => ({ ...f, ...loc }))}
          idPrefix="rq"
        />
      </div>
      <div className="field">
        <label htmlFor="rq-note">Note (optional)</label>
        <textarea
          id="rq-note"
          rows="2"
          value={form.note}
          onChange={set('note')}
          placeholder="e.g. Monthly order for my shop"
        />
      </div>
      {error && <span className="error">{error}</span>}
      <div className="pdp-buttons">
        <button className="btn btn-primary btn-sm" disabled={sending}>
          {sending ? 'Sending…' : 'Send request'}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Account page: the buyer's requests, with accept and add-to-cart.
export function BuyerPriceRequests() {
  const { addAgreedPrice, notify } = useStore();
  const navigate = useNavigate();
  const [list, setList] = useState(null);

  const load = useCallback(() => {
    api
      .myPriceRequests()
      .then(setList)
      .catch((err) => notify(err.message));
  }, [notify]);
  useEffect(load, [load]);

  const accept = async (r) => {
    try {
      const updated = await api.acceptPriceRequest(r.id);
      addAgreedPrice(updated);
      navigate('/cart');
    } catch (err) {
      notify(err.message);
      load();
    }
  };

  if (!list) return <p className="muted">Loading…</p>;
  if (!list.length) {
    return (
      <div className="card empty">
        <p>No price requests yet. Buying in bulk? Use "Request a wholesale price" on any product page.</p>
      </div>
    );
  }
  return (
    <div className="orders">
      {list.map((r) => (
        <div key={r.id} className="card order">
          <div className="order-head">
            <strong>
              <Link to={`/product/${r.productId}`}>{r.productName}</Link>
            </strong>
            <span className="muted small">{r.shopName}</span>
            <StatusPill status={r.status} />
          </div>
          <div className="small">
            {r.qty} units{describeChoice(r.options) && ` (${describeChoice(r.options)})`} to {formatLocation(r)} ·
            listed at {formatK(r.productPrice)} each
            {r.targetPrice && ` · you asked ${formatK(r.targetPrice)}`}
          </div>
          {r.quotedPrice != null && (
            <div className="quote-offer">
              <strong>{formatK(r.quotedPrice)} each</strong> = {formatK(r.quotedPrice * r.qty)} for {r.qty}
              {r.validUntil && <span className="muted small"> · valid until {until(r.validUntil)}</span>}
              {r.sellerNote && <div className="small">“{r.sellerNote}”</div>}
            </div>
          )}
          {r.status === 'declined' && r.sellerNote && <div className="small muted">Shop: “{r.sellerNote}”</div>}
          {r.status === 'quoted' && (
            <button className="btn btn-primary btn-sm" onClick={() => accept(r)}>
              Accept and add to cart
            </button>
          )}
          {r.status === 'accepted' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                addAgreedPrice(r);
                navigate('/cart');
              }}
            >
              Add to cart at {formatK(r.quotedPrice)} each
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function RespondForm({ request, onDone }) {
  const { notify } = useStore();
  const [price, setPrice] = useState(request.targetPrice ?? '');
  const [validDays, setValidDays] = useState(3);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const respond = async (body) => {
    setBusy(true);
    try {
      await api.respondToPriceRequest(request.id, body);
      notify(body.decline ? 'Request declined' : 'Price sent to the buyer');
      onDone();
    } catch (err) {
      notify(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="respond-form">
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`price-${request.id}`}>Your price per unit (K)</label>
          <input
            id={`price-${request.id}`}
            type="number"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`days-${request.id}`}>Price valid for</label>
          <select id={`days-${request.id}`} value={validDays} onChange={(e) => setValidDays(Number(e.target.value))}>
            {[1, 3, 7, 14].map((d) => (
              <option key={d} value={d}>
                {d} day{d > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <input
        placeholder="Message to the buyer (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Message to the buyer"
      />
      {price > 0 && (
        <p className="small muted">
          Total {formatK(price * request.qty)} for {request.qty} units (listed price{' '}
          {formatK(request.productPrice * request.qty)})
        </p>
      )}
      <div className="pdp-buttons">
        <button
          className="btn btn-primary btn-sm"
          disabled={busy || !(price > 0)}
          onClick={() => respond({ price, validDays, note })}
        >
          Send price
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => respond({ decline: true, note })}>
          Decline
        </button>
      </div>
    </div>
  );
}

// Seller dashboard: requests to answer.
export function ShopPriceRequests() {
  const { notify } = useStore();
  const [list, setList] = useState(null);
  const load = useCallback(() => {
    api
      .shopPriceRequests()
      .then(setList)
      .catch((err) => notify(err.message));
  }, [notify]);
  useEffect(load, [load]);

  if (!list) return <p className="muted">Loading…</p>;
  if (!list.length) {
    return (
      <div className="card empty">
        <p>No price requests yet. Shop owners and businesses ask here when they want to buy in bulk.</p>
      </div>
    );
  }
  return (
    <div className="orders">
      {list.map((r) => (
        <div key={r.id} className="card order">
          <div className="order-head">
            <strong>
              {r.qty} × <Link to={`/product/${r.productId}`}>{r.productName}</Link>
            </strong>
            <span className="muted small">{new Date(r.date).toLocaleDateString('en-ZM', { dateStyle: 'medium' })}</span>
            <StatusPill status={r.status} />
          </div>
          <div className="small muted">
            {r.buyerName} · {r.buyerPhone} · <Icon name="pin" size={14} className="inline-icon" />{formatLocation(r)}
            {describeChoice(r.options) && ` · ${describeChoice(r.options)}`}
          </div>
          <div className="small">
            Listed at {formatK(r.productPrice)}
            {r.targetPrice && (
              <>
                {' '}
                · buyer hopes for <strong>{formatK(r.targetPrice)}</strong>
              </>
            )}
          </div>
          {r.note && <div className="small">“{r.note}”</div>}
          {r.status === 'open' ? (
            <RespondForm request={r} onDone={load} />
          ) : (
            r.quotedPrice != null && (
              <div className="small">
                You offered <strong>{formatK(r.quotedPrice)}</strong> each
                {r.validUntil && ` until ${until(r.validUntil)}`}
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}
