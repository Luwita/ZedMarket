import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import ShopForm from '../components/ShopForm';
import { useStore } from '../context/StoreContext';

const steps = [
  {
    n: 1,
    title: 'Apply',
    text: 'Tell us about you and your shop. We review every new shop, usually within 2 working days.',
  },
  {
    n: 2,
    title: 'Upload products',
    text: 'Add photos, prices, stock and wholesale prices from your phone or computer.',
  },
  { n: 3, title: 'Receive orders', text: 'Buyers near you and across Zambia order and pay with Mobile Money or cash.' },
  {
    n: 4,
    title: 'Deliver & get paid',
    text: 'Hand the parcel to Yango, Platinum, a bus or Zampost, or deliver it yourself.',
  },
];

const perks = [
  { icon: 'tag', title: 'Free to join', text: 'No listing fees. Pay a small commission only when you sell.' },
  {
    icon: 'pin',
    title: 'Found by local buyers',
    text: 'Buyers in your town see your shop first, with the lowest delivery costs.',
  },
  {
    icon: 'truck',
    title: 'Use couriers you trust',
    text: 'Yango Delivery, Platinum Couriers, bus parcels, Zampost or your own rider.',
  },
  {
    icon: 'box',
    title: 'Sell retail & wholesale',
    text: 'Set bulk prices so shop owners in other provinces can stock up from you.',
  },
  { icon: 'support', title: 'One-on-one support', text: 'A Zed Market agent helps you list products and get your first sales.' },
  { icon: 'wallet', title: 'Fast payouts', text: 'MTN, Airtel, Zamtel or bank, within 48 hours of delivery.' },
];

export default function Sell() {
  const { user, myShop, registerShop } = useStore();
  const navigate = useNavigate();

  return (
    <div className="sell">
      <section className="page-hero sell-hero">
        <div className="container">
          <span className="hero-kicker">Sell on Zed Market</span>
          <h1>Bring your shop online and sell across Zambia</h1>
          <p>
            Whether you trade at Kamwala, Chisokone, Mongu Harbour or from home, upload your products and reach buyers
            in all 10 provinces. Deliver with the Zambian couriers you already use.
          </p>
          {myShop ? (
            <Link to="/seller" className="btn btn-light btn-lg">
              Go to my shop dashboard
            </Link>
          ) : (
            <a href="#register" className="btn btn-light btn-lg">
              Open my shop for free
            </a>
          )}
        </div>
      </section>

      <section className="container section">
        <div className="perk-grid">
          {perks.map((p) => (
            <div key={p.title} className="card perk">
              <span className="perk-icon">
                <Icon name={p.icon} size={22} />
              </span>
              <h3>{p.title}</h3>
              <p className="muted">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container section">
        <h2 className="center">How it works</h2>
        <div className="steps">
          {steps.map((s) => (
            <div key={s.n} className="step">
              <span className="step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container section narrow" id="register">
        <div className="card form-card">
          {myShop ? (
            <div className="success">
              <div className="success-icon">✓</div>
              <h2>{myShop.verified ? `${myShop.name} is live` : `${myShop.name} is waiting for approval`}</h2>
              <p>
                {myShop.verified
                  ? 'Add products and manage orders from your dashboard.'
                  : 'You can add products now. They go live as soon as Zed Market approves your shop.'}
              </p>
              <Link to="/seller" className="btn btn-primary">
                Go to dashboard
              </Link>
            </div>
          ) : !user ? (
            <div className="empty">
              <h2>Open your shop</h2>
              <p className="muted">
                First sign in or create an account. Your shop is linked to it, so you can manage it from any device.
              </p>
              <Link to={`/login?next=${encodeURIComponent('/sell#register')}`} className="btn btn-primary btn-lg">
                Sign in to open my shop
              </Link>
            </div>
          ) : user.shopId ? (
            <p className="muted center">Loading your shop…</p>
          ) : user.isAdmin ? (
            <div className="empty">
              <h2>Staff accounts can't have a shop</h2>
              <p className="muted">
                You're signed in as Zed Market staff. To sell on Zed Market, sign in with a different phone number.
              </p>
              <Link to="/admin" className="btn btn-primary">
                Go to the admin panel
              </Link>
            </div>
          ) : (
            <>
              <h2>Open your shop</h2>
              <ShopForm
                withOwner
                initial={{ ownerName: user.name === 'Zed Market Shopper' ? '' : user.name, phone: user.phone }}
                submitLabel="Send my application"
                onSubmit={async (shop, owner) => {
                  await registerShop(shop, owner);
                  navigate('/seller?tab=add');
                }}
              />
              <p className="muted small center">Free to join. No listing fees.</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
