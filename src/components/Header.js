import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { categories } from '../data/catalog';
import { getProvince } from '../data/zambia';
import { useStore } from '../context/StoreContext';
import { useIsPhone } from '../phone';
import Icon from './Icon';
import LocationFields from './LocationFields';

function LocationButton() {
  const { location, setLocation } = useStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(location);

  return (
    <div className="loc-wrap">
      <button
        className="loc-btn"
        onClick={() => {
          setDraft(location);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
      >
        <span className="loc-label">Deliver to</span>
        <strong>
          <Icon name="pin" size={16} />
          {location.town}
        </strong>
      </button>
      {open && (
        <>
          <div className="backdrop" onClick={() => setOpen(false)} />
          <div className="card loc-pop">
            <h4>Where are you?</h4>
            <p className="muted small">We'll show shops near you first and delivery prices to your town.</p>
            <LocationFields value={draft} onChange={setDraft} idPrefix="hdr" />
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                setLocation(draft);
                setOpen(false);
              }}
            >
              Save location
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Screens opened from a bottom tab: they show the logo; every other screen shows a back arrow.
const TAB_ROOTS = ['/', '/categories', '/messages', '/cart', '/account', '/login'];

// Phone layout: one row with search and alerts. The other sections are in the bottom tab bar.
function AppHeader({ query, setQuery, onSearch }) {
  const { user, notificationCount } = useStore();
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  const root = TAB_ROOTS.includes(pathname);

  // The search box shows what is being searched; away from the results it is empty again.
  useEffect(() => {
    if (pathname !== '/shop' && pathname !== '/wholesale') setQuery('');
  }, [pathname, setQuery]);

  return (
    <header className="site-header app-header">
      <div className="container app-bar">
        {root ? (
          <Link to="/" className="logo" aria-label="Zed Market home">
            <span className="logo-mark">Z</span>
          </Link>
        ) : (
          // Opened straight from a link (no page to go back to): go home instead.
          <button className="icon-btn back-btn" aria-label="Back" onClick={() => (key === 'default' ? navigate('/') : navigate(-1))}>
            <Icon name="back" />
          </button>
        )}
        <form className="search" onSubmit={onSearch} role="search">
          <Icon name="search" size={20} />
          <input
            type="search"
            enterKeyHint="search"
            placeholder="Search products"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search products"
          />
          <button type="submit">Search</button>
        </form>
        <Link to={user ? '/notifications' : '/login?next=/notifications'} className="action" aria-label="Alerts">
          <Icon name="bell" />
          {notificationCount > 0 && <span className="badge-count">{notificationCount}</span>}
        </Link>
      </div>
      {(pathname === '/' || pathname === '/shop' || pathname === '/categories') && (
        <div className="container app-loc">
          <LocationButton />
        </div>
      )}
    </header>
  );
}

export default function Header() {
  const { cartCount, user, wishlist, location, myShop, unreadMessages, notificationCount, toDispatchCount, canInstall, install } = useStore();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const phone = useIsPhone();

  const onSearch = (e) => {
    e.preventDefault();
    navigate(query.trim() ? `/shop?q=${encodeURIComponent(query.trim())}` : '/shop');
  };

  if (phone) return <AppHeader query={query} setQuery={setQuery} onSearch={onSearch} />;

  const nearMe = `/shop?prov=${location.province}&town=${encodeURIComponent(location.town)}`;

  return (
    <header className="site-header">
      <div className="topbar">
        <div className="container topbar-inner">
          <span>Local shops in all 10 provinces · Pay in Kwacha · Delivered by Zambian couriers</span>
          <span className="topbar-links">
            {user?.isAdmin ? (
              <Link to="/admin">Admin panel</Link>
            ) : myShop ? (
              <Link to="/seller">My shop dashboard</Link>
            ) : (
              <Link to="/sell">Open a shop</Link>
            )}
            <Link to="/delivery">Delivery & couriers</Link>
            {canInstall && (
              <button className="link-btn topbar-btn" onClick={install}>
                Install app
              </button>
            )}
            <Link to="/help">Help & support</Link>
          </span>
        </div>
      </div>

      <div className="container header-main">
        <button className="icon-btn menu-btn" aria-label="Categories" onClick={() => setMenuOpen((o) => !o)}>
          ☰
        </button>
        <Link to="/" className="logo" aria-label="Zed Market home">
          <span className="logo-mark">Z</span>
          <span className="logo-text">
            zed<strong>market</strong>
          </span>
        </Link>

        <LocationButton />

        <form className="search" onSubmit={onSearch} role="search">
          <input
            type="search"
            placeholder="Search solar panels, phones, chitenge, roofing sheets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search products"
          />
          <button type="submit">Search</button>
        </form>

        <nav className="header-actions">
          {!user?.isAdmin && (myShop || user?.accountType === 'seller') && (
            <Link to={myShop ? '/seller' : '/sell#register'} className="action">
              <Icon name="store" />
              <span className="action-label">{myShop ? 'My shop' : 'Set up shop'}</span>
              {toDispatchCount > 0 && <span className="badge-count" title="Parcels to send">{toDispatchCount}</span>}
            </Link>
          )}
          {user?.isAdmin && (
            <Link to="/admin" className="action">
              <Icon name="shield" />
              <span className="action-label">Admin</span>
            </Link>
          )}
          {user && (
            <Link to="/messages" className="action">
              <Icon name="chat" />
              <span className="action-label">Messages</span>
              {unreadMessages > 0 && <span className="badge-count">{unreadMessages}</span>}
            </Link>
          )}
          {user && (
            <Link to="/notifications" className="action">
              <Icon name="bell" />
              <span className="action-label">Alerts</span>
              {notificationCount > 0 && <span className="badge-count">{notificationCount}</span>}
            </Link>
          )}
          <Link to={user ? '/account' : '/login'} className="action">
            <Icon name="user" />
            <span className="action-label">{user ? user.name.split(' ')[0] : 'Sign in'}</span>
          </Link>
          <Link to="/account?tab=wishlist" className="action action-saved">
            <Icon name="heart" />
            <span className="action-label">Saved</span>
            {wishlist.length > 0 && <span className="badge-count">{wishlist.length}</span>}
          </Link>
          <Link to="/cart" className="action">
            <Icon name="cart" />
            <span className="action-label">Cart</span>
            {cartCount > 0 && <span className="badge-count">{cartCount}</span>}
          </Link>
        </nav>
      </div>

      <nav className={`catnav ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
        <div className="container catnav-inner">
          <NavLink to="/shop" end>
            All products
          </NavLink>
          <Link to={nearMe}>Near me ({location.town})</Link>
          <Link to={`/shop?prov=${location.province}`}>{getProvince(location.province)?.name} Province</Link>
          <NavLink to="/stores">Shops</NavLink>
          <NavLink to="/wholesale">Wholesale</NavLink>
          <NavLink to="/requests">Buying requests</NavLink>
          <Link to="/shop?sort=deals">Flash deals</Link>
          {categories.map((c) => (
            <Link key={c.id} to={`/shop?cat=${c.id}`}>
              {c.name}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
