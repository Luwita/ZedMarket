import { fireEvent, render, screen, within } from '@testing-library/react';
import * as api from './api';
import App from './App';

const renderAt = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};

function setup() {
  api.__signIn({
    name: 'Mutinta',
    phone: '0977700700',
    accountType: 'seller',
    shop: { id: 'shop_fans', name: 'Mutinta Appliances', province: 'lusaka', town: 'Lusaka', area: 'Cairo Road', phone: '0977700700', couriers: ['pickup'] },
  });
  api.__addProduct({ id: 'prd_fan', shopId: 'shop_fans', name: 'Standing Fan', category: 'home', price: 500, stock: 10 });
  // The test browser can't draw pictures, like a very old phone.
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
}

afterEach(() => jest.restoreAllMocks());

test('a shop owner shares a product to WhatsApp Status from the dashboard', async () => {
  setup();
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  renderAt('/seller');

  const row = (await screen.findByRole('link', { name: 'Standing Fan' })).closest('.seller-product');
  fireEvent.click(within(row).getByRole('button', { name: 'Share' }));
  const box = screen.getByRole('dialog', { name: 'Share on WhatsApp Status' });

  expect(await within(box).findByText('This browser cannot make the picture.')).toBeInTheDocument();
  const whatsapp = within(box).getByRole('link', { name: 'Send link on WhatsApp' });
  expect(decodeURIComponent(whatsapp.getAttribute('href'))).toContain(
    'Standing Fan for K500 at Mutinta Appliances. Order on Zed Market: http://localhost/product/prd_fan',
  );

  fireEvent.click(within(box).getByRole('button', { name: 'Copy link' }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost/product/prd_fan');
  expect(await screen.findByText('Link copied')).toBeInTheDocument();

  fireEvent.click(within(box).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('only the shop that sells a product sees Share to Status on its page', async () => {
  setup();
  const seller = renderAt('/product/prd_fan');
  expect(await screen.findByRole('button', { name: 'Share to Status' })).toBeInTheDocument();
  seller.unmount();

  api.__signIn({ name: 'Chipo', phone: '0966111000' });
  renderAt('/product/prd_fan');
  expect(await screen.findByRole('heading', { name: 'Standing Fan' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Share to Status' })).not.toBeInTheDocument();
});
