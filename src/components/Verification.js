import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api';
import { useStore } from '../context/StoreContext';

// Seller dashboard notices: suspension and listings removed by staff.
export function ShopNotices() {
  const [info, setInfo] = useState(null);
  const [removed, setRemoved] = useState([]);
  useEffect(() => {
    api
      .sellerVerification()
      .then(setInfo)
      .catch(() => {});
    api
      .removedProducts()
      .then(setRemoved)
      .catch(() => {});
  }, []);
  return (
    <>
      {info?.status === 'pending' && (
        <div className="card alert-bar review-bar" role="status">
          <strong>Your shop is waiting for approval.</strong> Zed Market checks every new shop before buyers can see
          it, usually within 2 working days. You can add products now; they go live as soon as your shop is approved.
        </div>
      )}
      {info?.status === 'rejected' && (
        <div className="card alert-bar danger-bar" role="alert">
          <strong>Your shop wasn't approved yet:</strong> {info.note}. Update your details under{' '}
          <Link to="/seller?tab=settings">Shop &amp; delivery</Link> and we'll look again.
        </div>
      )}
      {info?.status === 'unverified' && (
        <div className="card alert-bar review-bar" role="status">
          Your shop isn't visible to buyers yet. Send your details under{' '}
          <Link to="/seller?tab=settings">Shop &amp; delivery</Link> to have it approved.
        </div>
      )}
      {info?.suspended && (
        <div className="card alert-bar danger-bar" role="alert">
          Your shop is suspended and hidden from buyers: {info.suspendReason}. Contact support@zedmarket.co.zm.
        </div>
      )}
      {removed.length > 0 && (
        <div className="card alert-bar" role="status">
          Zed Market removed {removed.length === 1 ? 'a listing' : `${removed.length} listings`}:
          <ul>
            {removed.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>: {p.removedReason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

const STATUS = {
  unverified: 'Not sent yet: your shop is hidden from buyers',
  pending: 'Waiting for approval (usually within 2 working days). Buyers will see your shop once approved.',
  verified: 'Approved: your shop is live, with a verified badge',
  rejected: 'Not approved yet',
};

// Shop settings: the owner details Zed Market checks before a shop goes live.
export default function VerificationPanel() {
  const { notify, reloadCatalog } = useStore();
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ ownerFullName: '', nrc: '', pacra: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .sellerVerification()
      .then((v) => {
        setInfo(v);
        setForm({ ownerFullName: v.ownerFullName ?? '', nrc: v.nrc ?? '', pacra: v.pacra ?? '' });
      })
      .catch((err) => setError(err.message));
  }, []);

  if (!info) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.submitVerification(form);
      setInfo((i) => ({ ...i, status: 'pending', note: null }));
      notify('Thanks! We will review your shop.');
      reloadCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="verification">
      <h3>Shop approval</h3>
      <p className={`verify-status verify-${info.status}`}>{STATUS[info.status]}</p>
      {info.status === 'rejected' && info.note && <p className="error">What to fix: {info.note}</p>}
      {info.status !== 'verified' && (
        <form onSubmit={submit} noValidate>
          <p className="muted small">
            Zed Market checks who runs every shop before it goes live. These details are only used for that check and
            are never shown to buyers.
          </p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="v-name">Full name (as on your NRC)</label>
              <input id="v-name" value={form.ownerFullName} onChange={set('ownerFullName')} />
            </div>
            <div className="field">
              <label htmlFor="v-nrc">NRC number</label>
              <input id="v-nrc" placeholder="123456/78/1" value={form.nrc} onChange={set('nrc')} />
            </div>
            <div className="field">
              <label htmlFor="v-pacra">PACRA registration (if registered)</label>
              <input id="v-pacra" value={form.pacra} onChange={set('pacra')} />
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>
            {info.status === 'pending' ? 'Update details' : 'Send for approval'}
          </button>
        </form>
      )}
    </section>
  );
}
