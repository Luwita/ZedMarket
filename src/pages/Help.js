import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as api from '../api';
import { useStore } from '../context/StoreContext';

const FAQ = [
  ['How do I pay?', "By Mobile Money (MTN, Airtel or Zamtel) sent to the shop's number, which you get after placing your order, or cash on delivery with some couriers. Tap \"I've paid\" after sending; the shop sends your parcel once the money arrives."],
  ['When will my order arrive?', 'Each shop sends its own parcel. You see the courier and expected time at checkout, and get a notification when it is sent, with the tracking number.'],
  ['Can I collect my parcel?', 'Yes: collect from the shop, from the bus station (bus parcels), or from a Zed Market Point in your town.'],
  ['Something is wrong with my order', 'Open the order in My account and choose "Report a problem" within 7 days of delivery. If the shop does not help, ask Zed Market to step in.'],
  ['How do I cancel?', 'Until a parcel is sent, open the order in My account and choose "Cancel this parcel". If you already paid, the shop sends your money back.'],
  ['How do I sell on Zed Market?', 'Choose "Open a shop", fill in your details and we review your shop, usually within 2 working days. You can add products straight away.'],
  ['How do vouchers work?', 'Invite friends with your code (My account → Invite & vouchers). They get a voucher when they join, and you get one when their first order arrives.'],
];

function Thread({ id }) {
  const { refreshUnread } = useStore();
  const [ticket, setTicket] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const load = useCallback(
    () =>
      api
        .supportTicket(id)
        .then((t) => {
          setTicket(t);
          refreshUnread();
        })
        .catch((err) => setError(err.message)),
    [id, refreshUnread]
  );
  useEffect(() => {
    load();
  }, [load]);

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      await api.replySupport(id, draft);
      setDraft('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!ticket) return <p className="muted">Loading…</p>;
  return (
    <section className="card form-card">
      <Link to="/help" className="link small">
        ← All questions
      </Link>
      <h2>{ticket.subject}</h2>
      <div className="bubbles support-bubbles">
        {ticket.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.fromStaff ? 'theirs' : 'mine'}`}>
            {m.fromStaff && <strong className="small block">{m.author}</strong>}
            <p>{m.body}</p>
            <span className="bubble-time">{new Date(m.date).toLocaleString('en-ZM', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
        ))}
      </div>
      <form className="composer" onSubmit={send}>
        <textarea rows="2" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Message" placeholder="Write a reply…" />
        <button className="btn btn-primary">Send</button>
      </form>
    </section>
  );
}

export default function Help() {
  const { id } = useParams();
  const { user } = useStore();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState({ subject: '', body: '' });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user) api.supportTickets().then(setTickets).catch(() => {});
  }, [user, id]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const { id: created } = await api.openSupportTicket(form);
      setForm({ subject: '', body: '' });
      navigate(`/help/${created}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="container section narrow">
      <h1>Help &amp; support</h1>
      {id ? (
        <Thread id={id} />
      ) : (
        <>
          <section className="card form-card">
            <h2>Quick answers</h2>
            {FAQ.map(([q, a]) => (
              <details key={q} className="faq">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </section>

          <section className="card form-card">
            <h2>Ask Zed Market</h2>
            {user ? (
              <form onSubmit={submit}>
                <div className="field">
                  <label htmlFor="sp-subject">What is it about?</label>
                  <input id="sp-subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="e.g. My parcel has not arrived" />
                </div>
                <div className="field">
                  <label htmlFor="sp-body">Your message</label>
                  <textarea id="sp-body" rows="4" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="Include your order number if it is about an order" />
                </div>
                {error && <p className="error">{error}</p>}
                <button className="btn btn-primary">Send to Zed Market</button>
                <p className="muted small">Our team replies in your notifications, usually the same working day.</p>
              </form>
            ) : (
              <p className="help-contact">
                <Link to="/login?next=/help" className="btn btn-primary">
                  Sign in to message us
                </Link>{' '}
                <span className="muted">or call +260 211 000 000</span>
              </p>
            )}
          </section>

          {tickets.length > 0 && (
            <section className="card form-card">
              <h2>Your questions</h2>
              <ul className="low-stock">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link to={`/help/${t.id}`} className="grow">
                      {t.subject}
                    </Link>
                    <span className="muted small">{t.status === 'closed' ? 'Closed' : 'Open'}</span>
                    {t.unread > 0 && <span className="badge-inline">{t.unread}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
