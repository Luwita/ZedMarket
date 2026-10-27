import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { bannerThemes } from '../data/bannerThemes';
import { getCategory } from '../data/catalog';
import { getProvince, provinces } from '../data/zambia';
import { downloadCsv } from '../utils/csv';
import { compressImage } from '../utils/image';
import { formatK } from '../utils/format';
import { ReasonButton, SearchBox, date, useAdminList } from './adminKit';

const pct = (n) => `${Math.round(n * 100)}%`;
const PAYOUT_METHODS = { mtn: 'MTN MoMo', airtel: 'Airtel Money', zamtel: 'Zamtel Kwacha', bank: 'Bank transfer' };
const AUDIENCES = {
  all: 'Everyone',
  buyers: 'Shoppers and business buyers',
  sellers: 'Shop owners',
  province: 'People in one province',
  phone: 'One customer (by phone)',
};
const audienceLabel = (a) => (a.audience === 'province' ? `${getProvince(a.province)?.name} Province` : AUDIENCES[a.audience]);

// ---------------------------------------------------------------- Analytics

// Horizontal bars for a ranked list (provinces, shops, categories…).
function BarList({ title, rows, label, money = true }) {
  const max = Math.max(1, ...rows.map((r) => r.gmv));
  return (
    <section className="card form-card">
      <h3>{title}</h3>
      {rows.length ? (
        <ul className="bar-list">
          {rows.map((r) => (
            <li key={r.key}>
              <span className="bar-label">{label(r)}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(r.gmv / max) * 100}%` }} />
              </span>
              <span className="bar-value">
                {money ? formatK(r.gmv) : r.gmv}
                <small className="muted block">
                  {r.units != null ? `${r.units} sold` : `${r.orders} order${r.orders === 1 ? '' : 's'}`}
                </small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No sales in this period.</p>
      )}
    </section>
  );
}

export function Analytics() {
  const [days, setDays] = useState(30);
  const { items: a } = useAdminList(() => api.admin.analytics(days), { days });
  if (!a) return <p className="muted">Loading…</p>;
  const max = Math.max(1, ...a.daily.map((d) => d.gmv));
  const tile = (label, value, sub) => (
    <div className="tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
  const exportCsv = () =>
    downloadCsv(`zed-market-${days}-days.csv`, [
      ['date', 'orders', 'sales_kwacha', 'new_users'],
      ...a.daily.map((d) => [d.day.slice(0, 10), d.orders, d.gmv, d.users]),
      [],
      ['shop', 'town', 'orders', 'sales_kwacha'],
      ...a.shops.map((s) => [s.name, s.town, s.orders, s.gmv]),
    ]);

  return (
    <>
      <div className="admin-filters">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={exportCsv}>
          Download CSV
        </button>
      </div>
      <div className="tiles">
        {tile('Sales (GMV)', formatK(a.gmv), `${a.orders} orders · ${formatK(a.averageOrder)} average`)}
        {tile('Commission earned', formatK(a.commission), `${a.delivered} parcels delivered`)}
        {tile('Customers who bought', a.buyers, `${a.newUsers} new sign-ups`)}
        {tile('New shops', a.newShops)}
        {tile('Vouchers spent', formatK(a.vouchers), 'paid by Zed Market')}
        {tile('Refunds', formatK(a.refunds), `${pct(a.cancellationRate)} of parcels cancelled`)}
      </div>

      <section className="card form-card">
        <h3>Sales per day</h3>
        <div className="day-chart" role="img" aria-label="Sales per day">
          {a.daily.map((d) => (
            <span
              key={d.day}
              className="day-bar"
              style={{ height: `${Math.max(2, (d.gmv / max) * 100)}%` }}
              title={`${date(d.day)}: ${formatK(d.gmv)}, ${d.orders} orders, ${d.users} new users`}
            />
          ))}
        </div>
        <div className="day-axis small muted">
          <span>{date(a.daily[0].day)}</span>
          <span>{date(a.daily.at(-1).day)}</span>
        </div>
      </section>

      <div className="admin-grid">
        <BarList title="Provinces" rows={a.provinces} label={(r) => getProvince(r.key)?.name ?? r.key} />
        <BarList title="Top shops" rows={a.shops} label={(r) => `${r.name} · ${r.town}`} />
        <BarList title="Categories" rows={a.categories} label={(r) => getCategory(r.key)?.name ?? r.key} />
        <BarList title="Payment methods" rows={a.payments} label={(r) => r.key} />
        <BarList title="Couriers (delivery fees)" rows={a.couriers} label={(r) => r.key} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Payouts

// Records money moving between Zed Market and a shop: a payout to the shop, or commission received from it.
function PayForm({ shop, onPaid, amount = shop.available, label = 'Record payout' }) {
  const [form, setForm] = useState({ amount: String(amount), method: 'mtn', reference: '', note: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="pay-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await onPaid({ shopId: shop.shopId, ...form });
      }}
    >
      <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} aria-label="Amount" />
      <select value={form.method} onChange={set('method')} aria-label="Method">
        {Object.entries(PAYOUT_METHODS).map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <input value={form.reference} onChange={set('reference')} placeholder="Transaction reference" aria-label="Reference" />
      <button className="btn btn-primary btn-sm" disabled={form.reference.trim().length < 3}>
        {label}
      </button>
    </form>
  );
}

// Where shops send the commission they owe. Owners set it; shops see it next to the amount they owe.
function CommissionAccount() {
  const { user } = useStore();
  const { items, run } = useAdminList(() => api.admin.commissionAccount().then((a) => a ?? {}), {});
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (items) setForm({ network: items.network ?? 'mtn', number: items.number ?? '', name: items.name ?? '' });
  }, [items]);
  if (!form) return null;
  const isOwner = user?.staffRole === 'owner';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="card form-card"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => api.admin.saveCommissionAccount(form), 'Saved. Shops now see where to pay.');
      }}
    >
      <h3>Where shops pay their commission</h3>
      {!items.number && (
        <p className="review-note">Not set yet: shops can see what they owe, but not where to send it.</p>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ca-network">Network or bank</label>
          <select id="ca-network" value={form.network} onChange={set('network')} disabled={!isOwner}>
            {Object.entries(PAYOUT_METHODS).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ca-number">Number or account</label>
          <input id="ca-number" value={form.number} onChange={set('number')} disabled={!isOwner} placeholder="097 123 4567" />
        </div>
        <div className="field">
          <label htmlFor="ca-name">Registered name</label>
          <input id="ca-name" value={form.name} onChange={set('name')} disabled={!isOwner} placeholder="e.g. Zed Market Ltd" />
        </div>
      </div>
      {isOwner ? <button className="btn btn-primary btn-sm">Save</button> : <p className="muted small">Only owners can change this.</p>}
    </form>
  );
}

export function Payouts() {
  const { items, run } = useAdminList(() => api.admin.payouts(), {});
  const [paying, setPaying] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);
  const { items: history } = useAdminList(() => api.admin.payoutHistory(), { historyKey });
  if (!items) return <p className="muted">Loading…</p>;
  const owed = items.reduce((n, s) => n + Math.max(0, s.available), 0);
  const held = items.reduce((n, s) => n + s.onHold, 0);
  const toCollect = items.reduce((n, s) => n + (s.owed ?? 0), 0);

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span>Ready to pay</span>
          <strong>{formatK(owed)}</strong>
          <small>return window passed, no open disputes</small>
        </div>
        <div className="tile">
          <span>On hold</span>
          <strong>{formatK(held)}</strong>
          <small>delivered in the last 7 days or disputed</small>
        </div>
        <div className="tile">
          <span>Commission to collect</span>
          <strong>{formatK(toCollect)}</strong>
          <small>owed to Zed Market by shops</small>
        </div>
      </div>
      <p className="muted small">
        Buyers pay shops directly, by Mobile Money or on delivery, so the shop already has the money: it owes the
        commission (shown as a negative balance) and gets back any Zed Market voucher its buyers used. When a shop
        sends its commission, record it here; "Remind" sends the shop the amount and where to pay, in the app and by
        text.
      </p>
      <CommissionAccount />
      {items.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Shop</th>
                <th>Available</th>
                <th>On hold</th>
                <th>Refunds</th>
                <th>Paid out</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.shopId}>
                  <td>
                    <Link to={`/store/${s.shopId}`}>{s.shopName}</Link>
                    <span className="block small muted">
                      {s.shopTown} · {s.shopPhone} · {s.parcels} parcels
                    </span>
                  </td>
                  <td className={s.available < 0 ? 'error' : ''}>
                    <strong>{formatK(s.available)}</strong>
                  </td>
                  <td>{formatK(s.onHold)}</td>
                  <td>{formatK(s.refunds)}</td>
                  <td>
                    {formatK(s.paidOut)}
                    {s.lastPayoutAt && <span className="block small muted">last {date(s.lastPayoutAt)}</span>}
                  </td>
                  <td>
                    {paying === s.shopId ? (
                      <PayForm
                        shop={s}
                        onPaid={async (body) => {
                          if (await run(() => api.admin.pay(body), `Payout to ${s.shopName} recorded`)) {
                            setPaying(null);
                            setHistoryKey((k) => k + 1);
                          }
                        }}
                      />
                    ) : collecting === s.shopId ? (
                      <PayForm
                        shop={s}
                        amount={s.owed}
                        label="Record commission"
                        onPaid={async (body) => {
                          if (await run(() => api.admin.receiveCommission(body), `Commission from ${s.shopName} recorded`)) {
                            setCollecting(null);
                            setHistoryKey((k) => k + 1);
                          }
                        }}
                      />
                    ) : s.available > 0 ? (
                      <button className="btn btn-primary btn-sm" onClick={() => setPaying(s.shopId)}>
                        Pay {formatK(s.available)}
                      </button>
                    ) : (
                      s.owed > 0 && (
                        <span className="pdp-buttons">
                          <button className="btn btn-primary btn-sm" onClick={() => setCollecting(s.shopId)}>
                            Commission received
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => run(() => api.admin.remindCommission(s.shopId), `${s.shopName} has been reminded`)}
                          >
                            Remind
                          </button>
                        </span>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No delivered orders yet.</p>
      )}

      <h3>Payment history</h3>
      {history?.length ? (
        <ul className="admin-log">
          {history.map((p) => (
            <li key={p.id}>
              <strong>{formatK(p.amount)}</strong>{' '}
              {p.kind === 'commission' ? `commission from ${p.shopName}` : `to ${p.shopName}`} ·{' '}
              {PAYOUT_METHODS[p.method]} {p.reference}
              <span className="muted small"> · {date(p.date)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No payments yet.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Marketing

const blankBanner = { title: '', text: '', cta: 'Shop now', link: '/shop', theme: 'orange', image: '', position: 0, endsAt: '' };

export function BannerPreview({ banner }) {
  return (
    <div className="hero banner-preview-hero" style={{ background: bannerThemes[banner.theme] ?? bannerThemes.orange }}>
      <div className="hero-copy">
        <h1>{banner.title || 'Banner title'}</h1>
        {banner.text && <p>{banner.text}</p>}
        <span className="btn btn-light">{banner.cta} →</span>
      </div>
      {banner.image && <img className="hero-image" src={banner.image} alt="" />}
    </div>
  );
}

function Banners() {
  const { notify } = useStore();
  const { items, run } = useAdminList(() => api.admin.banners(), {});
  const [form, setForm] = useState(blankBanner);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const body = { ...form, position: Number(form.position) || 0, endsAt: form.endsAt || null };
    if (await run(() => api.admin.createBanner(body), 'Banner published')) setForm(blankBanner);
  };
  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await api.uploadImage(await compressImage(file, 900, 0.75));
      setForm((f) => ({ ...f, image: url }));
    } catch (err) {
      notify(err.message);
    }
  };

  return (
    <section className="card form-card">
      <h3>Home page banners</h3>
      <p className="muted small">Shown first in the home page slideshow, before the standard slides.</p>
      <form onSubmit={submit} className="marketing-form">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="bn-title">Banner title</label>
            <input id="bn-title" value={form.title} onChange={set('title')} maxLength={60} placeholder="e.g. Independence Day deals" />
          </div>
          <div className="field">
            <label htmlFor="bn-link">Opens</label>
            <input id="bn-link" value={form.link} onChange={set('link')} placeholder="/shop?sort=deals" />
          </div>
          <div className="field">
            <label htmlFor="bn-cta">Button text</label>
            <input id="bn-cta" value={form.cta} onChange={set('cta')} maxLength={30} />
          </div>
          <div className="field">
            <label htmlFor="bn-theme">Colour</label>
            <select id="bn-theme" value={form.theme} onChange={set('theme')}>
              {Object.keys(bannerThemes).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bn-ends">Ends (optional)</label>
            <input id="bn-ends" type="date" value={form.endsAt} onChange={set('endsAt')} />
          </div>
          <div className="field">
            <label htmlFor="bn-pos">Order (0 = first)</label>
            <input id="bn-pos" type="number" min="0" value={form.position} onChange={set('position')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="bn-text">Text</label>
          <input id="bn-text" value={form.text} onChange={set('text')} maxLength={160} />
        </div>
        <div className="field">
          <span className="label">Picture (optional)</span>
          <input type="file" accept="image/*" onChange={upload} aria-label="Banner picture" />
        </div>
        <BannerPreview banner={form} />
        <button className="btn btn-primary">Publish banner</button>
      </form>

      {items?.length > 0 && (
        <ul className="admin-log">
          {items.map((b) => (
            <li key={b.id} className="banner-row">
              <span className="banner-swatch" style={{ background: bannerThemes[b.theme] }} />
              <span className="grow">
                <strong>{b.title}</strong> → {b.link}
                <span className="block small muted">
                  {b.live ? 'Live' : b.active ? 'Scheduled or ended' : 'Hidden'}
                  {b.endsAt && ` · until ${date(b.endsAt)}`}
                </span>
              </span>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => run(() => api.admin.updateBanner(b.id, { active: !b.active }), b.active ? 'Banner hidden' : 'Banner shown')}
              >
                {b.active ? 'Hide' : 'Show'}
              </button>
              <button className="link-btn danger" onClick={() => run(() => api.admin.deleteBanner(b.id), 'Banner deleted')}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AudienceFields({ form, set, allowPhone = false, idPrefix }) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-aud`}>Send to</label>
        <select id={`${idPrefix}-aud`} value={form.audience} onChange={set('audience')}>
          {Object.entries(AUDIENCES)
            .filter(([id]) => allowPhone || id !== 'phone')
            .map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
        </select>
      </div>
      {form.audience === 'province' && (
        <div className="field">
          <label htmlFor={`${idPrefix}-prov`}>Province</label>
          <select id={`${idPrefix}-prov`} value={form.province} onChange={set('province')}>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {form.audience === 'phone' && (
        <div className="field">
          <label htmlFor={`${idPrefix}-phone`}>Customer's phone</label>
          <input id={`${idPrefix}-phone`} type="tel" value={form.phone} onChange={set('phone')} placeholder="097 123 4567" />
        </div>
      )}
    </>
  );
}

const blankCampaign = { name: '', amount: '30', minSpend: '200', days: '30', audience: 'all', province: 'lusaka', phone: '' };

function Campaigns() {
  const { items, run } = useAdminList(() => api.admin.campaigns(), {});
  const [form, setForm] = useState(blankCampaign);
  const [confirming, setConfirming] = useState(false);
  const set = (k) => (e) => {
    setConfirming(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const submit = async (e) => {
    e.preventDefault();
    // Vouchers cost Zed Market real money, so sending to a group needs a second click.
    if (form.audience !== 'phone' && !confirming) {
      setConfirming(true);
      return;
    }
    if (await run(() => api.admin.createCampaign(form), `Vouchers sent: ${form.name}`)) {
      setForm(blankCampaign);
      setConfirming(false);
    }
  };
  return (
    <section className="card form-card">
      <h3>Voucher campaigns</h3>
      <p className="muted small">Zed Market pays for these vouchers; shops receive their full price.</p>
      <form onSubmit={submit} className="marketing-form">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="vc-name">Campaign name (shown to customers)</label>
            <input id="vc-name" value={form.name} onChange={set('name')} placeholder="e.g. Independence Day" />
          </div>
          <div className="field">
            <label htmlFor="vc-amount">Voucher (K)</label>
            <input id="vc-amount" type="number" min="1" value={form.amount} onChange={set('amount')} />
          </div>
          <div className="field">
            <label htmlFor="vc-min">Minimum spend (K)</label>
            <input id="vc-min" type="number" min="0" value={form.minSpend} onChange={set('minSpend')} />
          </div>
          <div className="field">
            <label htmlFor="vc-days">Valid for (days)</label>
            <input id="vc-days" type="number" min="1" max="365" value={form.days} onChange={set('days')} />
          </div>
          <AudienceFields form={form} set={set} allowPhone idPrefix="vc" />
        </div>
        <button className={`btn ${confirming ? 'btn-danger' : 'btn-primary'}`}>
          {confirming ? `Confirm: send K${form.amount} to ${AUDIENCES[form.audience].toLowerCase()}` : 'Send vouchers'}
        </button>
      </form>
      {items?.length > 0 && (
        <ul className="admin-log">
          {items.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>: {formatK(c.amount)} off over {formatK(c.minSpend)} · {audienceLabel(c)}
              <span className="block small muted">
                {c.issued} sent · {c.used} used ({c.issued ? pct(c.used / c.issued) : '0%'}) · ends {date(c.expiresAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const blankAnnouncement = { title: '', body: '', link: '', audience: 'all', province: 'lusaka' };

function Announcements() {
  const { items, run } = useAdminList(() => api.admin.announcements(), {});
  const [form, setForm] = useState(blankAnnouncement);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (await run(() => api.admin.announce(form), 'Announcement sent')) setForm(blankAnnouncement);
  };
  return (
    <section className="card form-card">
      <h3>Announcements</h3>
      <p className="muted small">Appears in the notifications of everyone in the group.</p>
      <form onSubmit={submit} className="marketing-form">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="an-title">Announcement title</label>
            <input id="an-title" value={form.title} onChange={set('title')} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="an-link">Opens (optional)</label>
            <input id="an-link" value={form.link} onChange={set('link')} placeholder="/shop?sort=deals" />
          </div>
          <AudienceFields form={form} set={set} idPrefix="an" />
        </div>
        <div className="field">
          <label htmlFor="an-body">Message</label>
          <textarea id="an-body" rows="2" maxLength={300} value={form.body} onChange={set('body')} />
        </div>
        <button className="btn btn-primary">Send announcement</button>
      </form>
      {items?.length > 0 && (
        <ul className="admin-log">
          {items.map((a) => (
            <li key={a.id}>
              <strong>{a.title}</strong> · {audienceLabel(a)}
              <span className="block small muted">
                sent to {a.sent} · {date(a.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Marketing() {
  return (
    <>
      <Banners />
      <Campaigns />
      <Announcements />
    </>
  );
}

// ---------------------------------------------------------------- Buying requests

export function RequestModeration() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('open');
  const { items, run } = useAdminList(() => api.admin.requests({ q, status }), { q, status });
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Search title or buyer">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="open">Open</option>
          <option value="removed">Removed</option>
          <option value="all">All</option>
        </select>
      </SearchBox>
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length ? (
        <ul className="admin-log">
          {items.map((r) => (
            <li key={r.id} className="banner-row">
              <span className="grow">
                <Link to={`/requests/${r.id}`}>
                  <strong>{r.title}</strong>
                </Link>{' '}
                · {r.qty} {r.unit} · {r.town}
                <span className="block small muted">
                  {r.buyerName} · {date(r.date)} · {r.offerCount} offers
                  {r.removedReason && ` · removed: ${r.removedReason}`}
                </span>
              </span>
              {r.status !== 'removed' && (
                <ReasonButton
                  label="Remove"
                  danger
                  placeholder="Reason (shown to the buyer)"
                  onConfirm={(reason) => run(() => api.admin.removeRequest(r.id, reason), 'Request removed')}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing here.</p>
      )}
    </>
  );
}
