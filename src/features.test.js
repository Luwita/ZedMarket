import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as api from './api';
import App from './App';

const renderAt = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

// A Lusaka shop selling fans and lamps (usr_1), and a signed-in buyer in Lusaka (usr_2).
function setup() {
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
    },
  });
  const product = { shopId: 'shop_fans', category: 'home', stock: 100, weightKg: 1 };
  api.__addProduct({ ...product, id: 'prd_fan', name: 'Standing Fan', price: 500 });
  api.__addProduct({ ...product, id: 'prd_lamp', name: 'Desk Lamp', price: 100 });
  const buyerToken = api.__signIn({ name: 'Chipo Banda', phone: '0966111000' });
  localStorage.setItem('zedmarket.location', JSON.stringify({ province: 'lusaka', town: 'Lusaka' }));
  return { sellerToken, buyerToken };
}

test('only ticked cart items are bought, and a Zed Market voucher lowers the total', async () => {
  setup();
  api.__addVoucher('usr_2', 50);
  localStorage.setItem(
    'zedmarket.cart',
    JSON.stringify([
      { id: 'prd_fan', qty: 1 },
      { id: 'prd_lamp', qty: 1, selected: false },
    ]),
  );
  renderAt('/cart');
  expect(await screen.findByText('1 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Checkout (1)' }));

  type(await screen.findByLabelText('Street address or landmark').then(() => 'Street address or landmark'), 'Plot 9');
  fireEvent.click(screen.getByLabelText(/Collect from shop/));
  expect(screen.queryByText(/Desk Lamp/)).not.toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText('Voucher'), { target: { value: 'vch_1' } });
  expect(await screen.findByText('Zed Market voucher')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Place order · K450' })); // K500 − K50 voucher
  expect(await screen.findByText(/One more step: pay the shop/)).toBeInTheDocument();

  expect(api.__db().vouchers[0].usedOrderId).toBe('ZM-TEST1');
  expect(JSON.parse(localStorage.getItem('zedmarket.cart'))).toEqual([{ id: 'prd_lamp', qty: 1, selected: false }]);
});

test('a voucher needs the minimum spend', async () => {
  setup();
  api.__addVoucher('usr_2', 50);
  localStorage.setItem('zedmarket.cart', JSON.stringify([{ id: 'prd_lamp', qty: 1 }]));
  renderAt('/checkout');
  fireEvent.change(await screen.findByLabelText('Voucher'), { target: { value: 'vch_1' } });
  expect(await screen.findByText('Spend at least K300 on products to use this voucher')).toBeInTheDocument();
});

test('a customer asks Zed Market for help, staff reply, and the bell shows it', async () => {
  const { buyerToken } = setup();
  const adminToken = api.__signIn({ name: 'Staff', phone: '0955000000', admin: true });

  api.setToken(buyerToken);
  const buyer = renderAt('/help');
  await screen.findByLabelText('What is it about?');
  type('What is it about?', 'Parcel not arrived');
  type('Your message', 'Order ZM-1 has not arrived yet');
  fireEvent.click(screen.getByRole('button', { name: 'Send to Zed Market' }));
  expect(await screen.findByText('Order ZM-1 has not arrived yet')).toBeInTheDocument();
  buyer.unmount();

  api.setToken(adminToken);
  const staff = renderAt('/admin?tab=support');
  fireEvent.click(await screen.findByRole('button', { name: /Parcel not arrived/ }));
  type(await screen.findByLabelText('Reply').then(() => 'Reply'), 'It is with Yango today.');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(api.__db().tickets[0].messages).toHaveLength(2));
  staff.unmount();

  api.setToken(buyerToken);
  renderAt('/');
  const bell = await screen.findByRole('link', { name: /Alerts/ });
  await waitFor(() => expect(within(bell).getByText('1')).toBeInTheDocument());
  fireEvent.click(bell);
  fireEvent.click(await screen.findByRole('button', { name: /Zed Market replied to your question/ }));
  expect(await screen.findByText('It is with Yango today.')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/help/tkt_1');
  expect(api.__db().notifications[0].read).toBe(true);
});

