import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as api from '../api';
import LocationFields from '../components/LocationFields';
import { ProductImage } from '../components/ProductCard';
import { ProductRow } from '../components/ProductGrid';
import AskShop from '../components/AskShop';
import ShareButton from '../components/ShareButton';
import StatusShare from '../components/StatusShare';
import { RequestPriceForm } from '../components/PriceRequests';
import Stars from '../components/Stars';
import { useStore } from '../context/StoreContext';
import { getCategory, unitPrice } from '../data/catalog';
import { formatKg, quotesFor, tooHeavyFor } from '../data/couriers';
import { checkChoice } from '../data/options';
import { formatLocation } from '../data/zambia';
import { useProduct, useProductSearch } from '../hooks/useProducts';
import { discountPct, formatCount, formatK } from '../utils/format';
import { distanceLabel } from '../utils/geo';
import Icon from '../components/Icon';

function DeliveryOptions({ shop, weightKg }) {
  const { location, setLocation } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(location);
  const options = quotesFor(shop, location, weightKg);
  const tooHeavy = tooHeavyFor(shop, weightKg);

  return (
    <div className="card delivery-box">
      <div className="delivery-head">
        <strong>Delivery to {formatLocation(location)}</strong>
        <button
          className="link-btn"
          onClick={() => {
            setDraft(location);
            setEditing((e) => !e);
          }}
        >
          {editing ? 'Cancel' : 'Change'}
        </button>
      </div>
      <p className="muted small">Prices for {formatKg(weightKg)} (your current quantity).</p>
      {editing && (
        <div className="form-grid compact">
          <LocationFields value={draft} onChange={setDraft} idPrefix="pdp" />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setLocation(draft);
              setEditing(false);
            }}
          >
            Update
          </button>
        </div>
      )}
      {options.length ? (
        <ul className="delivery-list">
          {options.map((o) => (
            <li key={o.courier.id}>
              <span className="d-icon">{o.courier.icon}</span>
              <span className="d-name">
                {o.courier.name}
                <span className="muted small block">
                  {o.courier.id === 'pickup'
                    ? `At ${shop.area ? `${shop.area}, ` : ''}${shop.town}`
                    : o.courier.distance
                      ? `${o.eta} · price for ${distanceLabel(o)}`
                      : o.courier.collect
                        ? `${o.eta} · collect from the ${o.courier.collect}`
                        : o.eta}
                </span>
              </span>
              <strong>{o.fee ? formatK(o.fee) : 'Free'}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">This shop doesn't deliver to your town yet.</p>
      )}
      {tooHeavy.length > 0 && (
        <p className="muted small">Too heavy for {tooHeavy.map((c) => `${c.name} (max ${c.maxKg} kg)`).join(', ')}.</p>
      )}
    </div>
  );
}

function OptionPicker({ product, choice, onChange, showErrors }) {
  return product.options.map((option) => (
    <div key={option.name} className="option-row">
      <span className="option-label">
        {option.name}
        {choice[option.name] ? `: ${choice[option.name]}` : ''}
      </span>
      <div className="option-values" role="radiogroup" aria-label={option.name}>
        {option.values.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={choice[option.name] === value}
            className={`option-value ${choice[option.name] === value ? 'on' : ''}`}
            onClick={() => onChange({ ...choice, [option.name]: value })}
          >
            {value}
          </button>
        ))}
      </div>
      {showErrors && !choice[option.name] && <span className="error">Choose a {option.name.toLowerCase()}</span>}
    </div>
  ));
}

