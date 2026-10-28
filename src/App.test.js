import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as api from './api';
import App from './App';

const renderAt = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};

const type = (label, value, options) => fireEvent.change(screen.getByLabelText(label, options), { target: { value } });

test('renders the Zed Market storefront with products from the API', async () => {
  renderAt('/');
  expect(screen.getByRole('search')).toBeInTheDocument();
  expect(await screen.findAllByText(/Tecno Spark 20 Pro/)).not.toHaveLength(0);
  expect(screen.getByText(/Flash deals/i, { selector: 'h2' })).toBeInTheDocument();
});

test('filters products by province and town', async () => {
  renderAt('/shop?prov=western&town=Mongu');
  expect(await screen.findByText(/Chitenge Fabric/)).toBeInTheDocument();
  expect(screen.getByText(/products in Mongu/)).toBeInTheDocument();
  expect(screen.queryByText(/Tecno Spark/)).not.toBeInTheDocument();
});

test('signing up as a shop owner with email and an emailed code leads to shop setup', async () => {
  renderAt('/login');
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  type('Full name', 'Mwansa Banda');
  type('I am a', 'seller');
  type('Email', 'mwansa@example.com');
  type('Password', 'short');
  fireEvent.click(screen.getAllByRole('button', { name: 'Create account' }).at(-1));
  expect(await screen.findByText('Use a password of at least 8 characters')).toBeInTheDocument();
  type('Password', 'Mwansa-2026');
  fireEvent.click(screen.getAllByRole('button', { name: 'Create account' }).at(-1));

  // Right after signing up: confirm the email address with the emailed code.
  expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  type('6-digit code', '123456');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  // Lands on shop setup with the name filled in.
  expect(await screen.findByRole('heading', { name: 'Open your shop', level: 2 })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/sell');
  expect(screen.getByLabelText('Your full name (as on your NRC)')).toHaveValue('Mwansa Banda');
  type('Phone (WhatsApp)', '0977123456');

  type('Shop name', 'Mwansa Hardware');
  type('Province', 'eastern', { selector: '#shop-province' });
  type('Street, market or area', 'Chipata Market');
  fireEvent.click(screen.getByRole('button', { name: 'Send my application' }));
  expect(await screen.findByText('Enter your NRC number like 123456/78/1')).toBeInTheDocument();
  type('NRC number', '123456/78/1');
  fireEvent.click(screen.getByRole('button', { name: 'Send my application' }));
  // Every shop gives the Mobile Money number buyers pay to.
  expect(await screen.findByText('Enter your Mobile Money number')).toBeInTheDocument();
  type('Mobile Money network', 'airtel');
  type('Mobile Money number', '0977 123 456');
  type('Name the number is registered in', 'Mwansa Banda');
  fireEvent.click(screen.getByRole('button', { name: 'Send my application' }));

  expect(await screen.findByRole('heading', { name: 'Upload a product' })).toBeInTheDocument();
  type('Product name', 'Hoe Handle (Mukwa)');
  type('Category', 'agri');
  type('Quantity in stock', '40');
  type('Price (K)', '75');
  fireEvent.click(screen.getByRole('button', { name: 'Publish product' }));
  expect(await screen.findByText(/Enter the weight of one unit/)).toBeInTheDocument();
  type('Weight per unit (kg)', '1.2');
  fireEvent.click(screen.getByRole('button', { name: 'Publish product' }));

  await waitFor(() => expect(document.querySelector('.seller-products')).toBeInTheDocument());
  expect(within(document.querySelector('.seller-products')).getByText('Hoe Handle (Mukwa)')).toBeInTheDocument();
  expect(api.__db().products.find((p) => p.name === 'Hoe Handle (Mukwa)').price).toBe(75);
  expect(screen.getByText(/Your shop is waiting for approval/)).toBeInTheDocument();
});

test('a new shop and its products stay hidden from buyers until staff approve it', async () => {
  api.__signIn({ name: 'Mwansa', phone: '0977123456', accountType: 'seller' });
  await api.createShop({
    name: 'Mwansa Hardware',
    phone: '0977123456',
    province: 'eastern',
    town: 'Chipata',
    area: 'Chipata Market',
    couriers: ['pickup', 'bus'],
    ownerFullName: 'Mwansa Banda',
    nrc: '123456/78/1',
  });
  await api.createProduct({ name: 'Hoe Handle (Mukwa)', category: 'agri', price: 75, stock: 40, weightKg: 1.2 });
  const shop = api.__db().shops.find((s) => s.name === 'Mwansa Hardware');

  // A buyer browsing Eastern Province doesn't see it yet.
  api.__signIn({ name: 'Chanda', phone: '0966000111' });
  const before = renderAt('/shop?prov=eastern');
  expect(await screen.findByText(/products in Eastern Province/)).toBeInTheDocument();
  expect(screen.queryByText('Hoe Handle (Mukwa)')).not.toBeInTheDocument();
  before.unmount();

  // Staff approve it in the admin panel.
  api.__signIn({ name: 'Staff', phone: '0950000001', admin: true });
  const staff = renderAt('/admin?tab=shops');
  const card = (await screen.findByRole('link', { name: 'Mwansa Hardware' })).closest('.order');
  expect(within(card).getByText(/123456\/78\/1/)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(shop.verification).toBe('verified'));
  staff.unmount();

  api.__signIn({ name: 'Chanda', phone: '0966000111' });
  renderAt('/shop?prov=eastern');
  expect(await screen.findByText('Hoe Handle (Mukwa)')).toBeInTheDocument();
});

test('checkout asks guests to sign in first', async () => {
  localStorage.setItem('zedmarket.cart', JSON.stringify([{ id: 'p1', qty: 1 }]));
  renderAt('/checkout');
  expect(await screen.findByText('Sign in to check out')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign in or create an account' })).toHaveAttribute(
    'href',
    '/login?next=/checkout',
  );
});

test('buyer checks out with a courier and the shop owner dispatches the order', async () => {
  const sellerToken = api.__signIn({
    name: 'Bupe',
    phone: '0966111222',
    accountType: 'seller',
    shop: {
      id: 'shop_kitwe',
      name: 'Bupe Electronics',
      province: 'copperbelt',
      town: 'Kitwe',
      area: 'Parklands',
      phone: '0966111222',
      couriers: ['pickup', 'yango'],
    },
  });
  api.__addProduct({
    id: 'prd_charger',
    shopId: 'shop_kitwe',
    name: 'Phone Charger',
    category: 'phones',
    price: 120,
    stock: 10,
  });
  api.__signIn({ name: 'Chanda Phiri', phone: '0977000111' });
  localStorage.setItem('zedmarket.location', JSON.stringify({ province: 'copperbelt', town: 'Kitwe' }));
  localStorage.setItem('zedmarket.cart', JSON.stringify([{ id: 'prd_charger', qty: 2 }]));

  const buyer = renderAt('/checkout');
  expect(await screen.findByLabelText(/Yango Delivery/)).toBeChecked(); // cheapest door delivery is preselected
  type('Street address or landmark', 'Plot 5, Riverside');
  fireEvent.click(screen.getByRole('button', { name: /Place order · K285/ })); // 2 × K120 + K45 Yango
  // Mobile Money goes to the shop's own number; the buyer then says the money was sent.
  expect(await screen.findByText(/One more step: pay the shop/)).toBeInTheDocument();
  expect(screen.getByText('Send K285 to Bupe Electronics')).toBeInTheDocument();
  expect(screen.getByText('0966111222')).toBeInTheDocument();
  expect(api.__db().products.find((p) => p.id === 'prd_charger').stock).toBe(8);
  type('Transaction ID for Bupe Electronics', 'MP261013.0915');
  fireEvent.click(screen.getByRole('button', { name: "I've paid" }));
  expect(await screen.findByText(/You told Bupe Electronics you sent K285/)).toBeInTheDocument();
  buyer.unmount();

  // The shop owner signs in on their own device and dispatches.
  api.setToken(sellerToken);
  renderAt('/seller?tab=orders');
  expect(await screen.findByText(/2 × Phone Charger/)).toBeInTheDocument();
  // The parcel can only be sent once the shop has confirmed the money arrived.
  expect(screen.getByText(/says the money was sent, transaction ID MP261013.0915/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hand over to Yango Delivery' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Payment received' }));
  expect(await screen.findByText(/Paid to your Mobile Money/)).toBeInTheDocument();
  type('Tracking number', 'YG-4471');
  fireEvent.click(screen.getByRole('button', { name: 'Hand over to Yango Delivery' }));
  expect(await screen.findByText('YG-4471')).toBeInTheDocument();
  expect(screen.getAllByText(/Sent with Yango Delivery/).length).toBeGreaterThan(0);
});

