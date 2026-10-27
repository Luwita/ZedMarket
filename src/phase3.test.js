import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as api from './api';
import App from './App';

const renderAt = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};
const type = (label, value, options) => fireEvent.change(screen.getByLabelText(label, options), { target: { value } });

// A Lusaka shop selling fans, and a signed-in buyer in Lusaka.
function setupShopAndBuyer({ shop = {} } = {}) {
  const sellerToken = api.__signIn({
    name: 'Mutinta',
    phone: '0977700700',
    accountType: 'seller',
    shop: {
      id: 'shop_fans',
      name: 'Mutinta Appliances',
      province: 'lusaka',
      town: 'Lusaka',
      area: 'Cairo Road',
      phone: '0977700700',
      couriers: ['pickup', 'yango'],
      ...shop,
    },
  });
  api.__addProduct({
    id: 'prd_fan',
    shopId: 'shop_fans',
    name: 'Standing Fan',
    category: 'home',
    price: 500,
    stock: 100,
    weightKg: 2,
    tiers: [{ min: 10, price: 450 }],
  });
  const buyerToken = api.__signIn({ name: 'Chipo', phone: '0966111000' });
  localStorage.setItem('zedmarket.location', JSON.stringify({ province: 'lusaka', town: 'Lusaka' }));
  return { sellerToken, buyerToken };
}

test('a buyer asks a shop a question and the shop replies', async () => {
  const { sellerToken, buyerToken } = setupShopAndBuyer();
  const buyer = renderAt('/product/prd_fan');
  fireEvent.click(await screen.findByRole('button', { name: 'Ask the shop' }));
  type('Message Mutinta Appliances', 'Does it come with a remote?');
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

  expect(await screen.findByText('Does it come with a remote?')).toBeInTheDocument();
  expect(window.location.pathname).toMatch(/^\/messages\/cnv_/);
  buyer.unmount();

  api.setToken(sellerToken);
  renderAt('/messages');
  const conversation = await screen.findByRole('link', { name: /Chipo/ });
  expect(within(conversation).getByText('1')).toBeInTheDocument(); // unread
  fireEvent.click(conversation);
  await screen.findByLabelText('Message');
  type('Message', 'Yes, a remote is included.');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Yes, a remote is included.')).toBeInTheDocument();

  api.setToken(buyerToken);
  expect((await api.unreadMessages()).count).toBe(1);
});

test('a discount code is checked by the server and lowers the total at checkout', async () => {
  const { sellerToken, buyerToken } = setupShopAndBuyer();
  api.setToken(sellerToken);
  await api.createCoupon({ code: 'FAN10', kind: 'percent', value: 10, minSpend: 800 });
  api.setToken(buyerToken);
  localStorage.setItem('zedmarket.cart', JSON.stringify([{ id: 'prd_fan', qty: 2 }]));

  renderAt('/checkout');
  type(await screen.findByLabelText('Discount code').then(() => 'Discount code'), 'nope');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText(/NOPE isn't a valid code/)).toBeInTheDocument();

  type('Discount code', 'fan10');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText(/FAN10 at Mutinta Appliances/)).toBeInTheDocument();
  // 2 × K500 = K1000, −10% = K900, plus K45 Yango.
  expect(screen.getByRole('button', { name: 'Place order · K945' })).toBeInTheDocument();

  type('Street address or landmark', 'Plot 3');
  fireEvent.click(screen.getByRole('button', { name: 'Place order · K945' }));
  expect(await screen.findByText(/One more step: pay the shop/)).toBeInTheDocument();
  expect(api.__db().orders[0]).toMatchObject({ discount: 100, total: 945 });
});

