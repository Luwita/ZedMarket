import { useEffect, useState } from 'react';
import * as api from '../api';
import ContactLinks from './ContactLinks';
import { useStore } from '../context/StoreContext';
import { formatK } from '../utils/format';

// 'Paid', 'Waiting for payment' or 'Pay on delivery' for a parcel (or for the whole order without one).
export const paymentLabel = (order, shipment) => {
  if (shipment ? shipment.paid : order.paid) return 'Paid';
  if (!order.payByMomo) return 'Pay on delivery';
  return shipment?.paymentSentAt ? 'Payment being checked by the shop' : 'Waiting for payment';
};

// Shown to the buyer for a parcel paid by Mobile Money: where to send the money, then "I've paid".
// The shop confirms the money arrived before it sends the parcel.
export default function PayShop({ order, shipment }) {
  const { reloadOrders, notify } = useStore();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState(null); // how long until an unpaid order is cancelled
  useEffect(() => {
    api
      .settings()
      .then((s) => setHours(s.unpaidCancelHours ?? null))
      .catch(() => {});
  }, []);

  if (!order.payByMomo || shipment.status === 'cancelled') return null;
  if (shipment.paid) {
    return (
      <p className="pay-shop pay-shop-done small">
        ✅ {shipment.shopName} received your payment of {formatK(shipment.due)}.
      </p>
    );
  }
  const to = shipment.payTo;
  if (shipment.paymentSentAt) {
    return (
      <p className="pay-shop small">
        ⏳ You told {shipment.shopName} you sent {formatK(shipment.due)}
        {shipment.paymentRef && ` (transaction ID ${shipment.paymentRef})`}. They send your parcel as soon as the money
        shows on their phone. Not confirmed after a few hours? Call the shop on {shipment.shopPhone}.{' '}
        <ContactLinks phone={shipment.shopPhone} about={`order ${order.id}`} />
      </p>
    );
  }

  const send = async () => {
    setBusy(true);
    try {
      await api.paymentSent(order.id, shipment.shopId, reference.trim());
      await reloadOrders();
      notify(`${shipment.shopName} has been told. They confirm once the money arrives.`);
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pay-shop">
      <strong>
        Send {formatK(shipment.due)} to {shipment.shopName}
      </strong>
      {to ? (
        <dl className="pay-to">
          <dt>{to.networkName}</dt>
          <dd>{to.number}</dd>
          <dt>Name</dt>
          <dd>{to.name}</dd>
          <dt>Reference</dt>
          <dd>{order.id}</dd>
        </dl>
      ) : (
        <p className="small">Call the shop on {shipment.shopPhone} for its Mobile Money number.</p>
      )}
      <p className="muted small">
        Check the name on your phone matches before you approve. The shop sends your parcel once the money arrives.
        {hours ? ` Orders not paid within ${hours} hours are cancelled.` : ''}
      </p>
      <p className="small">
        Need help? <ContactLinks phone={shipment.shopPhone} about={`order ${order.id}`} />
      </p>
      <div className="inline-fields">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={40}
          placeholder="Transaction ID from the SMS (optional)"
          aria-label={`Transaction ID for ${shipment.shopName}`}
        />
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={send}>
          {busy ? 'Sending…' : "I've paid"}
        </button>
      </div>
    </div>
  );
}