test('search understands local words', async () => {
  renderAt('/shop?q=nshima');
  expect(await screen.findByText(/Breakfast Mealie Meal/)).toBeInTheDocument();
});

test('products with sizes ask the buyer to choose before adding to cart', async () => {
  renderAt('/product/p16'); // shirts in sizes S–XXL
  expect(await screen.findByRole('radiogroup', { name: 'Size' })).toBeInTheDocument();
  fireEvent.click(within(document.querySelector('.pdp-buttons')).getByRole('button', { name: 'Add to cart' }));
  expect(screen.getByText('Choose a size')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('zedmarket.cart'))).toEqual([]);

  fireEvent.click(screen.getByRole('radio', { name: 'M' }));
  fireEvent.click(within(document.querySelector('.pdp-buttons')).getByRole('button', { name: 'Add to cart' }));
  expect(JSON.parse(localStorage.getItem('zedmarket.cart'))).toEqual([{ id: 'p16', qty: 1, options: { Size: 'M' } }]);

  fireEvent.click(screen.getByRole('link', { name: /Cart/ }));
  expect(await screen.findByText('Size: M')).toBeInTheDocument();
});

test('delivery prices on the product page follow the quantity being bought', async () => {
  localStorage.setItem('zedmarket.location', JSON.stringify({ province: 'lusaka', town: 'Lusaka' }));
  renderAt('/product/p12'); // 25 kg lithium battery from Ndola
  expect(await screen.findByText(/Prices for 25 kg/)).toBeInTheDocument();
  expect(screen.getByText(/Too heavy for/)).toBeInTheDocument();
});

