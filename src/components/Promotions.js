import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { FEATURED_DAYS, FEATURED_LIMIT } from '../data/fees';
import { useProductSearch } from '../hooks/useProducts';
import { formatK } from '../utils/format';
import { ProductImage } from './ProductCard';

const describe = (c) => (c.kind === 'percent' ? `${c.value}% off` : `${formatK(c.value)} off`);

function CouponForm({ onCreated }) {
  const [form, setForm] = useState({ code: '', kind: 'percent', value: '', minSpend: '', maxUses: '', endsAt: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createCoupon({ ...form, minSpend: form.minSpend || 0 });
      setForm({ code: '', kind: 'percent', value: '', minSpend: '', maxUses: '', endsAt: '' });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="cp-code">Code</label>
          <input id="cp-code" placeholder="e.g. LUSAKA10" value={form.code} onChange={set('code')} />
        </div>
        <div className="field">
          <label htmlFor="cp-kind">Discount</label>
          <div className="inline-fields">
            <select id="cp-kind" value={form.kind} onChange={set('kind')} aria-label="Discount type">
              <option value="percent">% off</option>
              <option value="amount">Kwacha off</option>
            </select>
            <input
              type="number"
              min="0"
              placeholder={form.kind === 'percent' ? '10' : '50'}
              value={form.value}
              onChange={set('value')}
              aria-label="Discount value"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cp-min">Minimum spend (K, optional)</label>
          <input id="cp-min" type="number" min="0" value={form.minSpend} onChange={set('minSpend')} />
        </div>
        <div className="field">
          <label htmlFor="cp-max">Total uses allowed (optional)</label>
          <input id="cp-max" type="number" min="1" value={form.maxUses} onChange={set('maxUses')} />
        </div>
        <div className="field">
          <label htmlFor="cp-ends">Last day (optional)</label>
          <input id="cp-ends" type="date" value={form.endsAt} onChange={set('endsAt')} />
        </div>
      </div>
      <p className="muted small">Each customer can use a code once. It applies to your products only.</p>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Create code'}
      </button>
    </form>
  );
}

export default function Promotions({ shopId }) {
  const { notify, remember } = useStore();
  const [coupons, setCoupons] = useState(null);
  const products = useProductSearch({ shop: shopId, sort: 'popular', limit: 100 });
  const [featured, setFeatured] = useState({});

  const loadCoupons = useCallback(() => {
    api
      .sellerCoupons()
      .then(setCoupons)
      .catch((err) => notify(err.message));
  }, [notify]);
  useEffect(loadCoupons, [loadCoupons]);

  const isFeatured = (p) => {
    const until = featured[p.id] !== undefined ? featured[p.id] : p.featuredUntil;
    return until && new Date(until) > new Date();
  };
  const activeCount = products.items.filter(isFeatured).length;

  const toggleFeature = async (p) => {
    try {
      const updated = isFeatured(p) ? await api.unfeatureProduct(p.id) : await api.featureProduct(p.id);
      remember([updated]);
      setFeatured((f) => ({ ...f, [p.id]: updated.featuredUntil }));
    } catch (err) {
      notify(err.message);
    }
  };

  const toggleCoupon = async (c) => {
    try {
      await api.setCouponActive(c.id, !c.active);
      loadCoupons();
    } catch (err) {
      notify(err.message);
    }
  };

  return (
    <div className="promotions">
      <section className="card form-card">
        <h2>Discount codes</h2>
        <CouponForm onCreated={loadCoupons} />
        {coupons?.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Min. spend</th>
                  <th className="num">Used</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <code>{c.code}</code>
                    </td>
                    <td>{describe(c)}</td>
                    <td>{c.minSpend ? formatK(c.minSpend) : '—'}</td>
                    <td className="num">
                      {c.uses}
                      {c.maxUses ? ` / ${c.maxUses}` : ''}
                    </td>
                    <td>
                      {!c.active
                        ? 'Off'
                        : c.expired
                          ? 'Expired'
                          : c.maxUses && c.uses >= c.maxUses
                            ? 'Used up'
                            : 'Active'}
                      {c.endsAt && !c.expired && (
                        <span className="muted small"> until {new Date(c.endsAt).toLocaleDateString('en-ZM')}</span>
                      )}
                    </td>
                    <td>
                      <button className="link-btn" onClick={() => toggleCoupon(c)}>
                        {c.active ? 'Switch off' : 'Switch on'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card form-card">
        <h2>Featured on the home page</h2>
        <p className="muted small">
          Featured products appear in the "Featured" row on the home page for {FEATURED_DAYS} days, marked as featured.
          Free during launch, up to {FEATURED_LIMIT} at a time ({activeCount} in use).
        </p>
        <ul className="low-stock">
          {products.items.map((p) => (
            <li key={p.id}>
              <ProductImage product={p} size="xs" />
              <span className="grow">{p.name}</span>
              {isFeatured(p) && (
                <span className="small muted">
                  until {new Date(featured[p.id] ?? p.featuredUntil).toLocaleDateString('en-ZM')}
                </span>
              )}
              <button
                className={`btn btn-sm ${isFeatured(p) ? 'btn-outline' : 'btn-primary'}`}
                disabled={!isFeatured(p) && activeCount >= FEATURED_LIMIT}
                onClick={() => toggleFeature(p)}
              >
                {isFeatured(p) ? 'Stop featuring' : 'Feature'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
