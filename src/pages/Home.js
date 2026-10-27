import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api';
import Icon from '../components/Icon';
import { ProductRow } from '../components/ProductGrid';
import { useStore } from '../context/StoreContext';
import { bannerThemes } from '../data/bannerThemes';
import { categories } from '../data/catalog';
import { getProvince, provinces } from '../data/zambia';
import { useProductSearch } from '../hooks/useProducts';

const standardSlides = [
  {
    title: 'Beat load‑shedding', // a non-breaking hyphen keeps the word on one line
    text: 'Solar panels, inverters & lithium batteries from trusted local shops at wholesale Kwacha prices.',
    cta: 'Shop Solar & Power',
    to: '/shop?cat=solar',
    bg: 'linear-gradient(120deg, #0a5340 0%, #0e6b52 55%, #2fa37c 130%)',
    icon: '☀️',
  },
  {
    title: 'Wholesale for your shop',
    text: 'Buy in bulk from sellers across Zambia. Prices drop as your order grows. Pay with Mobile Money.',
    cta: 'Start buying wholesale',
    to: '/wholesale',
    bg: 'linear-gradient(120deg, #1e3a5f 0%, #24527a 60%, #2fa37c 140%)',
    icon: '📦',
  },
  {
    title: 'Delivered by Zambian couriers',
    text: 'Yango Delivery in town, Platinum Couriers, bus parcels and Zampost between provinces, or collect from the shop.',
    cta: 'See delivery options',
    to: '/delivery',
    bg: 'linear-gradient(120deg, #111827 0%, #1f2937 55%, #198754 140%)',
    icon: '🛵',
  },
];

const promises = [
  { icon: 'shield', title: 'Verified local shops', text: 'Checked sellers in all 10 provinces' },
  { icon: 'phone', title: 'Pay your way', text: 'Mobile Money or cash on delivery' },
  { icon: 'truck', title: 'Zambian couriers', text: 'Yango, Platinum, buses and Zampost' },
  { icon: 'support', title: 'Seller support', text: 'One-on-one help to start selling' },
];