function Reviews({ product, shopName }) {
  const { catalogVersion } = useStore();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    api
      .productReviews(product.id, page)
      .then(
        (res) =>
          !cancelled && setData((prev) => (page > 1 && prev ? { ...res, items: [...prev.items, ...res.items] } : res)),
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [product.id, page, catalogVersion]);

  if (!data) return null;
  return (
    <section className="card section reviews" id="reviews">
      <h2>Customer reviews</h2>
      {data.count === 0 ? (
        <p className="muted">
          No reviews yet. Only buyers who received this item can review it, so every review here is from a real order.
        </p>
      ) : (
        <>
          <div className="review-summary">
            <div className="review-average">
              <strong>{data.average.toFixed(1)}</strong>
              <Stars value={data.average} />
              <span className="muted small">{data.count} verified reviews</span>
            </div>
            <div className="histogram">
              {[5, 4, 3, 2, 1].map((n) => (
                <div key={n} className="histogram-row">
                  <span>{n}★</span>
                  <span className="bar">
                    <span style={{ width: `${(data.histogram[n] / data.count) * 100}%` }} />
                  </span>
                  <span className="muted small">{data.histogram[n]}</span>
                </div>
              ))}
            </div>
          </div>
          <ul className="review-list">
            {data.items.map((r) => (
              <li key={r.id}>
                <div className="review-head">
                  <Stars value={r.rating} size="sm" />
                  <strong>{r.author}</strong>
                  <span className="muted small">
                    ✓ Verified purchase · {new Date(r.date).toLocaleDateString('en-ZM', { dateStyle: 'medium' })}
                  </span>
                </div>
                {r.comment && <p>{r.comment}</p>}
                {r.reply && (
                  <div className="review-reply">
                    <strong>{shopName} replied:</strong> {r.reply}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {data.items.length < data.count && (
            <button className="btn btn-outline" onClick={() => setPage((p) => p + 1)}>
              More reviews
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getShop, addToCart, wishlist, toggleWishlist, myShop } = useStore();
  const { product, status } = useProduct(id);
  const [qty, setQty] = useState(1);
  const [photo, setPhoto] = useState(0);
  const [choice, setChoice] = useState({});
  const [showErrors, setShowErrors] = useState(false);

  const fromShop = useProductSearch(product ? { shop: product.shopId, sort: 'popular', limit: 13 } : null).items;
  const similar = useProductSearch(product ? { cat: product.category, sort: 'popular', limit: 24 } : null).items;

  if (!product) {
    if (status === 'loading') return <div className="container section muted">Loading…</div>;
    return (
      <div className="container section card empty">
        <p>That product could not be found.</p>
        <Link to="/shop" className="btn btn-primary">
          Back to shop
        </Link>
      </div>
    );
  }

  const shop = getShop(product.shopId);
  const category = getCategory(product.category);
  const price = unitPrice(product, qty);
  const off = discountPct(product.price, product.oldPrice);
  const tiers = [{ min: 1, price: product.price }, ...product.tiers];
  const more = fromShop.filter((p) => p.id !== product.id);
  const related = similar.filter((p) => p.id !== product.id && p.shopId !== product.shopId);

  const add = () => {
    if (checkChoice(product, choice)) {
      setShowErrors(true);
      return false;
    }
    addToCart(product, qty, choice);
    return true;
  };

  return (
    <div className="container pdp">
      <nav className="crumbs">
        <Link to="/">Home</Link> / <Link to={`/shop?cat=${category.id}`}>{category.name}</Link> /{' '}
        <span>{product.name}</span>
      </nav>

      <div className="pdp-grid">
        <div className="card pdp-gallery">
          <ProductImage product={product} size="lg" index={photo} />
          {product.images?.length > 1 && (
            <div className="thumbs">
              {product.images.map((src, i) => (
                <button key={i} className={i === photo ? 'on' : ''} onClick={() => setPhoto(i)}>
                  <img src={src} alt={`View ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pdp-info">
          {product.badge && <span className="tag tag-badge static">{product.badge}</span>}
          <h1>{product.name}</h1>
          <div className="meta-row">
            {product.reviewCount > 0 ? (
              <a href="#reviews">
                <Stars value={product.rating} size="sm" /> {product.rating} ({product.reviewCount} reviews)
              </a>
            ) : (
              <span>{product.rating ? `★ ${product.rating}` : 'New listing'}</span>
            )}
            {product.sold > 0 && <span>{formatCount(product.sold)} sold</span>}
            {product.local && <span>Made in Zambia</span>}
          </div>

          <div className="pdp-price">
            <span className="price big">{formatK(price)}</span>
            {price === product.price && product.oldPrice > product.price && (
              <>
                <span className="old-price">{formatK(product.oldPrice)}</span>
                <span className="tag tag-off static">-{off}%</span>
              </>
            )}
            {price < product.price && <span className="tag tag-green static">Wholesale price applied</span>}
          </div>

          {tiers.length > 1 && (
            <div className="tier-table">
              {tiers.map((t, i) => {
                const next = tiers[i + 1];
                const active = qty >= t.min && (!next || qty < next.min);
                return (
                  <button key={t.min} className={`tier ${active ? 'on' : ''}`} onClick={() => setQty(t.min)}>
                    <span className="tier-price">{formatK(t.price)}</span>
                    <span className="tier-qty">{next ? `${t.min}–${next.min - 1}` : `${t.min}+`} units</span>
                  </button>
                );
              })}
            </div>
          )}

          {product.options?.length > 0 && (
            <OptionPicker product={product} choice={choice} onChange={setChoice} showErrors={showErrors} />
          )}

          <div className="qty-row">
            <label htmlFor="qty">Quantity</label>
            <div className="qty">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">
                −
              </button>
              <input
                id="qty"
                type="number"
                min="1"
                max={product.stock}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(product.stock, Number(e.target.value) || 1)))}
              />
              <button onClick={() => setQty((q) => Math.min(product.stock, q + 1))} aria-label="Increase">
                +
              </button>
            </div>
            <span className="muted">{product.stock ? `${formatCount(product.stock)} in stock` : 'Sold out'}</span>
          </div>

          <div className="pdp-total">
            Total: <strong>{formatK(price * qty)}</strong>
            {price < product.price && <span className="save"> You save {formatK((product.price - price) * qty)}</span>}
          </div>

          <div className="pdp-buttons buy-bar">
            <button className="btn btn-primary btn-lg" disabled={!product.stock} onClick={add}>
              Add to cart
            </button>
            <button
              className="btn btn-dark btn-lg"
              disabled={!product.stock}
              onClick={() => add() && navigate('/checkout')}
            >
              Buy now
            </button>
            <button className="btn btn-outline btn-lg" onClick={() => toggleWishlist(product)}>
              {wishlist.includes(product.id) ? 'Saved' : 'Save'}
            </button>
          </div>

          <div className="pdp-buttons pdp-secondary">
            {shop && <AskShop shop={shop} product={product} />}
            {product.stock >= 2 && <RequestPriceForm product={product} choice={choice} startQty={qty} />}
            <ShareButton title={product.name} text={`${product.name} for ${formatK(price)} on Zed Market`} />
            {myShop?.id === product.shopId && <StatusShare product={product} className="btn btn-outline" />}
            {myShop && myShop.id !== product.shopId && (
              <Link to={`/seller?tab=add&resell=${product.id}`} className="btn btn-outline btn-sm" title="List this product in your shop">
                ⇄ Resell in my shop
              </Link>
            )}
          </div>
        </div>

        {/* Seller and delivery: a third column on very wide screens, under the buy buttons otherwise. */}
        <aside className="pdp-aside">
          {shop && (
            <Link to={`/store/${shop.id}`} className="card seller-box">
              <span className="shop-logo sm">{shop.logo ?? '🏪'}</span>
              <span>
                <strong>
                  {shop.name}{'\u00a0'}
                  {shop.verified && (
                    <span className="verified-badge" title="Verified by Zed Market">
                      ✓
                    </span>
                  )}
                </strong>
                <span className="muted small block">
                  <Icon name="pin" size={14} className="inline-icon" />{shop.area ? `${shop.area}, ` : ''}
                  {formatLocation(shop)} ·{' '}
                  {shop.rating ? `★ ${shop.rating}${shop.reviewCount ? ` (${shop.reviewCount})` : ''}` : 'New shop'}
                </span>
              </span>
              <span className="muted small">Visit shop →</span>
            </Link>
          )}

          {shop && <DeliveryOptions shop={shop} weightKg={qty * (product.weightKg ?? 1)} />}

          <ul className="assurances">
            <li>📲 Pay by MTN MoMo, Airtel Money or Zamtel Kwacha, or on delivery</li>
            <li>↩️ 7-day returns if the item is not as described</li>
            <li>⚖️ Weight: {formatKg(product.weightKg ?? 1)} per unit (used to price delivery)</li>
          </ul>
        </aside>
      </div>

      <section className="card section pdp-desc">
        <h2>Product details</h2>
        <p className="pre-line">{product.description}</p>
      </section>

      <Reviews product={product} shopName={shop?.name ?? 'The shop'} />

      {more.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>More from {shop?.name}</h2>
            <Link to={`/store/${product.shopId}`}>Visit shop →</Link>
          </div>
          <ProductRow items={more} />
        </section>
      )}

      {related.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Similar from other shops</h2>
          </div>
          <ProductRow items={related} />
        </section>
      )}
    </div>
  );
}
