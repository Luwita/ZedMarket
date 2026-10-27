import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as api from '../api';
import LocationFields from '../components/LocationFields';
import ShareButton from '../components/ShareButton';
import { useStore } from '../context/StoreContext';
import { categories, getCategory } from '../data/catalog';
import { formatLocation, provinces } from '../data/zambia';
import { formatK } from '../utils/format';
import Icon from '../components/Icon';

const ago = (d) => {
  const days = Math.floor((Date.now() - new Date(d)) / 864e5);
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

function PostForm({ onPosted }) {
  const { location } = useStore();
  const [form, setForm] = useState({ title: '', description: '', category: '', qty: '', unit: 'units', budget: '', ...location });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      onPosted(await api.postBuyingRequest(form));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="card form-card" onSubmit={submit} noValidate>
      <h2>What are you looking for?</h2>
      <p className="muted small">Shops across Zambia send you offers. Your phone number is not shown.</p>
      <div className="field">
        <label htmlFor="br-title">Title</label>
        <input id="br-title" value={form.title} onChange={set('title')} placeholder="e.g. 200 bags of cement" />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="br-qty">Quantity</label>
          <div className="inline-fields">
            <input id="br-qty" type="number" min="1" value={form.qty} onChange={set('qty')} />
            <input value={form.unit} onChange={set('unit')} aria-label="Unit" placeholder="units, bags, kg…" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="br-budget">Budget per unit (K, optional)</label>
          <input id="br-budget" type="number" min="0" value={form.budget} onChange={set('budget')} />
        </div>
        <div className="field">
          <label htmlFor="br-cat">Category</label>
          <select id="br-cat" value={form.category} onChange={set('category')}>
            <option value="">Any</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <LocationFields value={{ province: form.province, town: form.town }} onChange={(l) => setForm((f) => ({ ...f, ...l }))} idPrefix="br" />
      </div>
      <div className="field">
        <label htmlFor="br-desc">Details (optional)</label>
        <textarea id="br-desc" rows="3" value={form.description} onChange={set('description')} placeholder="Brand, size, quality, when you need it…" />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary">Post request</button>
    </form>
  );
}

export function RequestBoard() {
  const { user } = useStore();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ cat: '', prov: '', q: '' });
  const [list, setList] = useState(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .buyingRequests(filters)
      .then((r) => !cancelled && setList(r))
      .catch(() => !cancelled && setList([]));
    return () => {
      cancelled = true;
    };
  }, [filters]);

  return (
    <div className="container section">
      <div className="account-head">
        <div>
          <h1>Buying requests</h1>
          <p className="muted">Can't find it? Post what you need and let Zambian shops come to you with offers.</p>
        </div>
        {user ? (
          <button className="btn btn-primary" onClick={() => setPosting((p) => !p)}>
            {posting ? 'Close' : '+ Post a request'}
          </button>
        ) : (
          <Link to="/login?next=/requests" className="btn btn-primary">
            Sign in to post
          </Link>
        )}
      </div>
      {posting && <PostForm onPosted={(r) => navigate(`/requests/${r.id}`)} />}

      <div className="admin-filters">
        <input type="search" placeholder="Search requests" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} aria-label="Search requests" />
        <select value={filters.cat} onChange={(e) => setFilters((f) => ({ ...f, cat: e.target.value }))} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={filters.prov} onChange={(e) => setFilters((f) => ({ ...f, prov: e.target.value }))} aria-label="Province">
          <option value="">All provinces</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {list === null ? (
        <p className="muted">Loading…</p>
      ) : list.length ? (
        <div className="request-grid">
          {list.map((r) => (
            <Link key={r.id} to={`/requests/${r.id}`} className="card request-card">
              <strong>{r.title}</strong>
              <span className="small">
                {r.qty} {r.unit}
                {r.budget && ` · around ${formatK(r.budget)} each`}
              </span>
              <span className="small muted">
                <Icon name="pin" size={14} className="inline-icon" />{formatLocation(r)} · {getCategory(r.category)?.name ?? 'Any category'}
              </span>
              <span className="small muted">
                {r.buyerName} · {ago(r.date)} · {r.offerCount} offer{r.offerCount === 1 ? '' : 's'}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card empty">No open requests match. Be the first to post one.</div>
      )}
    </div>
  );
}

function OfferForm({ request, onSent }) {
  const [form, setForm] = useState({ price: request.budget ?? '', note: '' });
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.sendOffer(request.id, form);
      onSent();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="respond-form" onSubmit={submit}>
      <strong>Send your offer</strong>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="of-price">Your price per unit (K)</label>
          <input id="of-price" type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
        </div>
      </div>
      <input placeholder="Delivery, brand, availability…" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} aria-label="Note to the buyer" />
      {form.price > 0 && <p className="small muted">Total {formatK(form.price * request.qty)} for {request.qty} {request.unit}</p>}
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-sm">Send offer</button>
    </form>
  );
}

