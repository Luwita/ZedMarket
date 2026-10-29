import { render, screen } from '@testing-library/react';
import * as api from './api';
import App from './App';
import ContactLinks from './components/ContactLinks';

test('call and WhatsApp links use the Zambian country code, and nothing shows for a bad number', () => {
  const { container, rerender } = render(<ContactLinks phone="0977 123 456" name="Chanda" about="order ZM-1" />);
  expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+260977123456');
  const wa = screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
  expect(wa).toMatch(/^https:\/\/wa\.me\/260977123456\?text=/);
  expect(decodeURIComponent(wa)).toContain('Hello Chanda, about order ZM-1.');
  rerender(<ContactLinks phone="12345" />);
  expect(container).toBeEmptyDOMElement();
});

test('checkout starts with the delivery details from the last order on this device', async () => {
  localStorage.setItem('zedmarket.cart', JSON.stringify([{ id: 'p1', qty: 1 }]));
  localStorage.setItem('zedmarket.delivery', JSON.stringify({ name: 'Chanda Phiri', phone: '0977000111', address: 'Plot 5, Cairo Road' }));
  api.__signIn({ name: 'Chanda Phiri', phone: '0977000111' });
  window.history.pushState({}, '', '/checkout');
  render(<App />);
  expect(await screen.findByLabelText(/Full name|Name/)).toHaveValue('Chanda Phiri');
  expect(screen.getByDisplayValue('Plot 5, Cairo Road')).toBeInTheDocument();
  localStorage.removeItem('zedmarket.delivery');
});

test('photos under 400 pixels on the short side are flagged as small', () => {
  const { isSmallPhoto } = require('./utils/image');
  expect(isSmallPhoto({ width: 300, height: 900 })).toBe(true);
  expect(isSmallPhoto({ width: 800, height: 600 })).toBe(false);
  expect(isSmallPhoto(null)).toBe(false);
});

test('every category is on the categories page and opens a filtered shop list', async () => {
  const { categories } = require('./data/catalog');
  expect(categories.length).toBeGreaterThanOrEqual(22);
  window.history.pushState({}, '', '/categories');
  render(<App />);
  for (const c of categories) {
    const links = await screen.findAllByRole('link', { name: new RegExp(c.name.replace(/[.*+?^${}()|[\]\&]/g, '\$&')) });
    expect(links.some((l) => l.getAttribute('href') === `/shop?cat=${c.id}`)).toBe(true);
  }
});
