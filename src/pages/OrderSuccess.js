import { Link, useLocation, useParams } from 'react-router-dom';
import PayShop, { paymentLabel } from '../components/PayShop';
import ShipmentStatus from '../components/ShipmentStatus';
import { useStore } from '../context/StoreContext';
import { formatLocation } from '../data/zambia';
import { formatK } from '../utils/format';

export default function OrderSuccess() {
  const { id } = useParams();
  const { orders } = useStore();
  const { state } = useLocation();
  const order = orders.find((o) => o.id === id) ?? (state?.order?.id === id ? state.order : null);

  if (!order) {
    return (
      <div className="container section card empty">
        <p>Order not found.</p>
        <Link to="/account" className="btn btn-primary">
          My orders
        </Link>
      </div>
    );
  }

  const toPay = order.payByMomo && !order.paid;
  return (
    <div className="container section narrow">
      <div className="card success">
        <div className="success-icon">✓</div>
        <h1>{toPay ? 'Natotela! One more step: pay the shop' : 'Natotela! Your order is confirmed'}</h1>
        <p className="muted">
          Order <strong>{order.id}</strong> · {order.payment} · {paymentLabel(order)}
        </p>
        <p>
          Delivering to{' '}
          <strong>
            {order.shipping.address}, {formatLocation(order.shipping)}
          </strong>
          . Updates on your order appear in <Link to="/notifications">Notifications</Link>.
        </p>

        {order.shipments.map((s) => (
          <div key={s.shopId} className="card shipment-card">
            <strong>{s.shopName}</strong>
            <span className="muted small"> · from {s.shopTown}</span>
            <PayShop order={order} shipment={s} />
            <ShipmentStatus shipment={s} />
          </div>
        ))}

        <div className="summary-row total">
          <span>{order.paid ? 'Total paid' : order.payByMomo ? 'Total to pay by Mobile Money' : 'Total due on delivery'}</span>
          <span>{formatK(order.total)}</span>
        </div>

        <div className="pdp-buttons center">
          <Link to="/shop" className="btn btn-primary">
            Continue shopping
          </Link>
          <Link to="/account" className="btn btn-outline">
            View my orders
          </Link>
          <Link to={`/order/${order.id}/receipt`} className="btn btn-outline">
            Receipt
          </Link>
        </div>
      </div>
    </div>
  );
}
