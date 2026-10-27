import { Link } from 'react-router-dom';
import { ProductImage } from '../components/ProductCard';
import { useStore } from '../context/StoreContext';
import { formatLocation } from '../data/zambia';
import { useIsPhone } from '../phone';
import { formatK } from '../utils/format';
import Icon from '../components/Icon';

export const groupByShop = (items) =>
  Object.values(
    items.reduce((groups, item) => {
      const key = item.product.shopId;
      groups[key] = groups[key] ?? { shop: item.shop, items: [] };
      groups[key].items.push(item);
      return groups;
    }, {}),
  );

export default function Cart() {
  const phone = useIsPhone();
  const {
    items,
    selectedItems,
    subtotal,
    wholesaleSavings,
    setQty,
    removeFromCart,
    toggleSelected,
    selectAll,
    removeSelected,
    saveSelectedForLater,
    catalogStatus,
    cartStatus,
  } = useStore();

  if (catalogStatus === 'loading' || cartStatus === 'loading') return null;

  if (!items.length) {
    return (
      <div className="container section">
        <div className="card empty">
          <div className="empty-icon">🛒</div>
          <h2>Your cart is empty</h2>
          <p className="muted">Browse products from local shops across Zambia.</p>
          <Link to="/shop" className="btn btn-primary">
            Start shopping
          </Link>
        </div>
      </div>
    );
  }

  const groups = groupByShop(items);
  const allSelected = selectedItems.length === items.length;
  const selectedShops = groupByShop(selectedItems).length;

  return (
    <div className="container section cart-page">
      <h1>Cart ({items.length})</h1>
      <div className="cart-layout">
        <div className="cart-groups">
          <div className="card cart-batch">
            <label className="check">
              <input type="checkbox" checked={allSelected} onChange={() => selectAll(!allSelected)} /> Select all
            </label>
            <span className="muted small grow">{selectedItems.length} selected</span>
            <button className="link-btn" disabled={!selectedItems.length} onClick={saveSelectedForLater}>
              Save for later
            </button>
            <button className="link-btn danger" disabled={!selectedItems.length} onClick={removeSelected}>
              Remove selected
            </button>
          </div>
          {groups.map(({ shop, items: lines }) => (
            <div key={shop?.id ?? 'unknown'} className="card cart-items">
              {shop && (
                <Link to={`/store/${shop.id}`} className="cart-shop">
                  <span>{shop.logo ?? '🏪'}</span> <strong>{shop.name}</strong>
                  <span className="muted small"><Icon name="pin" size={14} className="inline-icon" />{formatLocation(shop)}</span>
                </Link>
              )}
              {lines.map(({ key, product, choice, qty, price, total, quoteId, selected }) => {
                const nextTier = !quoteId && product.tiers.find((t) => t.min > qty);
                return (
                  <div key={key} className={`cart-line ${selected ? '' : 'unselected'}`}>
                    <input
                      type="checkbox"
                      className="cart-check"
                      checked={selected}
                      onChange={() => toggleSelected(key)}
                      aria-label={`Buy ${product.name} now`}
                    />
                    <Link to={`/product/${product.id}`}>
                      <ProductImage product={product} size="sm" />
                    </Link>
                    <div className="cart-line-info">
                      <Link to={`/product/${product.id}`} className="cart-line-name">
                        {product.name}
                      </Link>
                      {choice && <div className="small muted">{choice}</div>}
                      <div className="small">
                        {formatK(price)} each
                        {quoteId ? (
                          <span className="tag tag-green static">Agreed price</span>
                        ) : (
                          price < product.price && <span className="tag tag-green static">Wholesale</span>
                        )}
                      </div>
                      {nextTier && (
                        <div className="tier-nudge">
                          Add {nextTier.min - qty} more to pay {formatK(nextTier.price)} each
                        </div>
                      )}
                    </div>
                    {quoteId ? (
                      <div className="qty-fixed" title="The agreed price is for this exact quantity">
                        {qty} units
                      </div>
                    ) : (
                      <div className="qty">
                        <button onClick={() => setQty(key, qty - 1)} aria-label="Decrease">
                          −
                        </button>
                        <input
                          type="number"
                          min="1"
                          value={qty}
                          onChange={(e) => setQty(key, Math.max(1, Number(e.target.value) || 1))}
                          aria-label="Quantity"
                        />
                        <button onClick={() => setQty(key, qty + 1)} aria-label="Increase">
                          +
                        </button>
                      </div>
                    )}
                    <div className="cart-line-total">
                      <strong>{formatK(total)}</strong>
                      <button className="link-btn" onClick={() => removeFromCart(key)}>
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <aside className="card summary">
          <h3>Order summary</h3>
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{formatK(subtotal)}</span>
          </div>
          {wholesaleSavings > 0 && (
            <div className="summary-row green">
              <span>Wholesale savings</span>
              <span>−{formatK(wholesaleSavings)}</span>
            </div>
          )}
          <div className="summary-row muted">
            <span>Delivery</span>
            <span>Choose at checkout</span>
          </div>
          {selectedShops > 1 && (
            <p className="muted small">Your items come from {selectedShops} shops. Each shop sends its own parcel.</p>
          )}
          {selectedItems.length ? (
            <Link to="/checkout" className="btn btn-primary btn-lg btn-block">
              Checkout ({selectedItems.length})
            </Link>
          ) : (
            <button className="btn btn-primary btn-lg btn-block" disabled>
              Select items to check out
            </button>
          )}
          {selectedItems.length < items.length && (
            <p className="muted small">Unticked items stay in your cart for next time.</p>
          )}
        </aside>
      </div>

      {phone && selectedItems.length > 0 && (
        <div className="cart-bar">
          <div>
            <span className="muted small">Subtotal</span>
            <strong>{formatK(subtotal)}</strong>
          </div>
          <Link to="/checkout" className="btn btn-primary">
            Checkout ({selectedItems.length})
          </Link>
        </div>
      )}
    </div>
  );
}
