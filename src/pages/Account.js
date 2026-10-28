import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import { CancelParcel, RETURN_DAYS, ReportProblem } from '../components/Cases';
import { BuyerPriceRequests } from '../components/PriceRequests';
import PayShop from '../components/PayShop';
import ProductCard from '../components/ProductCard';
import ShareButton from '../components/ShareButton';
import ShipmentStatus from '../components/ShipmentStatus';
import Stars from '../components/Stars';
import { useStore } from '../context/StoreContext';
import { REFERRAL_REWARD, VOUCHER_MIN_SPEND as MIN_SPEND, WELCOME_VOUCHER as WELCOME } from '../data/fees';
import { formatLocation } from '../data/zambia';
import { formatK } from '../utils/format';
import Icon from '../components/Icon';

const shortDate = (d) => new Date(d).toLocaleDateString('en-ZM', { dateStyle: 'medium' });

// Invite friends: they get a voucher when they join, the inviter gets one when their first order arrives.
function InvitePanel() {
  const [referral, setReferral] = useState(null);
  const [vouchers, setVouchers] = useState([]);
  const [amounts, setAmounts] = useState({ welcomeVoucher: WELCOME, referralReward: REFERRAL_REWARD, voucherMinSpend: MIN_SPEND });
  useEffect(() => {
    api.settings().then(setAmounts).catch(() => {});
    api.myReferral().then(setReferral).catch(() => {});
    api.myVouchers().then(setVouchers).catch(() => {});
  }, []);
  if (!referral) return <p className="muted">Loading…</p>;
  const link = `/login?ref=${referral.code}`;
  return (
    <div className="invite-layout">
      <section className="card form-card invite-card">
        <h2>Invite friends, get {formatK(amounts.referralReward)}</h2>
        <p className="muted">
          Your friend gets a {formatK(amounts.welcomeVoucher)} voucher when they join with your code. You get {formatK(amounts.referralReward)} when their
          first order is delivered. Vouchers work on orders over {formatK(amounts.voucherMinSpend)}.
        </p>
        <div className="invite-code">{referral.code}</div>
        <ShareButton
          title="Join Zed Market"
          text={`Shop from local shops across Zambia on Zed Market. Use my code ${referral.code} for ${formatK(amounts.welcomeVoucher)} off.`}
          path={link}
          label="Share my invite"
        />
        <p className="small muted">
          {referral.invited} friend{referral.invited === 1 ? '' : 's'} joined · {referral.rewarded} reward
          {referral.rewarded === 1 ? '' : 's'} earned
        </p>
      </section>
      <section className="card form-card">
        <h2>My vouchers</h2>
        {vouchers.length ? (
          <ul className="voucher-list">
            {vouchers.map((v) => (
              <li key={v.id} className={v.usable ? '' : 'used'}>
                <strong>{formatK(v.amount)}</strong>
                <span className="grow small">
                  {v.reason === 'welcome' ? 'Welcome gift' : v.reason === 'referral' ? 'Thanks for inviting a friend' : v.note}
                  <span className="block muted">
                    Orders over {formatK(v.minSpend)} ·{' '}
                    {v.usedOrderId ? `used on ${v.usedOrderId}` : v.usable ? `use by ${shortDate(v.expiresAt)}` : 'expired'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No vouchers yet. Invite a friend to get one.</p>
        )}
      </section>
    </div>
  );
}

const roleLabel = { business: 'Business buyer', seller: 'Shop owner', buyer: 'Shopper' };

// What a buyer can do with a parcel: cancel before it is sent, or report a problem afterwards.
function ParcelActions({ order, shipment }) {
  if (shipment.status === 'pending') {
    return (
      <CancelParcel
        orderId={order.id}
        shopId={shipment.shopId}
        role="buyer"
        paid={shipment.paid}
        sent={!!shipment.paymentSentAt}
      />
    );
  }
  const activeCase = shipment.latestCase && ['open', 'rejected', 'escalated'].includes(shipment.latestCase.status);
  const inWindow =
    shipment.status === 'dispatched' ||
    (shipment.status === 'delivered' &&
      shipment.deliveredAt &&
      new Date(shipment.deliveredAt) > new Date(Date.now() - RETURN_DAYS * 864e5));
  if (activeCase || !inWindow) return null;
  return <ReportProblem order={order} shipment={shipment} />;
}

// The buyer's rights under the Data Protection Act: a copy of their data, and deleting the account.
// Change the password of an account that signs in with email and password.
function PasswordPanel() {
  const { changePassword, notify } = useStore();
  const [form, setForm] = useState({ current: '', next: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (form.next.length < 8) return setError('Use a new password of at least 8 characters');
    setBusy(true);
    setError(null);
    try {
      await changePassword({ currentPassword: form.current, newPassword: form.next });
      setForm({ current: '', next: '' });
      notify('Password changed. Your other devices have been signed out.');
    } catch (err) {
      setError(/credential|password not found/i.test(err.message) ? 'This account signs in with Google, so it has no password.' : err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card form-card narrow-card">
      <h3>Change password</h3>
      <form onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor="pw-current">Current password</label>
          <input id="pw-current" type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="pw-next">New password</label>
          <input id="pw-next" type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))} />
          <span className="muted small">At least 8 characters.</span>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}

function PrivacyPanel() {
  const { deleteAccount, myShop, notify } = useStore();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    try {
      const data = await api.exportMyData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zed-market-my-data.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      notify(err.message);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      navigate('/');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="card form-card narrow-card">
      <h2>Your data</h2>
      <p className="muted">
        Download a copy of everything Zed Market holds about you: profile, orders, reviews, messages and price requests.
        See our <Link to="/legal/privacy">privacy policy</Link>.
      </p>
      <button className="btn btn-outline" onClick={download}>
        ⬇ Download my data
      </button>

      <h2 className="danger-title">Delete my account</h2>
      {myShop ? (
        <p className="muted">
          You own {myShop.name}. Contact support@zedmarket.co.zm to close your shop before deleting your account.
        </p>
      ) : (
        <>
          <p className="muted">
            Your name, phone number, messages and price requests are removed and you are signed out. Shops keep order
            records without your details. This can't be undone.
          </p>
          <div className="field">
            <label htmlFor="confirm-delete">Type DELETE to confirm</label>
            <input id="confirm-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-danger" disabled={confirm !== 'DELETE' || busy} onClick={remove}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </>
      )}
    </div>
  );
}

// One bought item. Once its parcel is delivered, the buyer can rate it (once).
function OrderItem({ orderId, item, delivered }) {
  const { reviewItem } = useStore();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) return setError('Choose 1 to 5 stars');
    setSaving(true);
    try {
      await reviewItem({ orderId, productId: item.id, rating, comment });
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="order-item">
      <span>
        {item.qty} × <Link to={`/product/${item.id}`}>{item.name}</Link>
        {item.options && <span className="muted"> ({item.options})</span>}
      </span>
      {item.reviewRating ? (
        <span className="small muted">
          You rated <Stars value={item.reviewRating} size="sm" />
        </span>
      ) : (
        delivered &&
        !open && (
          <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
            ★ Rate this item
          </button>
        )
      )}
      {open && (
        <form className="review-form" onSubmit={submit}>
          <Stars value={rating} onChange={setRating} />
          <textarea
            rows="2"
            placeholder="What did you like or not like? (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-label="Your review"
          />
          {error && <span className="error">{error}</span>}
          <div className="pdp-buttons">
            <button className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Sending…' : 'Post review'}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export default function Account() {
  const { user, logout, orders, wishlist, getProduct, myShop, location, buyAgain, notify } = useStore();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get('tab') ?? 'orders';
  const saved = wishlist.map(getProduct).filter(Boolean);
  const myOrders = user ? orders : [];
  const needsShop = user?.accountType === 'seller' && !myShop && !user?.isAdmin;

  return (
    <div className="container section">
      <div className="account-head">
        <div>
          <h1>{user ? `Muli shani, ${user.name.split(' ')[0]}` : 'My account'}</h1>
          <p className="muted">
            {user &&
              `${user.phone ?? user.email ?? ''} · ${user.isAdmin ? (user.staffRole === 'owner' ? 'Zed Market owner' : 'Zed Market staff') : (roleLabel[user.accountType] ?? 'Shopper')} · `}<Icon name="pin" size={14} className="inline-icon" />{formatLocation(location)}
          </p>
        </div>
        <div className="pdp-buttons">
          {user?.isAdmin && (
            <Link to="/admin" className="btn btn-primary">
              Admin panel
            </Link>
          )}
          {myShop && (
            <Link to="/seller" className="btn btn-primary">
              {myShop.name} dashboard
            </Link>
          )}
          {user ? (
            <button
              className="btn btn-outline"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              Sign out
            </button>
          ) : (
            <Link to="/login" className="btn btn-primary">
              Sign in
            </Link>
          )}
        </div>
      </div>

      {needsShop && (
        <div className="card setup-shop">
          <span className="shop-logo">🏪</span>
          <div className="grow">
            <strong>Finish setting up your shop</strong>
            <p className="muted small">
              Add your shop name, location and couriers, then start uploading products. It takes 2 minutes.
            </p>
          </div>
          <Link to="/sell#register" className="btn btn-primary">
            Set up my shop
          </Link>
        </div>
      )}

      <div className="tabs tabs-scroll">
        <button className={tab === 'orders' ? 'on' : ''} onClick={() => setParams({ tab: 'orders' })}>
          Orders ({myOrders.length})
        </button>
        <button className={tab === 'wishlist' ? 'on' : ''} onClick={() => setParams({ tab: 'wishlist' })}>
          Saved items ({saved.length})
        </button>
        {user && (
          <>
            <button className={tab === 'quotes' ? 'on' : ''} onClick={() => setParams({ tab: 'quotes' })}>
              Price requests
            </button>
            <button className={tab === 'invite' ? 'on' : ''} onClick={() => setParams({ tab: 'invite' })}>
              Invite & vouchers
            </button>
            <button className={tab === 'privacy' ? 'on' : ''} onClick={() => setParams({ tab: 'privacy' })}>
              Password & privacy
            </button>
          </>
        )}
      </div>

      {tab === 'orders' &&
        (myOrders.length ? (
          <div className="orders">
            {myOrders.map((o) => (
              <div key={o.id} className="card order">
                <div className="order-head">
                  <strong>{o.id}</strong>
                  <span className="muted small">
                    {new Date(o.date).toLocaleDateString('en-ZM', { dateStyle: 'medium' })} · {o.payment}
                  </span>
                  <span>
                    <strong>{formatK(o.total)}</strong>{' '}
                    <Link to={`/order/${o.id}/receipt`} className="link small">
                      Receipt
                    </Link>{' '}
                    <button
                      className="link-btn small"
                      onClick={() => {
                        buyAgain(o);
                        notify('Added to your cart');
                        navigate('/cart');
                      }}
                    >
                      Buy again
                    </button>
                  </span>
                </div>
                {o.shipments.map((s) => (
                  <div key={s.shopId} className="order-shipment">
                    <strong className="small">{s.shopName}</strong>
                    <ul className="order-items">
                      {s.items.map((i) => (
                        <OrderItem
                          key={`${i.id}-${i.options}`}
                          orderId={o.id}
                          item={i}
                          delivered={s.status === 'delivered'}
                        />
                      ))}
                    </ul>
                    <PayShop order={o} shipment={s} />
                    <ShipmentStatus shipment={s} />
                    {s.pickupPoint && <p className="small muted">Collect from {s.pickupPoint}</p>}
                    <ParcelActions order={o} shipment={s} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="card empty">
            <p>{user ? 'No orders yet.' : 'Sign in to see your orders.'}</p>
            <Link to={user ? '/shop' : '/login?next=/account'} className="btn btn-primary">
              {user ? 'Start shopping' : 'Sign in'}
            </Link>
          </div>
        ))}

      {tab === 'quotes' && user && <BuyerPriceRequests />}
      {tab === 'privacy' && user && (
        <>
          <PasswordPanel />
          <PrivacyPanel />
        </>
      )}
      {tab === 'invite' && user && <InvitePanel />}

      {tab === 'wishlist' &&
        (saved.length ? (
          <div className="grid grid-4">
            {saved.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <div className="card empty">
            <p>Tap the heart on any product to save it here.</p>
          </div>
        ))}
    </div>
  );
}
