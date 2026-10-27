import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import ProductGrid from '../components/ProductGrid';
import AskShop from '../components/AskShop';
import Stars from '../components/Stars';
import { useProductSearch } from '../hooks/useProducts';
import ShopCard, { CourierChips } from '../components/ShopCard';
import ShareButton from '../components/ShareButton';
import { useStore } from '../context/StoreContext';
import { band, bandRank } from '../data/couriers';
import { formatLocation, getProvince, provinces } from '../data/zambia';
import Icon from '../components/Icon';

export default function Stores() {
  const { shops, location } = useStore();
  const [params, setParams] = useSearchParams();
  const prov = params.get('prov') ?? '';
  const list = shops
    .filter((s) => !s.suspended)
    .filter((s) => !prov || s.province === prov)
    .sort((a, b) => bandRank[band(a, location)] - bandRank[band(b, location)] || (b.rating ?? 0) - (a.rating ?? 0));

  return (
    <div className="container section">
      <div className="shop-toolbar">
        <div>
          <h1>Shops {prov ? `in ${getProvince(prov).name} Province` : 'across Zambia'}</h1>
          <span className="muted">
            {list.length} shops · nearest to {location.town} first
          </span>
        </div>
        <select
          value={prov}
          onChange={(e) => setParams(e.target.value ? { prov: e.target.value } : {})}
          aria-label="Province"
        >
          <option value="">All provinces</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {list.length ? (
        <div className="shop-grid">
          {list.map((s) => (
            <ShopCard key={s.id} shop={s} />
          ))}
        </div>
      ) : (
        <div className="card empty">
          <p>No shops in this province yet.</p>
          <Link to="/sell" className="btn btn-primary">
            Be the first to open one
          </Link>
        </div>
      )}
    </div>
  );
}

export function StorePage() {
  const { id } = useParams();
  const { getShop } = useStore();
  const shop = getShop(id);
  const products = useProductSearch(shop ? { shop: shop.id, sort: 'popular', limit: 24 } : null);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    api
      .shopReviews(id)
      .then(setReviews)
      .catch(() => {});
  }, [id]);

  if (!shop) {
    return (
      <div className="container section card empty">
        <p>Shop not found.</p>
        <Link to="/stores" className="btn btn-primary">
          Browse shops
        </Link>
      </div>
    );
  }

  const phone = shop.phone.replace(/\s/g, '').replace(/^0/, '260');

  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [shop.area, shop.town, 'Zambia'].filter(Boolean).join(', '),
  )}`;

  return (
    <div className="container section">
      {shop.banner && <div className="store-banner" style={{ backgroundImage: `url(${shop.banner})` }} />}
      <div className={`card dash-head ${shop.banner ? 'under-banner' : ''}`}>
        <span className="shop-logo">{shop.logo ?? '🏪'}</span>
        <div className="grow">
          <h1>
            {shop.name}{'\u00a0'}
            {shop.verified && (
              <span className="verified-badge" title="Verified by Zed Market">
                ✓ Verified
              </span>
            )}
          </h1>
          {shop.suspended && <p className="error">This shop is not taking orders at the moment.</p>}
          {!shop.verified && !shop.suspended && (
            <p className="review-note">⏳ Only you can see this page until Zed Market approves your shop.</p>
          )}
          <p className="muted">
            <Icon name="pin" size={14} className="inline-icon" />{shop.area ? `${shop.area}, ` : ''}
            {formatLocation(shop)} ·{' '}
            {shop.rating
              ? `★ ${shop.rating}${shop.reviewCount ? ` (${shop.reviewCount} reviews)` : ''}`
              : 'New shop'}{' '}
            · On Zed Market since {shop.since}
          </p>
          {shop.openingHours && <p className="small">🕘 {shop.openingHours}</p>}
          <CourierChips ids={shop.couriers} />
        </div>
        <ShareButton title={shop.name} text={`${shop.name} on Zed Market`} path={`/store/${shop.id}`} />
        <a className="btn btn-outline" href={directions} target="_blank" rel="noopener noreferrer">
          🧭 Directions
        </a>
        <a className="btn btn-primary" href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer">
          💬 WhatsApp shop
        </a>
        <AskShop shop={shop} label="✉️ Message shop" />
      </div>

      {shop.about && (
        <section className="card store-about">
          <h2>About {shop.name}</h2>
          <p className="pre-line">{shop.about}</p>
        </section>
      )}

      <div className="section-head section">
        <h2>Products ({products.total})</h2>
      </div>
      <ProductGrid
        result={products}
        empty={
          <div className="card empty">
            <p>This shop hasn't listed any products yet.</p>
          </div>
        }
      />

      {reviews.length > 0 && (
        <section className="card section reviews">
          <h2>What buyers say</h2>
          <ul className="review-list">
            {reviews.map((r) => (
              <li key={r.id}>
                <div className="review-head">
                  <Stars value={r.rating} size="sm" />
                  <strong>{r.author}</strong>
                  <span className="muted small">
                    on <Link to={`/product/${r.productId}`}>{r.productName}</Link>
                  </span>
                </div>
                {r.comment && <p>{r.comment}</p>}
                {r.reply && (
                  <div className="review-reply">
                    <strong>{shop.name} replied:</strong> {r.reply}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
