import { Link } from 'react-router-dom';
import { collectPlace, getCourier } from '../data/couriers';
import { formatK } from '../utils/format';

const STEPS = [
  { id: 'pending', label: 'Order placed' },
  { id: 'dispatched', label: 'With courier' },
  { id: 'delivered', label: 'Delivered' },
];

export const CASE_STATUS = {
  open: 'Waiting for the shop',
  accepted: 'Accepted by the shop',
  rejected: 'Rejected by the shop',
  escalated: 'With Zed Market',
  resolved: 'Decided by Zed Market',
  withdrawn: 'Withdrawn',
};

export const statusLabel = (shipment) => {
  const pickup = shipment.courier === 'pickup';
  if (shipment.status === 'cancelled') return 'Cancelled';
  if (shipment.status === 'delivered') return pickup ? 'Collected' : 'Delivered';
  if (shipment.status === 'dispatched') {
    if (pickup) return 'Ready for collection';
    const office = collectPlace(shipment.courier);
    return office ? `Sent to the ${office}` : `Sent with ${shipment.courierName}`;
  }
  return pickup ? 'Being prepared' : 'Awaiting dispatch';
};

// `viewer` is 'buyer' or 'shop'; it only changes the wording of who cancelled.
export default function ShipmentStatus({ shipment, viewer = 'buyer' }) {
  const courier = getCourier(shipment.courier);
  const refund =
    shipment.refunded > 0 &&
    (shipment.refundsPaid
      ? `Refunded ${formatK(shipment.refunded)}`
      : `Refund of ${formatK(shipment.refunded)} on its way`);

  if (shipment.status === 'cancelled') {
    const mine = viewer === 'shop' ? 'seller' : 'buyer';
    const who =
      shipment.cancelledBy === 'admin'
        ? 'Zed Market'
        : shipment.cancelledBy === mine
          ? 'you'
          : viewer === 'shop'
            ? 'the buyer'
            : 'the shop';
    return (
      <div className="shipment-status cancelled-note">
        Cancelled by {who}
        {shipment.cancelReason && `: “${shipment.cancelReason}”`}
        {refund && <div className="small">{refund}</div>}
      </div>
    );
  }

  const current = STEPS.findIndex((s) => s.id === shipment.status);
  return (
    <div className="shipment-status">
      <div className="track">
        {STEPS.map((step, i) => (
          <div key={step.id} className={`track-step ${i <= current ? 'done' : ''}`}>
            <span className="track-dot" />
            {step.id === 'dispatched' && shipment.courier === 'pickup' ? 'Ready to collect' : step.label}
          </div>
        ))}
      </div>
      <div className="small muted">
        {courier?.icon} {shipment.courierName} · {shipment.eta}
        {courier?.collect && ` · collect from the ${courier.collect} with your order number and ID`}
        {shipment.tracking && (
          <>
            {' '}
            · Tracking / waybill: <strong>{shipment.tracking}</strong>
          </>
        )}
      </div>
      {shipment.latestCase && (
        <div className="small">
          {shipment.latestCase.kind === 'return' ? 'Return' : 'Missing parcel'}:{' '}
          <Link to={`/cases/${shipment.latestCase.id}`} className="link">
            {CASE_STATUS[shipment.latestCase.status]}
          </Link>
        </div>
      )}
      {refund && <div className="small">{refund}</div>}
    </div>
  );
}
