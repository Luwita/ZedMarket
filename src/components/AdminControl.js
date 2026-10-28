import { useEffect, useState } from 'react';
import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { formatK } from '../utils/format';
import { ReasonButton, date, useAdminList } from './adminKit';
import ProductForm from './ProductForm';
import ShopForm from './ShopForm';

// Photos picked in the browser are uploaded before saving.
const uploaded = async (src) => (src?.startsWith('data:') ? (await api.uploadImage(src)).url : src);

// Staff edits always carry a reason: it goes to the activity log and to the shop.
function ReasonField({ value, onChange, id }) {
  return (
    <div className="field">
      <label htmlFor={id}>Reason for the change (the shop sees this)</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Name as on PACRA certificate" />
    </div>
  );
}

export function EditShop({ shopId, onDone }) {
  const { notify } = useStore();
  const [shop, setShop] = useState(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    api.admin
      .shop(shopId)
      .then(setShop)
      .catch((err) => notify(err.message));
  }, [shopId, notify]);
  if (!shop) return <p className="muted">Loading…</p>;
  return (
    <div className="admin-edit">
      <ReasonField id={`shop-note-${shopId}`} value={note} onChange={setNote} />
      <ShopForm
        initial={shop}
        submitLabel="Save shop details"
        onSubmit={async (data) => {
          if (note.trim().length < 3) throw new Error('Give a reason for the change first');
          await api.admin.editShop(shopId, { ...data, banner: await uploaded(data.banner), note });
          notify(`${data.name} updated`);
          onDone();
        }}
      />
    </div>
  );
}

export function EditProduct({ productId, onDone }) {
  const { notify } = useStore();
  const [product, setProduct] = useState(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    api
      .getProduct(productId)
      .then(setProduct)
      .catch((err) => notify(err.message));
  }, [productId, notify]);
  if (!product) return <p className="muted">Loading…</p>;
  return (
    <div className="admin-edit">
      <ReasonField id={`product-note-${productId}`} value={note} onChange={setNote} />
      <ProductForm
        initial={{ ...product, description: product.description ?? '' }}
        submitLabel="Save listing"
        onSubmit={async (data) => {
          if (note.trim().length < 3) throw new Error('Give a reason for the change first');
          const images = await Promise.all(data.images.map(uploaded));
          await api.admin.editProduct(productId, { ...data, images, note });
          notify(`${data.name} updated`);
          onDone();
        }}
      />
    </div>
  );
}

// Move a parcel along for a shop, e.g. when the courier confirms delivery by phone.
// Moving a parcel along for a shop. A Mobile Money parcel must have its payment confirmed before it is sent.
export function ParcelControls({ orderId, shipment, payByMomo = false, run }) {
  const next = { pending: 'dispatched', dispatched: 'delivered' }[shipment.status];
  if (!next) return null;
  if (payByMomo && !shipment.paid && shipment.status === 'pending') {
    return (
      <ReasonButton
        label="Payment received"
        placeholder="How do you know? e.g. Shop confirmed by phone"
        onConfirm={(note) =>
          run(() => api.admin.confirmPayment(orderId, shipment.shopId, note), 'Payment confirmed; the buyer was told')
        }
      />
    );
  }
  return (
    <ReasonButton
      label={next === 'dispatched' ? 'Mark as sent' : 'Mark as delivered'}
      placeholder="How do you know? e.g. Courier confirmed"
      onConfirm={(note) =>
        run(
          () => api.admin.setParcelStatus(orderId, shipment.shopId, { status: next, note }),
          `Parcel marked ${next === 'dispatched' ? 'sent' : 'delivered'}`,
        )
      }
    />
  );
}

export function Staff() {
  const { user } = useStore();
  const { items, run } = useAdminList(() => api.admin.staff(), {});
  const [form, setForm] = useState({ email: '', name: '' });
  const isOwner = user?.staffRole === 'owner';
  return (
    <>
      <p className="muted small">
        Staff run Zed Market from this panel. Staff accounts can't own a shop, so a shop owner who joins the team needs a
        separate email address. Staff sign in with the address you add here. Owners are set with ADMIN_EMAILS on the
        server and are the only ones who can add or remove staff and change settings.
      </p>
      {isOwner && (
        <form
          className="card form-card admin-filters"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.admin.addStaff(form), `${form.name || form.email} added to the team`)) {
              setForm({ email: '', name: '' });
            }
          }}
        >
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="Email they sign in with"
            aria-label="Staff email"
          />
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name (if new)"
            aria-label="Staff name"
          />
          <button className="btn btn-primary btn-sm">Add staff</button>
        </form>
      )}
      <ul className="admin-log">
        {items?.map((s) => (
          <li key={s.id ?? s.email ?? s.phone} className="banner-row">
            <span className="grow">
              <strong>{s.name}</strong> · {s.email ?? s.phone}
              <span className="block small muted">
                {s.role === 'owner' ? 'Owner' : 'Staff'}
                {s.since && ` · since ${date(s.since)}`}
              </span>
            </span>
            {isOwner && s.role === 'staff' && (
              <button className="link-btn danger" onClick={() => run(() => api.admin.removeStaff(s.id), `${s.name} removed`)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

const SETTING_FIELDS = [
  ['commissionRate', 'Commission on goods sold (%)', 100, 'Applies to orders placed from now on.'],
  ['welcomeVoucher', 'Welcome voucher for invited friends (K)', 1, null],
  ['referralReward', 'Reward for the inviter (K)', 1, 'Given when the friend’s first order is delivered.'],
  ['voucherMinSpend', 'Minimum spend to use a voucher (K)', 1, null],
  ['voucherDays', 'Vouchers last (days)', 1, null],
  ['unpaidCancelHours', 'Cancel unpaid Mobile Money orders after (hours)', 1, 'The buyer is reminded halfway.'],
];

export function Settings() {
  const { user } = useStore();
  const { items, run } = useAdminList(() => api.admin.settings(), {});
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (items) {
      setForm(Object.fromEntries(SETTING_FIELDS.map(([key, , scale]) => [key, String(+(items.values[key] * scale).toFixed(2))])));
    }
  }, [items]);
  if (!items || !form) return <p className="muted">Loading…</p>;
  const isOwner = user?.staffRole === 'owner';
  const save = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(SETTING_FIELDS.map(([key, , scale]) => [key, Number(form[key]) / scale]));
    await run(() => api.admin.saveSettings(body), 'Settings saved');
  };
  return (
    <form className="card form-card narrow-card" onSubmit={save}>
      <h3>Platform settings</h3>
      {!isOwner && <p className="review-note">Only owners can change these.</p>}
      <div className="form-grid">
        {SETTING_FIELDS.map(([key, label, scale, hint]) => (
          <div className="field" key={key}>
            <label htmlFor={`set-${key}`}>{label}</label>
            <input
              id={`set-${key}`}
              type="number"
              min="0"
              step="any"
              disabled={!isOwner}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
            <span className="muted small">
              {hint ? `${hint} ` : ''}Default {key === 'commissionRate'
                ? `${items.defaults[key] * 100}%`
                : ['voucherDays', 'unpaidCancelHours'].includes(key)
                  ? items.defaults[key]
                  : formatK(items.defaults[key])}.
            </span>
          </div>
        ))}
      </div>
      {isOwner && <button className="btn btn-primary">Save settings</button>}
    </form>
  );
}
