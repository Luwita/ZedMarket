import { Link } from 'react-router-dom';
import { getCourier } from '../data/couriers';
import { formatLocation } from '../data/zambia';
import Icon from './Icon';

export function CourierChips({ ids }) {
  return (
    <div className="chips">
      {ids.map((id) => {
        const c = getCourier(id);
        return c ? (
          <span key={id} className="chip" title={c.description}>
            {c.icon} {c.name}
          </span>
        ) : null;
      })}
    </div>
  );
}

export default function ShopCard({ shop }) {
  return (
    <Link to={`/store/${shop.id}`} className="card shop-card">
      <div className="shop-card-top">
        <span className="shop-logo">{shop.logo ?? '🏪'}</span>
        <div className="shop-card-body">
          <h3 title={shop.name}>{shop.name}</h3>
          <div className="shop-card-loc">
            <Icon name="pin" size={14} className="inline-icon" />
            <span>
              {shop.area ? `${shop.area}, ` : ''}
              {formatLocation(shop)}
            </span>
          </div>
        </div>
      </div>
      <div className="shop-card-foot">
        <span className="pill pill-rating">{shop.rating ? `★ ${shop.rating}` : 'New shop'}</span>
        <span className="pill">{shop.productCount ?? 0} products</span>
        {shop.verified && (
          <span className="pill pill-verified" title="Verified by Zed Market">
            ✓ Verified
          </span>
        )}
      </div>
    </Link>
  );
}