test('a buyer posts a buying request, a shop sends an offer and the buyer accepts it', async () => {
  const { sellerToken, buyerToken } = setup();

  api.setToken(buyerToken);
  const buyer = renderAt('/requests');
  fireEvent.click(await screen.findByRole('button', { name: '+ Post a request' }));
  type('Title', '20 standing fans');
  type('Quantity', '20');
  fireEvent.click(screen.getByRole('button', { name: 'Post request' }));
  expect(await screen.findByRole('heading', { name: '20 standing fans' })).toBeInTheDocument();
  buyer.unmount();

  api.setToken(sellerToken);
  const seller = renderAt('/requests');
  fireEvent.click(await screen.findByRole('link', { name: /20 standing fans/ }));
  type(await screen.findByLabelText('Your price per unit (K)').then(() => 'Your price per unit (K)'), '450');
  expect(screen.getByText(/Total K9,000/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
  expect(await screen.findByText(/Your offer:/)).toBeInTheDocument();
  seller.unmount();

  api.setToken(buyerToken);
  renderAt('/requests/brq_1');
  expect(await screen.findByRole('link', { name: 'Mutinta Appliances' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  expect(await screen.findByText('closed')).toBeInTheDocument();
  expect(api.__db().requests[0].acceptedOfferId).toBe('ofr_shop_fans');
});

test('joining with an invite link gives the new customer a welcome voucher', async () => {
  api.__signIn({ name: 'Inviter', phone: '0977123123' }); // invite code ZMTEST1
  api.setToken(null);

  renderAt('/login?ref=zmtest1');
  expect(await screen.findByLabelText('Invite code (optional)')).toHaveValue('ZMTEST1');
  type('Full name', 'Natasha Mwale');
  type('Email', 'natasha@example.com');
  type('Password', 'Natasha-2026');
  fireEvent.click(screen.getAllByRole('button', { name: 'Create account' }).at(-1));
  // Clerk emails a code to confirm the address.
  type(await screen.findByLabelText('6-digit code').then(() => '6-digit code'), '123456');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  await waitFor(() => expect(api.__db().vouchers).toHaveLength(1));
  expect(api.__db().users[1].referredBy).toBe('usr_1');

  fireEvent.click(await screen.findByRole('button', { name: 'Invite & vouchers' }));
  expect(await screen.findByText('Welcome gift')).toBeInTheDocument();
  expect(screen.getByText('ZM000002')).toBeInTheDocument(); // her own code to share
});

test('a seller resells another shop’s product with a margin', async () => {
  const { sellerToken } = setup();
  api.__signIn({
    name: 'Bwalya',
    phone: '0977888999',
    accountType: 'seller',
    shop: { id: 'shop_kabwe', name: 'Bwalya Stores', province: 'central', town: 'Kabwe', area: 'Town', phone: '0977888999', couriers: ['pickup', 'seller'] },
  });
  expect(sellerToken).toBeTruthy();

  renderAt('/product/prd_fan');
  fireEvent.click(await screen.findByRole('link', { name: /Resell in my shop/ }));
  expect(await screen.findByText(/We've added a 15% margin/)).toBeInTheDocument();
  expect(screen.getByLabelText('Price (K)')).toHaveValue(575);
  type('Quantity in stock', '5');
  fireEvent.click(screen.getByRole('button', { name: 'List in my shop' }));
  await waitFor(() => expect(document.querySelector('.error')).toBeNull());
  await waitFor(() => expect(api.__db().products.some((p) => p.shopId === 'shop_kabwe' && p.sourceProductId === 'prd_fan')).toBe(true));
});

test('a customer changes their password, and resets a forgotten one with an emailed code', async () => {
  api.setToken(null);
  renderAt('/login?join=buyer');
  type(await screen.findByLabelText('Full name').then(() => 'Full name'), 'Mutale Banda');
  type('Email', 'mutale@example.com');
  type('Password', 'First-pass-1');
  fireEvent.click(screen.getAllByRole('button', { name: 'Create account' }).at(-1));
  // Clerk emails a code to confirm the address.
  type(await screen.findByLabelText('6-digit code').then(() => '6-digit code'), '123456');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Password & privacy' }));
  type('Current password', 'wrong-pass-1');
  type('New password', 'Second-pass-2');
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText('Invalid password')).toBeInTheDocument();
  type('Current password', 'First-pass-1');
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  await waitFor(() => expect(api.__db().passwords['mutale@example.com']).toBe('Second-pass-2'));
});

test('forgot password: an emailed code sets a new one and signs in', async () => {
  api.setToken(null);
  renderAt('/login');
  fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
  type('Email', 'nobody');
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
  expect(await screen.findByText('Enter the email address of your account')).toBeInTheDocument();
  type('Email', 'chanda@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
  type(await screen.findByLabelText('6-digit code').then(() => '6-digit code'), '123456');
  type('New password', 'Brand-new-3');
  api.__db().users.push({ id: 'usr_chanda', name: 'Chanda', email: 'chanda@example.com', phone: null, accountType: 'buyer', referralCode: 'ZMCHANDA' });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
  expect(await screen.findByText(/Muli shani, Chanda/)).toBeInTheDocument();
});
