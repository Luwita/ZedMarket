import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import { ReasonButton, SearchBox, date, useAdminList } from '../components/adminKit';
import { Analytics, Marketing, Payouts, RequestModeration } from '../components/AdminTools';
import { EditProduct, EditShop, ParcelControls, Settings, Staff } from '../components/AdminControl';
import { DeliverySettings } from '../components/AdminDelivery';
import { QrCodes } from '../components/AdminQr';
import SideNav from '../components/SideNav';
import { CASE_STATUS } from '../components/ShipmentStatus';
import { useStore } from '../context/StoreContext';
import { formatLocation } from '../data/zambia';
import { formatK } from '../utils/format';

function Overview({ go }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    api.admin
      .stats()
      .then(setS)
      .catch(() => {});
  }, []);
  if (!s) return <p className="muted">Loading…</p>;
  const tile = (label, value, sub, tab) => (
    <button className="tile tile-link" onClick={() => tab && go(tab)}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </button>
  );
  const todo = s.setup
    ? [
        s.setup.signInReady === false && [
          'Sign-in is not set up: add CLERK_SECRET_KEY to the server settings.',
        ],
        !s.setup.commissionSet && ['Set your commission rate.', 'settings'],
        s.setup.commissionAccountSet === false && [
          'Add the Mobile Money number shops send their commission to.',
          'payouts',
        ],
        s.setup.couriersUnconfirmed.length > 0 && [
          `Enter the rates you agreed with ${s.setup.couriersUnconfirmed.join(', ')}.`,
          'delivery',
        ],
        !s.setup.pointsConfirmed && ['Add your real Zed Market Points (buyers are offered none until you do).', 'delivery'],
        s.setup.shopsWithoutMomo > 0 && [
          `${s.setup.shopsWithoutMomo} shop${s.setup.shopsWithoutMomo > 1 ? 's have' : ' has'} no Mobile Money number, so buyers can only pay on delivery there.`,
          'shops',
        ],
      ].filter(Boolean)
    : [];
  return (
    <>
      {todo.length > 0 && (
        <section className="card alert-bar launch-list" role="status">
          <strong>Before you launch</strong>
          <ul>
            {todo.map(([text, tab]) => (
              <li key={text}>
                {text}{' '}
                {tab && (
                  <button className="link-btn" onClick={() => go(tab)}>
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <h3>Needs attention</h3>
      <div className="tiles">
        {tile('Disputes to decide', s.escalatedCases, `${s.openCases} waiting for shops`, 'cases')}
        {tile('Refunds to pay', s.refundsDue, formatK(s.refundsDueAmount), 'refunds')}
        {tile('Shops to review', s.shopsToVerify, 'not visible until approved', 'shops')}
        {tile('Late parcels', s.lateDispatch, 'not sent after 2 days', 'orders')}
        {tile('Questions to answer', s.supportWaiting, 'customers waiting for a reply', 'support')}
        {tile('Shops to pay', s.payoutsReady, formatK(s.payoutsReadyAmount), 'payouts')}
        {tile('Commission to collect', formatK(s.commissionOwed ?? 0), `${s.commissionOwedShops ?? 0} shops owe it`, 'payouts')}
      </div>
      <h3>Last 7 days</h3>
      <div className="tiles">
        {tile('Orders', s.orders7d, 'see analytics', 'analytics')}
        {tile('Sales', formatK(s.sales7d), null, 'analytics')}
        {tile('Shops', s.shops, `${s.products} products`, 'shops')}
        {tile('Users', s.users, null, 'users')}
      </div>
      <h3>Grow the marketplace</h3>
      <div className="tiles">
        {tile('Sign-up QR codes', 'View', 'for shop owners and customers', 'qr')}
      </div>
    </>
  );
}

function Shops() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('pending');
  const { items, run, reload } = useAdminList(() => api.admin.shops({ q, status }), [q, status]);
  const [editing, setEditing] = useState(null);
  const { user, notify } = useStore();
  const isOwner = user?.staffRole === 'owner';
  // Deleting can't be undone, so only owners see it. Past orders of the shop are kept for its buyers.
  const remove = (s, reason) =>
    run(async () => {
      const { kept, cancelled } = await api.admin.deleteShop(s.id, reason);
      if (cancelled) notify(`${cancelled} parcel${cancelled > 1 ? 's' : ''} not yet delivered ${cancelled > 1 ? 'were' : 'was'} cancelled`);
      if (kept) notify(`${s.name}'s past orders are kept for its buyers`);
    }, `${s.name} deleted`);
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Shop name, town or owner phone">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="pending">Waiting for approval</option>
          <option value="">All shops</option>
          <option value="verified">Approved (live)</option>
          <option value="unverified">Details not sent</option>
          <option value="rejected">Not approved</option>
          <option value="suspended">Suspended</option>
        </select>
      </SearchBox>
      {items?.length === 0 && <p className="muted">No shops match.</p>}
      <div className="orders">
        {items?.map((s) => (
          <div key={s.id} className="card order">
            <div className="order-head">
              <strong>
                <Link to={`/store/${s.id}`}>{s.name}</Link>
              </strong>
              <span className="muted small">
                {s.area}, {formatLocation(s)} · {s.productCount} products · since {s.since}
              </span>
              <span className={`status verify-${s.verification}`}>{s.verification}</span>
              {s.suspended && <span className="status status-declined">suspended</span>}
            </div>
            <div className="small">
              Owner: {s.ownerFullName ?? s.ownerName ?? '—'} · {s.ownerPhone ?? s.phone}
              {s.nrc && (
                <>
                  {' '}
                  · NRC <strong>{s.nrc}</strong>
                </>
              )}
              {s.pacra && <> · PACRA {s.pacra}</>}
              {s.tpin && <> · TPIN {s.tpin}</>}
            </div>
            {s.verificationNote && <div className="small muted">Note: {s.verificationNote}</div>}
            {s.suspendReason && <div className="small error">Suspended: {s.suspendReason}</div>}
            <div className="pdp-buttons">
              {s.verification === 'pending' && (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => run(() => api.admin.verifyShop(s.id, 'verified', ''), `${s.name} verified`)}
                  >
                    Approve
                  </button>
                  <ReasonButton
                    label="Reject"
                    placeholder="What should the shop fix?"
                    onConfirm={(note) =>
                      run(() => api.admin.verifyShop(s.id, 'rejected', note), 'Verification rejected')
                    }
                  />
                </>
              )}
              {s.suspended ? (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => run(() => api.admin.suspendShop(s.id, false), 'Shop restored')}
                >
                  Restore shop
                </button>
              ) : (
                <ReasonButton
                  label="Suspend"
                  danger
                  onConfirm={(reason) => run(() => api.admin.suspendShop(s.id, true, reason), 'Shop suspended')}
                />
              )}
              <button className="btn btn-outline btn-sm" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                {editing === s.id ? 'Close' : 'Edit details'}
              </button>
              {isOwner && (
                <ReasonButton
                  label="Delete shop"
                  placeholder="Why? This can't be undone"
                  danger
                  onConfirm={(reason) => remove(s, reason)}
                />
              )}
            </div>
            {editing === s.id && (
              <EditShop
                shopId={s.id}
                onDone={() => {
                  setEditing(null);
                  reload();
                }}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Listings() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('live');
  const { items, run, reload } = useAdminList(() => api.admin.products({ q, status }), [q, status]);
  const [editing, setEditing] = useState(null);
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Product, shop or product id">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="live">Live</option>
          <option value="removed">Removed by staff</option>
          <option value="">All</option>
        </select>
      </SearchBox>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Shop</th>
              <th className="num">Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items?.map((p) => [
              <tr key={p.id}>
                <td>
                  {p.removed ? p.name : <Link to={`/product/${p.id}`}>{p.name}</Link>}
                  {p.removedReason && <div className="small error">Removed: {p.removedReason}</div>}
                </td>
                <td>{p.shopName}</td>
                <td className="num">{formatK(p.price)}</td>
                <td>
                  {p.removedReason ? (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => run(() => api.admin.restoreProduct(p.id), 'Listing restored')}
                    >
                      Restore
                    </button>
                  ) : (
                    !p.removed && (
                      <span className="pdp-buttons">
                        <button className="btn btn-outline btn-sm" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                          {editing === p.id ? 'Close' : 'Edit'}
                        </button>
                        <ReasonButton
                          label="Remove"
                          danger
                          placeholder="Reason shown to the seller"
                          onConfirm={(reason) => run(() => api.admin.removeProduct(p.id, reason), 'Listing removed')}
                        />
                      </span>
                    )
                  )}
                </td>
              </tr>,
              editing === p.id && (
                <tr key={`${p.id}-edit`}>
                  <td colSpan={4}>
                    <EditProduct
                      productId={p.id}
                      onDone={() => {
                        setEditing(null);
                        reload();
                      }}
                    />
                  </td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Reviews() {
  const [q, setQ] = useState('');
  const { items, run } = useAdminList(() => api.admin.reviews({ q }), [q]);
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Words in the review, product or author" />
      <ul className="review-list card form-card">
        {items?.map((r) => (
          <li key={r.id}>
            <div className="review-head">
              <strong>{'★'.repeat(r.rating)}</strong> {r.author}
              <span className="muted small">
                on <Link to={`/product/${r.productId}`}>{r.productName}</Link> · {date(r.date)}
              </span>
            </div>
            {r.comment && <p>{r.comment}</p>}
            <ReasonButton
              label="Remove review"
              danger
              onConfirm={(reason) => run(() => api.admin.removeReview(r.id, reason), 'Review removed')}
            />
          </li>
        ))}
        {items?.length === 0 && <li className="muted">No reviews match.</li>}
      </ul>
    </>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const { user, notify } = useStore();
  const { items, run } = useAdminList(() => api.admin.users({ q }), [q]);
  // Deleting can't be undone, so only owners see it, and only for customers (staff and shop owners are removed
  // under Staff and Shops). Undelivered parcels of the person are cancelled.
  const canDelete = user.staffRole === 'owner';
  const remove = (u, reason) =>
    run(async () => {
      const { cancelled } = await api.admin.deleteUser(u.id, reason);
      if (cancelled) notify(`${cancelled} parcel${cancelled > 1 ? 's' : ''} not yet delivered ${cancelled > 1 ? 'were' : 'was'} cancelled`);
    }, `${u.name}'s account deleted`);
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Name or phone number" />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Type</th>
              <th className="num">Orders</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items?.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {u.suspendReason && <div className="small error">Suspended: {u.suspendReason}</div>}
                </td>
                <td>{u.phone}</td>
                <td>
                  {u.role ? (
                    <strong>{u.role === 'owner' ? 'Owner' : 'Staff'}</strong>
                  ) : u.shopId ? (
                    <Link to={`/store/${u.shopId}`}>Shop owner</Link>
                  ) : (
                    u.accountType
                  )}
                </td>
                <td className="num">{u.orderCount}</td>
                <td>
                  <div className="row-actions">
                    {u.id !== user.id &&
                      (u.suspended ? (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => run(() => api.admin.suspendUser(u.id, false), 'Account restored')}
                        >
                          Restore
                        </button>
                      ) : (
                        <ReasonButton
                          label="Suspend"
                          danger
                          onConfirm={(reason) =>
                            run(() => api.admin.suspendUser(u.id, true, reason), 'Account suspended')
                          }
                        />
                      ))}
                    {canDelete && u.id !== user.id && !u.role && !u.shopId && (
                      <ReasonButton
                        label="Delete account"
                        placeholder="Why? This can't be undone"
                        danger
                        onConfirm={(reason) => remove(u, reason)}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Orders() {
  const [q, setQ] = useState('');
  const { items, run } = useAdminList(() => api.admin.orders({ q }), [q]);
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Order number, buyer name or phone" />
      <div className="orders">
        {items?.map((o) => (
          <div key={o.id} className="card order">
            <div className="order-head">
              <strong>{o.id}</strong>
              <span className="muted small">
                {date(o.date)} · {o.buyer.name} {o.buyer.phone} · {o.payment} ·{' '}
                {o.paid ? 'paid' : o.payByMomo ? 'waiting for payment' : 'pay on delivery'}
              </span>
              <strong>{formatK(o.total)}</strong>
            </div>
            {o.shipments.map((s) => (
              <div key={s.shopId} className="order-shipment small">
                <strong>{s.shopName}</strong> · {s.status} · {s.courierName}
                {o.payByMomo && s.status === 'pending' && (s.paid ? ' · paid' : s.paymentSentAt ? ' · buyer says paid' : ' · not paid yet')}
                {s.tracking && ` · ${s.tracking}`}
                {s.cancelReason && (
                  <span className="muted">
                    {' '}
                    · cancelled by {s.cancelledBy}: {s.cancelReason}
                  </span>
                )}
                {['pending', 'dispatched'].includes(s.status) && (
                  <div className="pdp-buttons">
                    <ParcelControls orderId={o.id} shipment={s} payByMomo={o.payByMomo} run={run} />
                    <ReasonButton
                      label="Cancel parcel"
                      danger
                      onConfirm={(reason) =>
                        run(() => api.admin.cancelShipment(o.id, s.shopId, reason), 'Parcel cancelled')
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {items?.length === 0 && <p className="muted">No orders match.</p>}
      </div>
    </>
  );
}

function Disputes() {
  const [status, setStatus] = useState('escalated');
  const { items, run } = useAdminList(() => api.admin.cases({ status }), [status]);
  const [amounts, setAmounts] = useState({});
  return (
    <>
      <div className="admin-filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="escalated">Escalated to us</option>
          <option value="open">Waiting for shops</option>
          <option value="">All</option>
        </select>
      </div>
      {items?.length === 0 && <p className="muted">Nothing here.</p>}
      <div className="orders">
        {items?.map((c) => (
          <div key={c.id} className="card order">
            <div className="order-head">
              <strong>
                <Link to={`/cases/${c.id}`}>{c.kind === 'return' ? 'Return' : 'Missing parcel'}</Link>:{' '}
                {c.reason.replace('_', ' ')}
              </strong>
              <span className="muted small">
                {c.orderId} · {c.buyerName} vs {c.shopName} · {date(c.date)}
              </span>
              <span className="status">{CASE_STATUS[c.status]}</span>
            </div>
            {c.events.map((e, i) => (
              <div key={i} className="small">
                <strong>{e.by}</strong> {e.action}
                {e.note && `: “${e.note}”`}
              </div>
            ))}
            {['open', 'rejected', 'escalated'].includes(c.status) && (
              <div className="pdp-buttons">
                <input
                  type="number"
                  min="0"
                  max={c.refundableLeft}
                  placeholder={`Refund up to ${formatK(c.refundableLeft)}`}
                  value={amounts[c.id] ?? ''}
                  onChange={(e) => setAmounts((a) => ({ ...a, [c.id]: e.target.value }))}
                  aria-label="Refund amount"
                  className="amount-input"
                />
                <ReasonButton
                  label="Refund buyer"
                  placeholder="Decision note (shown to both)"
                  onConfirm={(note) =>
                    run(
                      () =>
                        api.admin.decideCase(c.id, {
                          outcome: 'refund',
                          note,
                          ...(amounts[c.id] ? { refundAmount: amounts[c.id] } : {}),
                        }),
                      'Refund decided',
                    )
                  }
                />
                <ReasonButton
                  label="Side with shop"
                  placeholder="Decision note (shown to both)"
                  onConfirm={(note) =>
                    run(() => api.admin.decideCase(c.id, { outcome: 'reject', note }), 'Case closed')
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Refunds() {
  const [status, setStatus] = useState('due');
  const { items, run } = useAdminList(() => api.admin.refunds({ status }), [status]);
  return (
    <>
      <div className="admin-filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="due">To pay</option>
          <option value="paid">Paid</option>
          <option value="">All</option>
        </select>
      </div>
      <p className="muted small">
        Buyers pay shops directly (Mobile Money or cash), so the shop holds the money: ask the shop to send it back to
        the buyer, then record the transaction reference here. Refunds marked "Zed Market pays" are sent by you.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Order</th>
              <th>Why</th>
              <th className="num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items?.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.buyerName}
                  <div className="small muted">
                    {r.buyerPhone} · paid by {r.paymentMethod}
                  </div>
                  <div className="small muted">
                    {r.heldByShop ? `Money is with the shop (${r.shopPhone})` : 'Zed Market pays'}
                  </div>
                </td>
                <td>
                  {r.orderId}
                  <div className="small muted">{r.shopName}</div>
                </td>
                <td>{r.reason === 'cancelled' ? 'Cancelled parcel' : 'Return / dispute'}</td>
                <td className="num">{formatK(r.amount)}</td>
                <td>
                  {r.status === 'paid' ? (
                    <span className="small">Ref. {r.reference}</span>
                  ) : (
                    <ReasonButton
                      label="Mark paid"
                      placeholder="MoMo / bank reference"
                      onConfirm={(reference) =>
                        run(() => api.admin.markRefundPaid(r.id, reference), 'Refund recorded as paid')
                      }
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Activity() {
  const { items } = useAdminList(() => api.admin.actions(), []);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {items?.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.date).toLocaleString('en-ZM', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td>{a.admin}</td>
              <td>
                {a.action}{' '}
                <span className="muted small">
                  ({a.targetType} {a.targetId})
                </span>
              </td>
              <td>{a.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Customer support inbox: questions from buyers and shop owners.
function Support() {
  const [status, setStatus] = useState('open');
  const { items, run } = useAdminList(() => api.adminSupport.list(status), { status });
  const [openId, setOpenId] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [draft, setDraft] = useState('');

  const show = async (id) => {
    setOpenId(id);
    setTicket(null);
    setTicket(await api.adminSupport.get(id));
  };
  const reply = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (await run(() => api.adminSupport.reply(openId, draft), 'Reply sent')) {
      setDraft('');
      show(openId);
    }
  };

  return (
    <div className="admin-split">
      <div>
        <div className="admin-filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="">All</option>
          </select>
        </div>
        {items === null ? (
          <p className="muted">Loading…</p>
        ) : items.length ? (
          <ul className="admin-list">
            {items.map((t) => (
              <li key={t.id}>
                <button className={`admin-row ${openId === t.id ? 'on' : ''}`} onClick={() => show(t.id)}>
                  <strong className="grow">{t.subject}</strong>
                  {t.unread > 0 && <span className="badge-inline">{t.unread}</span>}
                  <span className="small muted block">
                    {t.userName} · {t.userPhone} · {date(t.lastMessageAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No {status} questions.</p>
        )}
      </div>
      {openId && (
        <section className="card form-card">
          {ticket ? (
            <>
              <div className="order-head">
                <h3>{ticket.subject}</h3>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={async () => {
                    const next = ticket.status === 'open' ? 'closed' : 'open';
                    if (await run(() => api.adminSupport.setStatus(ticket.id, next), `Marked ${next}`)) show(ticket.id);
                  }}
                >
                  {ticket.status === 'open' ? 'Close ticket' : 'Reopen'}
                </button>
              </div>
              <p className="small muted">
                {ticket.userName} · {ticket.userPhone}
                {ticket.orderId && (
                  <>
                    {' '}
                    · order <strong>{ticket.orderId}</strong>
                  </>
                )}
              </p>
              <div className="bubbles support-bubbles">
                {ticket.messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.fromStaff ? 'mine' : 'theirs'}`}>
                    <strong className="small block">{m.author}</strong>
                    <p>{m.body}</p>
                    <span className="bubble-time">{date(m.date)}</span>
                  </div>
                ))}
              </div>
              <form className="composer" onSubmit={reply}>
                <textarea rows="2" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Reply" placeholder="Reply as Zed Market…" />
                <button className="btn btn-primary">Send</button>
              </form>
            </>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </section>
      )}
    </div>
  );
}

// The admin sections, grouped for the side menu. On phones the groups become one row that scrolls sideways.
const GROUPS = [
  [
    null,
    [
      ['overview', 'Overview', Overview],
      ['analytics', 'Analytics', Analytics],
    ],
  ],
  [
    'Marketplace',
    [
      ['shops', 'Shops', Shops],
      ['products', 'Listings', Listings],
      ['reviews', 'Reviews', Reviews],
      ['users', 'Users', Users],
      ['requests', 'Buying requests', RequestModeration],
    ],
  ],
  [
    'Orders & money',
    [
      ['orders', 'Orders', Orders],
      ['cases', 'Disputes', Disputes],
      ['refunds', 'Refunds', Refunds],
      ['payouts', 'Payouts', Payouts],
      ['delivery', 'Delivery', DeliverySettings],
    ],
  ],
  [
    'Growth',
    [
      ['marketing', 'Marketing', Marketing],
      ['qr', 'QR codes', QrCodes],
    ],
  ],
  [
    'Team & setup',
    [
      ['support', 'Support', Support],
      ['staff', 'Staff', Staff],
      ['settings', 'Settings', Settings],
      ['activity', 'Activity log', Activity],
    ],
  ],
];
const TABS = GROUPS.flatMap(([, tabs]) => tabs);

export default function Admin() {
  const { user, authReady } = useStore();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  // On phones the current section is scrolled into view in the row of tabs.
  if (!authReady) return null;
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (!user.isAdmin) {
    return <div className="container section card empty">This page is for Zed Market staff.</div>;
  }
  const [, label, Panel] = TABS.find(([id]) => id === tab) ?? TABS[0];
  const go = (id) => setParams({ tab: id });
  return (
    <div className="container section admin">
      <div className="admin-head">
        <h1>Admin</h1>
        <span className="muted small">
          Zed Market {user.staffRole === 'owner' ? 'owner' : 'staff'} · {user.name}
        </span>
      </div>
      <div className="dash-layout">
        <SideNav groups={GROUPS} current={tab} onSelect={go} label="Admin sections" />
        <section className="dash-main" aria-label={label}>
          <h2 className="dash-title">{label}</h2>
          <Panel go={go} />
        </section>
      </div>
    </div>
  );
}
