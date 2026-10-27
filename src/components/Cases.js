import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { compressImage } from '../utils/image';
import { formatK } from '../utils/format';
import { CASE_STATUS } from './ShipmentStatus';

export const RETURN_DAYS = 7;

const REASONS = {
  damaged: 'Arrived damaged',
  faulty: "Faulty / doesn't work",
  wrong_item: 'Wrong item sent',
  missing_items: 'Items missing from the parcel',
  not_as_described: 'Not as described',
  other: 'Something else',
  not_received: "Parcel didn't arrive",
};

const CANCEL_REASONS = {
  buyer: ['Ordered by mistake', 'Found it cheaper elsewhere', 'Delivery takes too long', 'Changed my mind'],
  seller: ['Out of stock', 'Cannot deliver to this town', 'Price or listing was wrong', 'Buyer asked to cancel'],
};

const date = (d) => new Date(d).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' });

// Cancel a parcel that hasn't been sent. `role` is 'buyer' or 'seller'.
export function CancelParcel({ orderId, shopId, role, paid, sent }) {
  const { reloadOrders, notify } = useStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(CANCEL_REASONS[role][0]);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        Cancel {role === 'buyer' ? 'this parcel' : 'order'}
      </button>
    );
  }
  const confirm = async () => {
    setBusy(true);
    try {
      const { refund } = await api.cancelShipment(orderId, shopId, reason);
      notify(refund ? `Cancelled. A refund of ${formatK(refund)} is on its way.` : 'Cancelled');
      await reloadOrders();
    } catch (err) {
      notify(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="cancel-box">
      <label htmlFor={`cancel-${orderId}-${shopId}`}>Why are you cancelling?</label>
      <select id={`cancel-${orderId}-${shopId}`} value={reason} onChange={(e) => setReason(e.target.value)}>
        {CANCEL_REASONS[role].map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <p className="muted small">
        {role === 'buyer'
          ? paid
            ? 'Your payment for this parcel will be refunded.'
            : sent
              ? "The shop hasn't confirmed your payment. If your money reached them, ask the shop to send it back, or contact Zed Market support."
              : 'Nothing has been paid for this parcel.'
          : 'The stock goes back on sale and the buyer is refunded if they paid.'}
      </p>
      <div className="pdp-buttons">
        <button className="btn btn-danger btn-sm" disabled={busy} onClick={confirm}>
          {busy ? 'Cancelling…' : 'Yes, cancel'}
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setOpen(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}

// Buyer: report a problem with a parcel (return, or never arrived).
export function ReportProblem({ order, shipment }) {
  const { reloadOrders, notify } = useStore();
  const delivered = shipment.status === 'delivered';
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(delivered ? 'return' : 'not_received');
  const [reason, setReason] = useState(delivered ? 'damaged' : 'not_received');
  const [qty, setQty] = useState(() => Object.fromEntries(shipment.items.map((i) => [`${i.id}|${i.options}`, 0])));
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        Report a problem
      </button>
    );
  }

  const addPhotos = async (e) => {
    const files = [...e.target.files].slice(0, 4 - photos.length);
    e.target.value = '';
    try {
      const urls = [];
      for (const f of files) urls.push((await api.uploadImage(await compressImage(f))).url);
      setPhotos((p) => [...p, ...urls]);
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Same product in different sizes is one product here; quantities add up.
    const items = Object.entries(qty)
      .filter(([, n]) => n > 0)
      .reduce((list, [key, n]) => {
        const productId = key.split('|')[0];
        const found = list.find((i) => i.productId === productId);
        if (found) found.qty += n;
        else list.push({ productId, qty: n });
        return list;
      }, []);
    try {
      const created = await api.openCase({
        orderId: order.id,
        shopId: shipment.shopId,
        kind,
        reason: kind === 'not_received' ? 'not_received' : reason,
        description,
        items: kind === 'return' ? items : [],
        photos,
      });
      notify('Sent to the shop. They have 3 days to reply.');
      await reloadOrders();
      setOpen(false);
      return created;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="case-form card" onSubmit={submit}>
      <strong>What went wrong?</strong>
      {delivered && (
        <div className="scope-bar">
          <button type="button" className={kind === 'return' ? 'on' : ''} onClick={() => setKind('return')}>
            Problem with an item
          </button>
          <button type="button" className={kind === 'not_received' ? 'on' : ''} onClick={() => setKind('not_received')}>
            I didn't get my parcel
          </button>
        </div>
      )}
      {kind === 'return' && (
        <>
          <div className="field">
            <label htmlFor={`reason-${shipment.id}`}>Reason</label>
            <select id={`reason-${shipment.id}`} value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(REASONS)
                .filter(([id]) => id !== 'not_received')
                .map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Which items?</span>
            {shipment.items.map((i) => {
              const key = `${i.id}|${i.options}`;
              return (
                <label key={key} className="item-pick">
                  <input
                    type="number"
                    min="0"
                    max={i.qty}
                    value={qty[key]}
                    onChange={(e) =>
                      setQty((q) => ({ ...q, [key]: Math.max(0, Math.min(i.qty, Number(e.target.value) || 0)) }))
                    }
                    aria-label={`How many ${i.name}`}
                  />
                  <span>
                    of {i.qty} × {i.name}
                    {i.options && <span className="muted"> ({i.options})</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor={`desc-${shipment.id}`}>Tell the shop more</label>
        <textarea
          id={`desc-${shipment.id}`}
          rows="3"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            kind === 'return'
              ? 'e.g. The fan stops after 10 minutes'
              : 'e.g. The courier says it was delivered but I have nothing'
          }
        />
      </div>
      {kind === 'return' && (
        <div className="upload-grid">
          {photos.map((src) => (
            <div key={src} className="upload-thumb">
              <img src={src} alt="Evidence" />
            </div>
          ))}
          {photos.length < 4 && (
            <label className="upload-add">
              <input type="file" accept="image/*" multiple onChange={addPhotos} hidden />
              Add photos
            </label>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="pdp-buttons">
        <button className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Sending…' : 'Send to the shop'}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="muted small">
        Keep the item and its packaging. If the shop doesn't help, you can ask Zed Market to step in. See our{' '}
        <Link to="/legal/returns">returns policy</Link>.
      </p>
    </form>
  );
}

function ShopResponse({ c, onDone }) {
  const [resolution, setResolution] = useState('refund');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const respond = async (body) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.respondToCase(c.id, body));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="respond-form">
      <strong>Your answer</strong>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="resolution">If you accept</label>
          <select id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
            <option value="refund">Refund the buyer</option>
            <option value="replacement">Send a replacement</option>
            <option value="repair">Repair it</option>
          </select>
        </div>
        {resolution === 'refund' && (
          <div className="field">
            <label htmlFor="refund-amount">Refund amount (K, blank = full parcel)</label>
            <input
              id="refund-amount"
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        )}
      </div>
      <input
        placeholder="Message to the buyer"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Message to the buyer"
      />
      {error && <p className="error">{error}</p>}
      <div className="pdp-buttons">
        <button
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => respond({ accept: true, resolution, note, ...(amount ? { refundAmount: amount } : {}) })}
        >
          Accept
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => respond({ accept: false, note })}>
          Reject
        </button>
      </div>
    </div>
  );
}

const ACTOR = { buyer: 'Buyer', shop: 'Shop', staff: 'Zed Market' };

// Full case: details, photos, timeline and the actions open to whoever is looking.
export function CaseDetail({ id }) {
  const { user } = useStore();
  const [c, setCase] = useState(null);
  const [role, setRole] = useState(null); // 'buyer', 'shop' or 'staff', decided by the server
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api
      .getCase(id)
      .then((found) => {
        setRole(found.viewerRole);
        setCase(found);
      })
      .catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!c) return <p className="muted">Loading…</p>;
  const isBuyer = role === 'buyer';
  const isShop = role === 'shop';
  const act = async (fn) => {
    try {
      setCase(await fn());
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <article className="card form-card case-detail">
      <div className="order-head">
        <h2>
          {c.kind === 'return' ? 'Return' : 'Missing parcel'}: {REASONS[c.reason]}
        </h2>
        <span className={`status case-${c.status}`}>{CASE_STATUS[c.status]}</span>
      </div>
      <p className="muted small">
        Order {c.orderId} · {c.shopName} · {c.buyerName} · opened {date(c.date)}
      </p>
      {c.items.length > 0 && (
        <ul className="small">
          {c.items.map((i) => (
            <li key={i.productId}>
              {i.qty} × {i.name}
            </li>
          ))}
        </ul>
      )}
      {c.photos.length > 0 && (
        <div className="upload-grid">
          {c.photos.map((src) => (
            <a key={src} href={src} target="_blank" rel="noreferrer" className="upload-thumb">
              <img src={src} alt="Evidence from the buyer" />
            </a>
          ))}
        </div>
      )}
      {c.refundAmount && <p className="quote-offer">Refund of {formatK(c.refundAmount)} to the buyer</p>}

      <ol className="timeline">
        {c.events.map((e, i) => (
          <li key={i}>
            <strong>{ACTOR[e.by]}</strong> {e.action}
            <span className="muted small"> · {date(e.at)}</span>
            {e.note && <div>“{e.note}”</div>}
          </li>
        ))}
      </ol>

      {isShop && c.status === 'open' && <ShopResponse c={c} onDone={setCase} />}

      {isBuyer && ['open', 'rejected', 'escalated'].includes(c.status) && (
        <div className="respond-form">
          {c.canEscalate && (
            <>
              <input
                placeholder="Anything Zed Market should know?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Note for Zed Market"
              />
              <button className="btn btn-primary btn-sm" onClick={() => act(() => api.escalateCase(c.id, note))}>
                Ask Zed Market to step in
              </button>
            </>
          )}
          {c.status === 'open' && !c.canEscalate && (
            <p className="muted small">The shop has 3 days to reply. After that you can ask Zed Market to step in.</p>
          )}
          {c.status === 'escalated' && <p className="muted small">Our team will review this and contact you.</p>}
          <button className="link-btn" onClick={() => act(() => api.withdrawCase(c.id))}>
            Withdraw (problem solved)
          </button>
        </div>
      )}
      {user?.isAdmin && ['open', 'rejected', 'escalated'].includes(c.status) && (
        <Link to="/admin?tab=cases" className="link">
          Decide this case in the admin panel →
        </Link>
      )}
    </article>
  );
}

// Seller dashboard: the shop's returns and missing-parcel reports.
export function ShopCases() {
  const { notify } = useStore();
  const [list, setList] = useState(null);
  useEffect(() => {
    api
      .shopCases()
      .then(setList)
      .catch((err) => notify(err.message));
  }, [notify]);

  if (!list) return <p className="muted">Loading…</p>;
  if (!list.length) return <div className="card empty">No returns or problems reported.</div>;
  return (
    <div className="orders">
      {list.map((c) => (
        <Link key={c.id} to={`/cases/${c.id}`} className="card order case-row">
          <div className="order-head">
            <strong>
              {c.kind === 'return' ? 'Return:' : 'Missing parcel:'} {REASONS[c.reason]}
            </strong>
            <span className="muted small">
              {c.orderId} · {c.buyerName} · {date(c.date)}
            </span>
            <span className={`status case-${c.status}`}>{CASE_STATUS[c.status]}</span>
          </div>
          {c.description && <div className="small">“{c.description}”</div>}
        </Link>
      ))}
    </div>
  );
}