test('wholesale price request: ask, quote, accept, and check out at the agreed price', async () => {
  const { sellerToken, buyerToken } = setupShopAndBuyer();
  const buyer = renderAt('/product/prd_fan');
  fireEvent.click(await screen.findByRole('button', { name: 'Request a wholesale price' }));
  type('How many units?', '40');
  type('Your target price per unit (K, optional)', '380');
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
  expect(await screen.findByText('Waiting for the shop')).toBeInTheDocument();
  buyer.unmount();

  api.setToken(sellerToken);
  const seller = renderAt('/seller?tab=quotes');
  expect(await screen.findByText(/buyer hopes for/)).toBeInTheDocument();
  type('Your price per unit (K)', '400');
  fireEvent.click(screen.getByRole('button', { name: 'Send price' }));
  await waitFor(() => expect(api.__db().priceRequests[0].status).toBe('quoted'));
  seller.unmount();

  api.setToken(buyerToken);
  renderAt('/account?tab=quotes');
  fireEvent.click(await screen.findByRole('button', { name: 'Accept and add to cart' }));
  expect(await screen.findByText('Agreed price')).toBeInTheDocument();
  expect(screen.getByText('40 units')).toBeInTheDocument(); // quantity is fixed for an agreed price

  fireEvent.click(screen.getByRole('link', { name: /^Checkout/ }));
  type(await screen.findByLabelText('Street address or landmark').then(() => 'Street address or landmark'), 'Plot 9');
  fireEvent.click(screen.getByLabelText(/Collect from shop/));
  fireEvent.click(screen.getByRole('button', { name: 'Place order · K16,000' })); // 40 × K400, not the K450 tier
  expect(await screen.findByText(/One more step: pay the shop/)).toBeInTheDocument();
  expect(api.__db().priceRequests[0].status).toBe('ordered');
});

test('the receipt shows the shop TPIN and the VAT included', async () => {
  setupShopAndBuyer({ shop: { tpin: '1002003004', vatRegistered: true } });
  const order = await api.placeOrder({
    items: [{ productId: 'prd_fan', qty: 1 }],
    shipping: { name: 'Chipo', phone: '0966111000', province: 'lusaka', town: 'Lusaka', address: 'Plot 3' },
    couriers: { shop_fans: 'pickup' },
    payment: 'momo',
  });
  renderAt(`/order/${order.id}/receipt`);
  expect(await screen.findByText(/TPIN 1002003004/)).toBeInTheDocument();
  expect(screen.getByText('Includes VAT at 16% on goods')).toBeInTheDocument();
  expect(screen.getByText('K68.97')).toBeInTheDocument(); // 500 × 16/116
  expect(screen.getByRole('button', { name: /Print/ })).toBeInTheDocument();
});

test('low-data mode skips product photos until tapped', async () => {
  setupShopAndBuyer();
  api.__db().products.find((p) => p.id === 'prd_fan').images = ['/uploads/fan.jpg'];
  localStorage.setItem('zedmarket.lowData', 'true');
  renderAt('/product/prd_fan');
  const reveal = await screen.findByRole('button', { name: 'Tap to load photo' });
  expect(document.querySelector('.pdp-gallery img')).toBeNull();
  fireEvent.click(reveal);
  expect(document.querySelector('.pdp-gallery img')).toHaveAttribute('src', '/uploads/fan.jpg');
});

test('featured products appear on the home page with a label', async () => {
  setupShopAndBuyer();
  api.__db().products.find((p) => p.id === 'prd_fan').featuredUntil = new Date(Date.now() + 864e5).toISOString();
  renderAt('/');
  const section = (await screen.findByText('Featured by shops')).closest('section');
  expect(within(section).getByText('Standing Fan')).toBeInTheDocument();
  expect(within(section).getByText('Featured')).toBeInTheDocument();
});

test('a buyer can delete their account after confirming', async () => {
  api.__signIn({ name: 'Chipo', phone: '0966111000' });
  renderAt('/account?tab=privacy');
  const button = await screen.findByRole('button', { name: 'Delete my account' });
  expect(button).toBeDisabled();
  type('Type DELETE to confirm', 'DELETE');
  fireEvent.click(button);
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(api.__db().users.find((u) => u.phone === '0966111000')).toBeUndefined();
});

test.each(['/legal/terms', '/legal/privacy', '/legal/sellers', '/legal/returns', '/terms', '/messages'])(
  '%s renders',
  async (path) => {
    api.__signIn({ name: 'Chipo', phone: '0966111000' });
    renderAt(path);
    await waitFor(() => expect(document.querySelector('main').textContent.length).toBeGreaterThan(30));
  },
);
