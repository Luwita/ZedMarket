import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import BulkUpload from '../components/BulkUpload';
import { CancelParcel, ShopCases } from '../components/Cases';
import { ShopPriceRequests } from '../components/PriceRequests';
import VerificationPanel, { ShopNotices } from '../components/Verification';
import Promotions from '../components/Promotions';
import { QrCard } from '../components/AdminQr';
import ContactLinks from '../components/ContactLinks';
import { ProductImage } from '../components/ProductCard';
import ProductForm from '../components/ProductForm';
import { SalesReport, ShopReviews } from '../components/SellerInsights';
import ShipmentStatus, { statusLabel } from '../components/ShipmentStatus';
import ShopForm from '../components/ShopForm';
import { useStore } from '../context/StoreContext';
import { formatLocation } from '../data/zambia';
import { useProduct, useProductSearch } from '../hooks/useProducts';
import { formatK } from '../utils/format';
import { mapLink } from '../utils/geo';
import Icon from '../components/Icon';
import SideNav from '../components/SideNav';
import StatusShare from '../components/StatusShare';

// Send several parcels at once, e.g. after one trip to the bus station or courier office.
function BatchDispatch({ orders }) {
  const { updateShipment, notify } = useStore();
  // Mobile Money parcels can only be sent once the shop has confirmed the payment.
  const pending = orders.filter(
    ({ order, shipment }) => shipment.status === 'pending' && !(order.payByMomo && !shipment.paid),
  );
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  if (pending.length < 2) return null;
  const all = picked.length === pending.length;
  const send = async () => {
    setBusy(true);
    let sent = 0;
    for (const { order, shipment } of pending.filter(({ order }) => picked.includes(order.id))) {
      try {
        await updateShipment(order.id, shipment.shopId, { status: 'dispatched' });
        sent += 1;
      } catch (err) {
        notify(`${order.id}: ${err.message}`);
      }
    }
    setPicked([]);
    setBusy(false);
    notify(`${sent} parcel${sent === 1 ? '' : 's'} marked as sent. Buyers have been notified.`);
  };
  return (
    <div className="card cart-batch">
      <label className="check">
        <input type="checkbox" checked={all} onChange={() => setPicked(all ? [] : pending.map((p) => p.order.id))} />{' '}
        {pending.length} parcels to send
      </label>
      <span className="batch-picks grow">
        {pending.map(({ order, shipment }) => (
          <label key={order.id} className="chip-check">
            <input
              type="checkbox"
              checked={picked.includes(order.id)}
              onChange={() =>
                setPicked((p) => (p.includes(order.id) ? p.filter((x) => x !== order.id) : [...p, order.id]))
              }
            />{' '}
            {order.id} · {shipment.courierName}
          </label>
        ))}
      </span>
      <button className="btn btn-primary btn-sm" disabled={!picked.length || busy} onClick={send}>
        {busy ? 'Sending…' : `Mark ${picked.length || ''} as sent`}
      </button>
    </div>
  );
}