// The banner carousel: campaign banners set by Zed Market staff come before the standard slides.
export function useHeroSlides() {
  const { lowData } = useStore();
  const [slide, setSlide] = useState(0);
  const [banners, setBanners] = useState([]);

  useEffect(() => {
    api
      .banners()
      .then((list) =>
        setBanners(
          list.map((b) => ({ title: b.title, text: b.text, cta: b.cta, to: b.link, bg: bannerThemes[b.theme], image: b.image })),
        ),
      )
      .catch(() => {});
  }, []);
  const slides = [...banners, ...standardSlides];

  useEffect(() => {
    if (lowData) return undefined; // no automatic carousel in low-data mode
    const t = setInterval(() => setSlide((s) => (s + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, [lowData, slides.length]);

  return { slides, slide: slide % slides.length, setSlide };
}

export function Hero() {
  const { lowData } = useStore();
  const { slides, slide, setSlide } = useHeroSlides();
  const s = slides[slide];
  return (
    <div className="hero" style={{ background: s.bg }}>
      <div className="hero-copy">
        <span className="hero-kicker">ZED MARKET · Zambia's marketplace</span>
        <h1>{s.title}</h1>
        <p>{s.text}</p>
        <Link to={s.to} className="btn btn-light">
          {s.cta} →
        </Link>
      </div>
      {s.image && !lowData ? (
        <img className="hero-image" src={s.image} alt="" />
      ) : (
        s.icon && <div className="hero-icon">{s.icon}</div>
      )}
      <div className="dots">
        {slides.map((_, i) => (
          <button key={i} className={i === slide ? 'on' : ''} aria-label={`Slide ${i + 1}`} onClick={() => setSlide(i)} />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { shops, location, user } = useStore();
  const [stats, setStats] = useState({});

  useEffect(() => {
    api
      .provinceStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  const province = getProvince(location.province);
  const near = useProductSearch({
    prov: location.province,
    sort: 'nearest',
    nearProv: location.province,
    nearTown: location.town,
    limit: 12,
  }).items;
  const deals = useProductSearch({ sort: 'deals', limit: 12 }).items;
  const featured = useProductSearch({ featured: '1', sort: 'popular', limit: 12 }).items;
  const local = useProductSearch({ local: '1', sort: 'popular', limit: 12 }).items;
  const popular = useProductSearch({ sort: 'popular', limit: 24 }).items;
  const shopsNearby = shops.filter((s) => s.province === location.province).length;

  return (
    <div className="home">
      <section className="container hero-grid">
        <aside className="card cat-side">
          <h3>Categories</h3>
          {categories.map((c) => (
            <Link key={c.id} to={`/shop?cat=${c.id}`}>
              <span>{c.icon}</span> {c.name}
            </Link>
          ))}
        </aside>

        <Hero />

        <aside className="hero-side">
          <div className="card side-card side-accent">
            <h4>Shopping in {location.town}</h4>
            <p>
              {shopsNearby} shop{shopsNearby === 1 ? '' : 's'} in {province?.name} Province. Change your location at the
              top of the page to see others.
            </p>
            <Link
              to={`/shop?prov=${location.province}&town=${encodeURIComponent(location.town)}`}
              className="btn btn-outline btn-sm btn-block"
            >
              Shop near me
            </Link>
          </div>
          <div className="card side-card">
            <h4>Own a shop?</h4>
            <p>Upload your products and sell to buyers across Zambia. Free to join.</p>
            <Link to="/sell" className="btn btn-primary btn-sm btn-block">
              Open your shop
            </Link>
          </div>
        </aside>
      </section>

      <section className="container promises">
        {promises.map((p) => (
          <div key={p.title} className="promise">
            <span className="promise-icon">
              <Icon name={p.icon} size={22} />
            </span>
            <div>
              <strong>{p.title}</strong>
              <p>{p.text}</p>
            </div>
          </div>
        ))}
      </section>

      {near.length > 0 && (
        <section className="container section">
          <div className="section-head">
            <h2>Near you in {province?.name}</h2>
            <Link to={`/shop?prov=${location.province}`}>See all →</Link>
          </div>
          <ProductRow items={near} />
        </section>
      )}

      {featured.length > 0 && (
        <section className="container section">
          <div className="section-head">
            <h2>Featured by shops</h2>
            <span className="muted small">Promoted by the shops that sell them</span>
          </div>
          <ProductRow items={featured} />
        </section>
      )}

      {deals.length > 0 && (
        <section className="container section">
          <div className="section-head deals-head">
            <h2>Flash deals</h2>
            <Link to="/shop?sort=deals">See all →</Link>
          </div>
          <ProductRow items={deals} />
        </section>
      )}

      <section className="container section">
        <div className="section-head">
          <h2>Shop by province</h2>
          <Link to="/stores">All shops →</Link>
        </div>
        <div className="province-grid">
          {provinces.map((p) => {
            const count = stats[p.id]?.products ?? 0;
            return (
              <Link
                key={p.id}
                to={`/shop?prov=${p.id}`}
                className={`province-tile ${p.id === location.province ? 'mine' : ''}`}
              >
                <strong>{p.name}</strong>
                <span className="muted small">{count} products</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="container section">
        <div className="section-head">
          <h2>Shop by category</h2>
        </div>
        <div className="cat-grid">
          {categories.map((c) => (
            <Link key={c.id} to={`/shop?cat=${c.id}`} className="cat-tile" style={{ '--tint': c.color }}>
              <span className="cat-icon">{c.icon}</span>
              <span>{c.name}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="container section">
        <div className="wholesale-banner">
          <div>
            <h2>Stock your shop for less</h2>
            <p>
              Order in bulk from sellers in Kamwala, Chisokone, Chipata and beyond. Prices fall automatically, and the
              goods reach you by courier or bus parcel.
            </p>
          </div>
          <Link to="/wholesale" className="btn btn-light">
            Browse wholesale
          </Link>
        </div>
      </section>

      {local.length > 0 && (
        <section className="container section">
          <div className="section-head">
            <h2>Made in Zambia</h2>
            <Link to="/shop?local=1">See all →</Link>
          </div>
          <ProductRow items={local} />
        </section>
      )}

      <section className="container section">
        <div className="section-head">
          <h2>Popular across Zambia</h2>
          {popular.length > 0 && <Link to="/shop?sort=popular">See all →</Link>}
        </div>
        {popular.length > 0 ? (
          <ProductRow items={popular} rows={2} />
        ) : (
          <div className="card empty">
            <div className="empty-icon">🏪</div>
            <h3>Zed Market is just opening</h3>
            <p className="muted">
              Shops across Zambia are signing up and being checked by our team. Their products will appear here soon.
            </p>
            {!user?.isAdmin && (
              <Link to="/sell" className="btn btn-primary">
                Open your shop
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
