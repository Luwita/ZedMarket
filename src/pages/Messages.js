import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import * as api from '../api';
import { useStore } from '../context/StoreContext';

const THREAD_REFRESH_MS = 8000;

const when = (date) => {
  const d = new Date(date);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-ZM', { day: 'numeric', month: 'short' });
};

function Thread({ id, onChange }) {
  const { refreshUnread } = useStore();
  const [thread, setThread] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef(null);

  const load = useCallback(
    () =>
      api
        .getConversation(id)
        .then((t) => {
          setThread(t);
          refreshUnread();
        })
        .catch((err) => setError(err.message)),
    [id, refreshUnread],
  );

  useEffect(() => {
    setThread(null);
    load();
    // Simple polling keeps the conversation fresh without a live connection.
    const t = setInterval(() => document.visibilityState !== 'hidden' && load(), THREAD_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const count = thread?.messages.length;
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.sendMessage(id, draft);
      setDraft('');
      await load();
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (error && !thread) return <div className="thread empty muted">{error}</div>;
  if (!thread) return <div className="thread empty muted">Loading…</div>;

  return (
    <div className="thread">
      <div className="thread-head">
        <Link to="/messages" className="thread-back" aria-label="Back to conversations">
          ←
        </Link>
        <div>
          <strong>{thread.withName}</strong>
          {thread.productId && (
            <div className="small muted">
              About <Link to={`/product/${thread.productId}`}>{thread.productName}</Link>
            </div>
          )}
        </div>
        {thread.role === 'buyer' && (
          <Link to={`/store/${thread.shopId}`} className="link small">
            Visit shop
          </Link>
        )}
      </div>
      <div className="bubbles">
        {thread.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.from === thread.role ? 'mine' : 'theirs'}`}>
            <p>{m.body}</p>
            <span className="bubble-time">{when(m.date)}</span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <p className="safety-note">Pay through Zed Market checkout so your money is protected until delivery.</p>
      <form className="composer" onSubmit={send}>
        <textarea
          rows="2"
          placeholder="Write a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          aria-label="Message"
        />
        <button className="btn btn-primary" disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

export default function Messages() {
  const { id } = useParams();
  const { user, authReady } = useStore();
  const [list, setList] = useState(null);

  const loadList = useCallback(() => {
    api
      .listConversations()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  useEffect(() => {
    if (user) loadList();
  }, [user, id, loadList]);

  if (!authReady) return null;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(id ? `/messages/${id}` : '/messages')}`} replace />;

  return (
    <div className="container section">
      <h1>Messages</h1>
      {list?.length === 0 && !id ? (
        <div className="card empty">
          <div className="empty-icon">💬</div>
          <h3>No messages yet</h3>
          <p className="muted">Use "Ask the shop" on any product to ask about sizes, stock or delivery.</p>
          <Link to="/shop" className="btn btn-primary">
            Browse products
          </Link>
        </div>
      ) : (
        <div className={`messages-layout ${id ? 'has-thread' : ''}`}>
          <aside className="card conversation-list">
            {list === null ? (
              <p className="muted small pad">Loading…</p>
            ) : list.length ? (
              list.map((c) => (
                <Link key={c.id} to={`/messages/${c.id}`} className={`conversation ${c.id === id ? 'on' : ''}`}>
                  <span className="conversation-top">
                    <strong>{c.withName}</strong>
                    <span className="muted small">{when(c.lastMessageAt)}</span>
                  </span>
                  <span className="small muted">
                    {c.role === 'seller' ? 'Customer · ' : ''}
                    {c.productName ?? ''}
                  </span>
                  <span className="conversation-last">
                    <span className="ellipsis">{c.lastMessage}</span>
                    {c.unread > 0 && <span className="badge-inline">{c.unread}</span>}
                  </span>
                </Link>
              ))
            ) : (
              <p className="muted small pad">
                No messages yet. Use "Ask the shop" on any product to ask about sizes, stock or delivery.
              </p>
            )}
          </aside>
          <section className="card thread-wrap">
            {id ? (
              <Thread id={id} onChange={loadList} />
            ) : (
              <div className="thread empty muted">Choose a conversation.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