function OrderCard({ order, shipment }) {
  const { updateShipment, confirmPayment, notify } = useStore();
  const [tracking, setTracking] = useState(shipment.tracking);
  const [busy, setBusy] = useState(false);
  const pickup = shipment.courier === 'pickup';
  const awaitingPayment = order.payByMomo && !shipment.paid;

  const confirmPaid = async () => {
    setBusy(true);
    try {
      await confirmPayment(order.id, shipment.shopId);
      notify('Payment confirmed. The buyer has been told. You can now send the parcel.');
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  };

  const advance = async (patch, message) => {
    setBusy(true);
    try {
      await updateShipment(order.id, shipment.shopId, patch);
      notify(message);
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card order">
      <div className="order-head">
        <strong>{order.id}</strong>
        <span className="muted small">
          {new Date(order.date).toLocaleString('en-ZM', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
        <span className={`status status-${shipment.status}`}>{statusLabel(shipment)}</span>
      </div>
      <div className="small">
        {shipment.items.map((i) => (
          <div key={`${i.id}-${i.options}`}>
            {i.qty} × {i.name}
            {i.options && <strong> ({i.options})</strong>} @ {formatK(i.price)}
          </div>
        ))}
      </div>
      <div className="small muted">
        {order.buyer.name} · {order.buyer.phone}{' '}
        <ContactLinks phone={order.buyer.phone} name={order.buyer.name} about={`order ${order.id}`} /> · <Icon name="pin" size={14} className="inline-icon" />{order.shipping.address}, {formatLocation(order.shipping)}
        {order.shipping.lat != null && (
          <>
            {' '}
            ·{' '}
            <a className="link" href={mapLink(order.shipping)} target="_blank" rel="noreferrer">
              Buyer's location on the map (give it to the rider)
            </a>
          </>
        )}
      </div>
      <div className="small">
        {shipment.paid
          ? order.payByMomo
            ? 'Paid to your Mobile Money'
            : 'Paid'
          : awaitingPayment
            ? 'Not paid yet'
            : 'Collect payment on delivery'}
        : <strong>{formatK(shipment.subtotal)}</strong> + delivery {formatK(shipment.fee)}
      </div>
      <ShipmentStatus shipment={shipment} viewer="shop" />
      {shipment.pickupPoint && <div className="small">Send to {shipment.pickupPoint}</div>}

      {shipment.status === 'pending' && awaitingPayment && (
        <div className="pay-shop">
          <strong>
            Wait for {formatK(shipment.due)} on your Mobile Money
            {shipment.payTo && ` (${shipment.payTo.networkName} ${shipment.payTo.number})`}
          </strong>
          <p className="small">
            {shipment.paymentSentAt
              ? `${order.buyer.name} says the money was sent${
                  shipment.paymentRef ? `, transaction ID ${shipment.paymentRef}` : ''
                }.`
              : `${order.buyer.name} has your number and hasn't paid yet.`}{' '}
            Check your Mobile Money balance, not only the SMS, and confirm only when the money is really there. Don't
            send the parcel before that.
          </p>
          <div className="dispatch-row">
            <CancelParcel orderId={order.id} shopId={shipment.shopId} role="seller" />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={confirmPaid}>
              Payment received
            </button>
          </div>
        </div>
      )}
      {shipment.status === 'pending' && !awaitingPayment && (
        <div className="dispatch-row">
          <CancelParcel orderId={order.id} shopId={shipment.shopId} role="seller" />
          {!pickup && (
            <input
              placeholder={`${shipment.courierName} tracking / waybill no.`}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              aria-label="Tracking number"
            />
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() =>
              advance(
                { status: 'dispatched', tracking: tracking.trim() },
                pickup
                  ? 'Buyer notified that the order is ready to collect'
                  : `Marked as sent with ${shipment.courierName}`,
              )
            }
          >
            {pickup ? 'Ready for collection' : `Hand over to ${shipment.courierName}`}
          </button>
        </div>
      )}
      {shipment.status === 'dispatched' && (
        <p className="small muted dispatch-row">
          Waiting for the buyer to confirm they {pickup ? 'collected' : 'received'} it. You'll be told, and it's confirmed
          automatically after 24 hours (48 hours when it goes to another province).
        </p>
      )}
    </div>
  );
}

function ProductList({ result, lowOnly, go }) {
  const { deleteProduct, notify } = useStore();

  if (!result.items.length) {
    if (result.loading) return <p className="muted">Loading…</p>;
    return (
      <div className="card empty">
        <div className="empty-icon">📦</div>
        <p>{lowOnly ? 'Nothing is running low.' : 'Your shop has no products yet.'}</p>
        <div className="pdp-buttons center">
          <button className="btn btn-primary" onClick={() => go({ tab: 'add' })}>
            Upload a product
          </button>
          <button className="btn btn-outline" onClick={() => go({ tab: 'bulk' })}>
            Upload a spreadsheet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card seller-products">
      {result.items.map((p) => (
        <div key={p.id} className="seller-product">
          <ProductImage product={p} size="sm" />
          <div className="grow">
            <Link to={`/product/${p.id}`} className="cart-line-name">
              {p.name}
            </Link>
            <div className="small muted">
              {formatK(p.price)}
              {p.tiers.length > 0 && ` · wholesale from ${formatK(p.tiers[p.tiers.length - 1].price)}`} ·{' '}
              <span className={!p.stock ? 'error' : p.stock <= p.lowStockAt ? 'warn' : ''}>
                {p.stock ? `${p.stock} in stock` : 'Sold out'}
              </span>
              {p.reviewCount > 0 && ` · ★ ${p.rating} (${p.reviewCount})`}
            </div>
          </div>
          <div className="pdp-buttons">
            <StatusShare product={p} label="Share" />
            <button className="btn btn-outline btn-sm" onClick={() => go({ tab: 'products', edit: p.id })}>
              Edit
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() =>
                window.confirm(`Remove "${p.name}" from your shop?`) &&
                deleteProduct(p.id).catch((err) => notify(err.message))
              }
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      {result.hasMore && (
        <div className="load-more">
          <button className="btn btn-outline" onClick={result.loadMore} disabled={result.loading}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

const PAYOUT_METHODS = { mtn: 'MTN MoMo', airtel: 'Airtel Money', zamtel: 'Zamtel Kwacha', bank: 'Bank transfer' };

// The balance between the shop and Zed Market: commission the shop owes (and where to pay it), or money
// Zed Market owes the shop, and the payments already made either way.
function SellerPayouts() {
  const [p, setP] = useState(null);
  useEffect(() => {
    api
      .sellerPayouts()
      .then(setP)
      .catch(() => {});
  }, []);
  if (!p) return null;
  return (
    <section className="card form-card">
      <h3>Your money</h3>
      <div className="tiles">
        {p.available < 0 ? (
          <div className="tile">
            <span>Commission you owe</span>
            <strong className="error">{formatK(-p.available)}</strong>
            <small>on orders your buyers paid you for</small>
          </div>
        ) : (
          <div className="tile">
            <span>Ready to be paid</span>
            <strong>{formatK(p.available)}</strong>
            <small>paid to you by Mobile Money or bank</small>
          </div>
        )}
        <div className="tile">
          <span>On hold</span>
          <strong>{formatK(p.onHold)}</strong>
          <small>released 7 days after delivery</small>
        </div>
        <div className="tile">
          <span>Paid to you so far</span>
          <strong>{formatK(p.paidOut)}</strong>
        </div>
        {p.commissionPaid > 0 && (
          <div className="tile">
            <span>Commission you've paid</span>
            <strong>{formatK(p.commissionPaid)}</strong>
          </div>
        )}
      </div>
      {p.available < 0 && (
        <div className="pay-shop">
          <strong>Send {formatK(-p.available)} to Zed Market</strong>
          {p.payTo ? (
            <dl className="pay-to">
              <dt>{PAYOUT_METHODS[p.payTo.network]}</dt>
              <dd>{p.payTo.number}</dd>
              <dt>Name</dt>
              <dd>{p.payTo.name}</dd>
              <dt>Reference</dt>
              <dd>Your shop name</dd>
            </dl>
          ) : (
            <p className="small">Zed Market will tell you where to send it.</p>
          )}
          <p className="muted small">
            Your buyers paid you directly, so the commission on those orders is yours to pass on. Zed Market records
            your payment when it arrives and you get a message.
          </p>
        </div>
      )}
      {p.history.length > 0 && (
        <ul className="admin-log">
          {p.history.map((h) => (
            <li key={h.id}>
              <strong>{formatK(h.amount)}</strong> {h.kind === 'commission' ? 'commission you paid' : 'paid to you'} ·{' '}
              {PAYOUT_METHODS[h.method]} {h.reference}
              <span className="muted small"> · {new Date(h.date).toLocaleDateString('en-ZM', { dateStyle: 'medium' })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const RESELL_MARGIN = 0.15;

// 1-click resell: list another Zambian shop's product in your own shop with your margin.
// You buy it from that shop (or keep stock) and send it to your customer yourself.
function ResellForm({ productId, onSubmit }) {
  const { getShop } = useStore();
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api
      .getProduct(productId)
      .then(setSource)
      .catch((err) => setError(err.message));
  }, [productId]);
  if (error) return <p className="error">{error}</p>;
  if (!source) return <p className="muted">Loading…</p>;
  const supplier = getShop(source.shopId);
  const initial = {
    name: source.name,
    category: source.category,
    description: source.description ?? '',
    price: String(Math.ceil(source.price * (1 + RESELL_MARGIN))),
    stock: '',
    weightKg: source.weightKg,
    options: source.options,
    images: (source.images ?? []).filter((i) => i.startsWith('/uploads/')),
    sourceProductId: source.id,
  };
  return (
    <>
      <h2>Resell in my shop</h2>
      <p className="review-note">
        ⇄ From <Link to={`/store/${source.shopId}`}>{supplier?.name ?? 'another shop'}</Link> at{' '}
        <strong>{formatK(source.price)}</strong>. We've added a {RESELL_MARGIN * 100}% margin; change the price, stock and
        photos as you like. When a customer orders, buy it from the supplier (or use your stock) and send it yourself.
      </p>
      <ProductForm initial={initial} onSubmit={onSubmit} submitLabel="List in my shop" />
    </>
  );
}

export default function SellerDashboard() {
  const { user, myShop, shopOrders, addProduct, updateProduct, updateShop } = useStore();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'products';
  const editing = params.get('edit');
  const lowOnly = params.get('low') === '1';
  const shopId = myShop?.id;

  const products = useProductSearch(
    shopId ? { shop: shopId, sort: 'newest', limit: 50, lowStock: lowOnly ? '1' : '' } : null,
  );
  const productCount = useProductSearch(shopId ? { shop: shopId, limit: 1 } : null).total;
  const lowCount = useProductSearch(shopId ? { shop: shopId, lowStock: '1', limit: 1 } : null).total;
  const { product: editProduct } = useProduct(editing);

  if (user?.isAdmin) return <Navigate to="/admin" replace />;
  // The account has a shop but the shop list is still loading (e.g. just after signing in).
  if (user?.shopId && !myShop) return <div className="container section muted">Loading your shop…</div>;
  if (!myShop) {
    return (
      <div className="container section narrow">
        <div className="card empty">
          <div className="empty-icon">🏪</div>
          <h2>You don't have a shop yet</h2>
          <p className="muted">Open a free shop to upload products and receive orders.</p>
          <Link to="/sell#register" className="btn btn-primary">
            Open my shop
          </Link>
          <Link to="/login" className="muted small">
            Already have one? Sign in with your shop phone number
          </Link>
        </div>
      </div>
    );
  }

  const myOrders = shopOrders
    .map((o) => ({ order: o, shipment: o.shipments.find((s) => s.shopId === myShop.id) }))
    .filter((x) => x.shipment);
  const pending = myOrders.filter((x) => x.shipment.status === 'pending').length;
  const sales = myOrders.reduce((sum, x) => sum + x.shipment.subtotal, 0);
  const go = (next) => setParams(next);
  const groups = [
    [
      'Products',
      [
        ['products', `My products (${productCount})`],
        ['add', 'Add product'],
        ['bulk', 'Bulk upload'],
      ],
    ],
    [
      'Sales',
      [
        ['orders', 'Orders', pending],
        ['returns', 'Returns'],
        ['quotes', 'Price requests'],
        ['reviews', 'Reviews'],
      ],
    ],
    [
      'Grow',
      [
        ['promotions', 'Promotions'],
        ['report', 'Sales report'],
      ],
    ],
    ['Shop', [['settings', 'Shop & delivery']]],
  ];

  return (
    <div className="container section">
      <div className="dash-head card">
        <span className="shop-logo lg">{myShop.logo ?? '🏪'}</span>
        <div className="grow">
          <h1>{myShop.name}</h1>
          <p className="muted">
            <Icon name="pin" size={14} className="inline-icon" />{myShop.area}, {formatLocation(myShop)} ·{' '}
            <Link to={`/store/${myShop.id}`} className="link">
              View public shop page →
            </Link>
          </p>
        </div>
        <div className="stats">
          <div>
            <strong>{productCount}</strong>
            <span>Products</span>
          </div>
          <div>
            <strong>{pending}</strong>
            <span>To dispatch</span>
          </div>
          <div>
            <strong>{formatK(sales)}</strong>
            <span>Sales</span>
          </div>
        </div>
      </div>

      <ShopNotices />

      {myShop.ownerId === user.id && !myShop.takesMomo && (
        <div className="card alert-bar" role="status">
          Add your Mobile Money number so buyers can pay you. Until you do, they can only pay on delivery.{' '}
          <button className="link-btn" onClick={() => go({ tab: 'settings' })}>
            Add it now
          </button>
        </div>
      )}

      {lowCount > 0 && tab !== 'report' && (
        <div className="card alert-bar" role="status">
          {lowCount} product{lowCount > 1 ? 's are' : ' is'} running low on stock.{' '}
          <button className="link-btn" onClick={() => go({ tab: 'products', low: '1' })}>
            Show {lowCount > 1 ? 'them' : 'it'}
          </button>
        </div>
      )}

      <div className="dash-layout">
        <SideNav groups={groups} current={tab} onSelect={(id) => go({ tab: id })} label="Shop dashboard sections" />
        <section className="dash-main">
          {tab === 'products' && editing && (
            <div className="card form-card narrow-card">
              <h2>Edit product</h2>
              {editProduct ? (
                <ProductForm
                  key={editProduct.id}
                  initial={editProduct}
                  submitLabel="Save changes"
                  onCancel={() => go({ tab: 'products' })}
                  onSubmit={async (data) => {
                    await updateProduct(editProduct.id, data);
                    go({ tab: 'products' });
                  }}
                />
              ) : (
                <p className="muted">Loading…</p>
              )}
            </div>
          )}

          {tab === 'products' && !editing && (
            <>
              {lowOnly && (
                <p className="small">
                  Showing products running low.{' '}
                  <button className="link-btn" onClick={() => go({ tab: 'products' })}>
                    Show all
                  </button>
                </p>
              )}
              <ProductList result={products} lowOnly={lowOnly} go={go} />
            </>
          )}

          {tab === 'add' && (
            <div className="card form-card narrow-card">
              {params.get('resell') ? (
                <ResellForm
                  key={params.get('resell')}
                  productId={params.get('resell')}
                  onSubmit={async (data) => {
                    await addProduct(data);
                    go({ tab: 'products' });
                  }}
                />
              ) : (
                <>
                  <h2>Upload a product</h2>
                  <ProductForm
                    onSubmit={async (data) => {
                      await addProduct(data);
                      go({ tab: 'products' });
                    }}
                  />
                </>
              )}
            </div>
          )}

          {tab === 'bulk' && (
            <div className="card form-card">
              <BulkUpload onDone={() => go({ tab: 'products' })} />
            </div>
          )}

          {tab === 'orders' &&
            (myOrders.length ? (
              <div className="orders">
                <BatchDispatch orders={myOrders} />
                {myOrders.map(({ order, shipment }) => (
                  <OrderCard key={order.id} order={order} shipment={shipment} />
                ))}
              </div>
            ) : (
              <div className="card empty">
                <p>No orders yet. Share your shop link on WhatsApp and Facebook to get your first sale.</p>
              </div>
            ))}

          {tab === 'reviews' && <ShopReviews />}

          {tab === 'returns' && <ShopCases />}

          {tab === 'quotes' && <ShopPriceRequests />}

          {tab === 'promotions' && (
            <>
              <QrCard
                code={{
                  id: `shop-${myShop.id}`,
                  title: myShop.name,
                  who: "Your shop's QR code: print it for your counter or share it",
                  path: `/store/${myShop.id}`,
                  text: 'Scan to see our products and order on Zed Market. Pay by Mobile Money or on delivery.',
                }}
              />
              <Promotions shopId={myShop.id} />
            </>
          )}

          {tab === 'report' && (
            <>
              <SellerPayouts />
              <p className="small">
                <Link to="/seller/statement" className="link">
                  Monthly statement (commission and payouts) →
                </Link>
              </p>
              <SalesReport onEditProduct={(id) => go({ tab: 'products', edit: id })} />
            </>
          )}

          {tab === 'settings' && (
            <div className="card form-card narrow-card">
              {myShop.ownerId === user.id ? (
                <>
                  <VerificationPanel />
                  <hr />
                  <ShopForm initial={myShop} submitLabel="Save settings" onSubmit={(shop) => updateShop(myShop.id, shop)} />
                </>
              ) : (
                <p className="muted">Demo shops can't be edited.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
