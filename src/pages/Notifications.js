import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import * as api from '../api';
import Icon from '../components/Icon';
import { useStore } from '../context/StoreContext';

// Line icons (components/Icon) for each kind of notification.
const ICON = {
  order: 'box',
  cancelled: 'box',
  case: 'box',
  quote: 'tag',
  offer: 'tag',
  shop: 'store',
  listing: 'store',
  refund: 'wallet',
  support: 'support',
  voucher: 'tag',
  payout: 'wallet',
  announcement: 'bell',
};

const when = (d) =>
  new Date(d).toLocaleString('en-ZM', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Notifications() {
  const { user, authReady, refreshUnread } = useStore();
  const navigate = useNavigate();
  const [list, setList] = useState(null);

  useEffect(() => {
    if (!user) return;
    api
      .notifications()
      .then(setList)
      .catch(() => setList([]));
  }, [user]);

  if (!authReady) return null;
  if (!user) return <Navigate to="/login?next=/notifications" replace />;

  const open = async (n) => {
    if (!n.read) {
      await api.markNotificationsRead([n.id]).catch(() => {});
      refreshUnread();
    }
    if (n.link) navigate(n.link);
    else setList((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
  };
  const readAll = async () => {
    await api.markNotificationsRead();
    setList((l) => l.map((x) => ({ ...x, read: true })));
    refreshUnread();
  };

  return (
    <div className="container section narrow">
      <div className="account-head">
        <h1>Notifications</h1>
        {list?.some((n) => !n.read) && (
          <button className="link-btn" onClick={readAll}>
            Mark all as read
          </button>
        )}
      </div>
      {list === null ? (
        <p className="muted">Loading…</p>
      ) : list.length ? (
        <ul className="notification-list card">
          {list.map((n) => (
            <li key={n.id}>
              <button className={`notification ${n.read ? '' : 'unread'}`} onClick={() => open(n)}>
                <span className="notification-icon">
                  <Icon name={ICON[n.kind] ?? 'bell'} size={18} />
                </span>
                <span className="grow">
                  <strong>{n.title}</strong>
                  {n.body && <span className="block small muted">{n.body}</span>}
                  <span className="block small muted">{when(n.date)}</span>
                </span>
                {!n.read && <span className="dot" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card empty">
          <p>Nothing yet. Updates about your orders, shop and messages appear here.</p>
          <Link to="/shop" className="btn btn-primary">
            Start shopping
          </Link>
        </div>
      )}
    </div>
  );
}
