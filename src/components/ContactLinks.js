import { normalizePhone } from '../utils/format';

// "Call" and "WhatsApp" links for a Zambian phone number, so buyers and shops can reach each other from an order.
export default function ContactLinks({ phone, name = '', about = '' }) {
  const digits = normalizePhone(phone ?? '');
  if (!/^[79]\d{8}$/.test(digits)) return null;
  const hello = `Hello${name ? ` ${name}` : ''}${about ? `, about ${about}` : ''}.`;
  return (
    <span className="contact-links">
      <a className="btn btn-outline btn-sm" href={`tel:+260${digits}`}>
        Call
      </a>{' '}
      <a
        className="btn btn-outline btn-sm"
        href={`https://wa.me/260${digits}?text=${encodeURIComponent(hello)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp
      </a>
    </span>
  );
}
