import { useState } from 'react';
import { useStore } from '../context/StoreContext';

// Share a page: the phone's own share sheet when available, otherwise WhatsApp, Facebook or copy link.
export default function ShareButton({ title, text = '', path, label = 'Share' }) {
  const { notify } = useStore();
  const [open, setOpen] = useState(false);
  const url = `${window.location.origin}${path ?? window.location.pathname}`;
  const message = `${text ? `${text} ` : ''}${url}`;

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    setOpen((o) => !o);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify('Link copied');
    } catch {
      notify(url);
    }
    setOpen(false);
  };

  return (
    <span className="share">
      <button type="button" className="btn btn-outline" onClick={share}>
        {label}
      </button>
      {open && (
        <span className="share-menu card" role="menu">
          <a role="menuitem" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
            💬 WhatsApp
          </a>
          <a
            role="menuitem"
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noreferrer"
          >
            📘 Facebook
          </a>
          <button role="menuitem" type="button" onClick={copy}>
            🔗 Copy link
          </button>
        </span>
      )}
    </span>
  );
}
