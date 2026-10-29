import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { conditionName, getCategory, isEnquiryCategory, isPerishableCategory } from '../data/catalog';
import { bestDelivery, band } from '../data/couriers';
import { useStore } from '../context/StoreContext';
import Icon from './Icon';
import { discountPct, formatCount, formatK } from '../utils/format';

export function ProductImage({ product, size = 'md', index = 0 }) {
  const { lowData } = useStore();
  const [reveal, setReveal] = useState(false);
  const photo = product.images?.[index];
  // In low-data mode photos load only when asked for (the large product photo is always worth showing on tap).
  if (photo && (!lowData || reveal)) {
    return (
      <div className={`product-img product-img-${size} has-photo`}>
        <img src={photo} alt={product.name} loading="lazy" decoding="async" />
      </div>
    );
  }
  const color = getCategory(product.category)?.color ?? '#888';
  return (
    <div className={`product-img product-img-${size}`} style={{ '--tint': color }}>
      <span role="img" aria-label={product.name}>
        {product.icon}
      </span>
      {photo && ['md', 'lg'].includes(size) && (
        <button
          type="button"
          className="reveal-photo"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setReveal(true);
          }}
        >
          Tap to load photo
        </button>
      )}
    </div>
  );
}

export const isFeatured = (product) => !!product.featuredUntil && new Date(product.featuredUntil) > new Date();

export default function ProductCard({ product }) {
  const { addToCart, wishlist, toggleWishlist, getShop, location } = useStore();
  const navigate = useNavigate();
  const needsChoice = product.options?.length > 0;
  const shop = getShop(product.shopId);
  const off = discountPct(product.price, product.oldPrice);
  const lowest = product.tiers.length ? product.tiers[product.tiers.length - 1] : null;
  const saved = wishlist.includes(product.id);
  const delivery = shop ? bestDelivery(shop, location, product.weightKg) : null;
  const nearby = shop && band(shop, location) === 'town';
  const enquiry = isEnquiryCategory(product.category);
  const secondHand = product.condition && product.condition !== 'new';

  return (
    <article className="card product-card">
      <Link to={`/product/${product.id}`} className="product-link">
        <div className="product-img-wrap">
          <ProductImage product={product} />
          {off > 0 && <span className="tag tag-off">-{off}%</span>}
          {isFeatured(product) ? (
            <span className="tag tag-featured">Featured</span>
          ) : nearby ? (
            <span className="tag tag-near">Near you</span>
          ) : (
            product.badge && <span className="tag tag-badge">{product.badge}</span>
          )}
        </div>
        <h3 className="product-name">{product.name}</h3>
        {(secondHand || isPerishableCategory(product.category)) && (
          <div className="card-pills">
            {secondHand && <span className="pill">{conditionName(product.condition)}</span>}
            {isPerishableCategory(product.category) && <span className="pill pill-verified">Fresh</span>}
          </div>
        )}
        <div className="price-row">
          <span className="price">{formatK(product.price)}</span>
          {product.oldPrice > product.price && <span className="old-price">{formatK(product.oldPrice)}</span>}
        </div>
        {lowest && (
          <div className="wholesale-hint">
            Wholesale <strong>{formatK(lowest.price)}</strong> for {lowest.min}+
          </div>
        )}
        {shop && (
          <div className="card-loc">
            <Icon name="pin" size={13} />
            <span>
              {shop.town}
              {delivery && (
                <span className="muted">
                  {' · '}
                  {delivery.fee ? `${formatK(delivery.fee)} delivery` : 'Free delivery'}
                </span>
              )}
            </span>
          </div>
        )}
        <div className="meta-row">
          <span>
            {product.rating ? `★ ${product.rating}` : 'New listing'}
            {product.reviewCount > 0 && ` (${product.reviewCount})`}
          </span>
          {product.sold > 0 && <span>{formatCount(product.sold)} sold</span>}
        </div>
      </Link>
      <div className="card-actions">
        {enquiry ? (
          <Link className="btn btn-primary btn-sm" to={`/product/${product.id}`}>
            Contact seller
          </Link>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => (needsChoice ? navigate(`/product/${product.id}`) : addToCart(product))}
            disabled={!product.stock}
          >
            {!product.stock ? 'Sold out' : needsChoice ? 'Choose options' : 'Add to cart'}
          </button>
        )}
        <button
          className={`icon-btn heart ${saved ? 'on' : ''}`}
          aria-label={saved ? 'Remove from saved' : 'Save item'}
          onClick={() => toggleWishlist(product)}
        >
          <Icon name="heart" size={20} />
        </button>
      </div>
    </article>
  );
}
