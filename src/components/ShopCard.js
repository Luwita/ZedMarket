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
      <span className="shop-logo">{shop.logo ?? '🏪'}</span>
      <div className="shop-card-body">
        <h3>
          {shop.name}{'\u00a0'}
          {shop.verified && (
            <span className="verified-badge" title="Verified by Zed Market">
              ✓
            </span>
          )}
        </h3>
        <div className="muted small">
          <Icon name="pin" size={14} className="inline-icon" />{shop.area ? `${shop.area}, ` : ''}
          {formatLocation(shop)}
        </div>
        <div className="small">
          {shop.rating ? `★ ${shop.rating}` : 'New shop'} · {shop.productCount ?? 0} products
        </div>
      </div>
    </Link>
  );
}