test('buyers can rate an item after delivery, once', async () => {
  api.__signIn({ name: 'Chanda', phone: '0977000111' });
  const order = await api.placeOrder({
    items: [{ productId: 'p10', qty: 1 }],
    shipping: { name: 'Chanda', phone: '0977000111', province: 'lusaka', town: 'Lusaka', address: 'Plot 1' },
    couriers: { s2: 'pickup' },
    payment: 'momo',
  });
  api.__db().orders[0].shipments[0].status = 'delivered';

  renderAt('/account');
  fireEvent.click(await screen.findByRole('button', { name: '★ Rate this item' }));
  fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
  fireEvent.change(screen.getByLabelText('Your review'), { target: { value: 'Works well in load-shedding' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post review' }));

  expect(await screen.findByText(/You rated/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '★ Rate this item' })).not.toBeInTheDocument();
  const review = api.__db().reviews[0];
  expect(review).toMatchObject({ orderId: order.id, productId: 'p10', rating: 4, author: 'Chanda' });
});

test('a shop owner without a shop sees a setup prompt on their account', async () => {
  api.__signIn({ name: 'Bupe', phone: '0966000111', accountType: 'seller' });
  renderAt('/account');
  expect(await screen.findByText('Finish setting up your shop')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Set up my shop' })).toHaveAttribute('href', '/sell#register');
});

test.each([
  '/wholesale',
  '/shop?q=solar',
  '/product/p10',
  '/cart',
  '/stores',
  '/stores?prov=luapula',
  '/store/s13',
  '/delivery',
  '/logistics',
  '/sell',
  '/seller',
  '/login',
  '/account',
  '/nowhere',
])('%s renders without crashing', async (path) => {
  renderAt(path);
  await waitFor(() => expect(document.querySelector('.status-bar')).not.toBeInTheDocument());
  expect(document.querySelector('main').textContent.length).toBeGreaterThan(10);
});

test('the shop owners QR code opens sign-up ready for a shop owner', async () => {
  renderAt('/login?join=seller');
  expect(await screen.findByLabelText('I am a')).toHaveValue('seller');
  expect(screen.getByLabelText('Full name')).toBeInTheDocument(); // the sign-up form, not sign-in
});