export function RequestDetail() {
  const { id } = useParams();
  const { user, myShop, notify } = useStore();
  const navigate = useNavigate();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api
      .buyingRequest(id)
      .then(setR)
      .catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <div className="container section error">{error}</div>;
  if (!r) return <div className="container section muted">Loading…</div>;
  const myOffer = r.offers.find((o) => o.shopId === myShop?.id);

  const accept = async (offer) => {
    await api.acceptOffer(r.id, offer.id);
    notify(`Accepted. Message ${offer.shopName} to arrange the order.`);
    load();
  };
  const messageShop = async (offer) => {
    const { id: conversation } = await api.startConversation({
      shopId: offer.shopId,
      body: `Hi, about your offer of ${formatK(offer.price)} each for "${r.title}" (${r.qty} ${r.unit}).`,
    });
    navigate(`/messages/${conversation}`);
  };

  return (
    <div className="container section narrow">
      <Link to="/requests" className="link small">
        ← All requests
      </Link>
      <article className="card form-card">
        <div className="order-head">
          <h1 className="request-title">{r.title}</h1>
          <span className={`status ${r.status === 'open' ? 'status-dispatched' : 'status-declined'}`}>{r.status}</span>
        </div>
        <p>
          <strong>
            {r.qty} {r.unit}
          </strong>
          {r.budget && ` · budget around ${formatK(r.budget)} each`}
        </p>
        <p className="muted small">
          <Icon name="pin" size={14} className="inline-icon" />{formatLocation(r)} · {getCategory(r.category)?.name ?? 'Any category'} · posted {ago(r.date)} by {r.buyerName}
        </p>
        {r.description && <p className="pre-line">{r.description}</p>}
        <ShareButton title={r.title} text={`Can you supply this? ${r.title} in ${r.town}`} path={`/requests/${r.id}`} />
      </article>

      {r.mine ? (
        <section className="card form-card">
          <h2>Offers ({r.offers.length})</h2>
          {r.offers.length ? (
            <ul className="offer-list">
              {r.offers.map((o) => (
                <li key={o.id} className={o.id === r.acceptedOfferId ? 'accepted' : ''}>
                  <div className="grow">
                    <strong>
                      <Link to={`/store/${o.shopId}`}>{o.shopName}</Link> {o.shopVerified && <span className="verified-badge">✓</span>}
                    </strong>
                    <div className="small muted"><Icon name="pin" size={14} className="inline-icon" />{o.shopTown}</div>
                    {o.note && <div className="small">“{o.note}”</div>}
                    {o.productId && (
                      <Link to={`/product/${o.productId}`} className="link small">
                        See the product →
                      </Link>
                    )}
                  </div>
                  <div className="offer-price">
                    <strong>{formatK(o.price)}</strong>
                    <span className="small muted">each · {formatK(o.price * r.qty)} total</span>
                  </div>
                  <div className="pdp-buttons">
                    {r.status === 'open' && (
                      <button className="btn btn-primary btn-sm" onClick={() => accept(o)}>
                        Accept
                      </button>
                    )}
                    <button className="btn btn-outline btn-sm" onClick={() => messageShop(o)}>
                      💬 Message
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No offers yet. Shops across Zambia can see your request, and we'll notify you when an offer comes in.</p>
          )}
          {r.status === 'open' && (
            <button className="link-btn" onClick={async () => {
              await api.closeBuyingRequest(r.id);
              load();
            }}>
              Close this request
            </button>
          )}
        </section>
      ) : myShop ? (
        <section className="card form-card">
          {myOffer && (
            <p className="quote-offer">
              Your offer: <strong>{formatK(myOffer.price)}</strong> each {myOffer.note && `· “${myOffer.note}”`}
            </p>
          )}
          {r.status === 'open' ? (
            <OfferForm request={r} onSent={() => {
                notify('Offer sent');
                load();
              }} />
          ) : (
            <p className="muted">This request is closed.</p>
          )}
        </section>
      ) : (
        !user && (
          <p className="muted">
            <Link to={`/login?next=/requests/${r.id}`}>Sign in</Link> with a shop account to send an offer.
          </p>
        )
      )}
    </div>
  );
}
