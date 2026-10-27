import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as api from '../api';
import { useStore } from '../context/StoreContext';

// "Ask the shop" button that opens a message box and starts (or continues) a conversation.
export default function AskShop({ shop, product, label = 'Ask the shop' }) {
  const { user, myShop } = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(product ? `Hi, I'm interested in the ${product.name}. ` : '');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  if (myShop?.id === shop.id) return null;
  if (!user) {
    return (
      <Link to={`/login?next=${encodeURIComponent(pathname)}`} className="btn btn-outline">
        {label}
      </Link>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const { id } = await api.startConversation({ shopId: shop.id, productId: product?.id, body });
      navigate(`/messages/${id}`);
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return (
    <form className="ask-shop card" onSubmit={send}>
      <label htmlFor="ask-body">Message {shop.name}</label>
      <textarea id="ask-body" rows="3" value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
      <p className="muted small">
        🔒 Order through checkout before you pay. Zed Market can only help with orders placed here.
      </p>
      {error && <span className="error">{error}</span>}
      <div className="pdp-buttons">
        <button className="btn btn-primary btn-sm" disabled={sending || !body.trim()}>
          {sending ? 'Sending…' : 'Send message'}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
