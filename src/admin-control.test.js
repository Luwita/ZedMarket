import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as api from './api';
import App from './App';

const renderAt = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

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
      couriers: ['pickup', 'seller'],
    },
  });
  const ownerToken = api.__signIn({ name: 'Noah', phone: '0976557939', admin: true, email: 'noah@example.com', password: 'Noah-pass-1' });
  return { sellerToken, ownerToken };
}

test('a staff account signs in to the admin panel and cannot open a shop', async () => {
  setup();
  api.setToken(null);
  const page = renderAt('/login');
  type(await screen.findByLabelText('Email').then(() => 'Email'), 'noah@example.com');
  type('Password', 'Noah-pass-1');
  fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1));
  expect(await screen.findByText('Needs attention')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/admin');
  page.unmount();

  renderAt('/sell#register');
  expect(await screen.findByText("Staff accounts can't have a shop")).toBeInTheDocument();
});

test('staff fix a shop’s details with a reason the shop sees', async () => {
  const { ownerToken } = setup();
  api.setToken(ownerToken);
  renderAt('/admin?tab=shops');
  fireEvent.change(await screen.findByLabelText('Status'), { target: { value: '' } });
  const card = (await screen.findByRole('link', { name: 'Mutinta Appliances' })).closest('.order');
  fireEvent.click(within(card).getByRole('button', { name: 'Edit details' }));
  type(await screen.findByLabelText(/Reason for the change/).then(() => /Reason for the change/), 'Name as on PACRA certificate');
  type('Shop name', 'Mutinta Home Appliances');
  fireEvent.click(screen.getByRole('button', { name: 'Save shop details' }));
  await waitFor(() => expect(api.__db().shops.find((s) => s.id === 'shop_fans').name).toBe('Mutinta Home Appliances'));
  expect(api.__db().notifications[0].title).toBe('Zed Market updated your shop details');
});

test('only owners add staff and change settings', async () => {
  const { ownerToken } = setup();
  api.setToken(ownerToken);
  const owner = renderAt('/admin?tab=staff');
  type(await screen.findByLabelText('Staff email').then(() => 'Staff email'), 'mapalo@example.com');
  type('Staff name', 'Mapalo');
  fireEvent.click(screen.getByRole('button', { name: 'Add staff' }));
  expect(await screen.findByText('Mapalo')).toBeInTheDocument();
  owner.unmount();

  const settings = renderAt('/admin?tab=settings');
  type(await screen.findByLabelText('Commission on goods sold (%)').then(() => 'Commission on goods sold (%)'), '7.5');
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(api.__db().settings.commissionRate).toBe(0.075));
  settings.unmount();

  // The new staff member can see the settings but not change them.
  const staffUser = api.__db().users.find((u) => u.name === 'Mapalo');
  api.__db().sessions.tok_staff = staffUser.id;
  api.setToken('tok_staff');
  renderAt('/admin?tab=settings');
  expect(await screen.findByText('Only owners can change these.')).toBeInTheDocument();
  expect(screen.getByLabelText('Commission on goods sold (%)')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
});

test('staff mark a parcel delivered for a shop', async () => {
  const { ownerToken } = setup();
  api.__db().orders.push({
    id: 'ZM-PHONE1',
    buyerId: 'usr_1',
    date: new Date().toISOString(),
    buyer: { name: 'Chipo', phone: '0966111000' },
    payment: 'MTN Mobile Money',
    paid: true,
    total: 500,
    shipping: { province: 'lusaka', town: 'Lusaka' },
    shipments: [{ shopId: 'shop_fans', shopName: 'Mutinta Appliances', status: 'dispatched', courierName: 'Platinum', items: [] }],
  });
  api.setToken(ownerToken);
  renderAt('/admin?tab=orders');
  const order = (await screen.findByText('ZM-PHONE1')).closest('.order');
  fireEvent.click(within(order).getByRole('button', { name: 'Mark as delivered' }));
  type('Mark as delivered: reason', 'Platinum confirmed by phone');
  fireEvent.click(within(order).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.__db().orders[0].shipments[0].status).toBe('delivered'));
});

test('a shop owner whose shop is waiting for approval finds it after signing in', async () => {
  api.__signIn({
    name: 'Bwalya',
    phone: '0977157869',
    email: 'bwalya@example.com',
    password: 'Bwalya-pass-1',
    accountType: 'seller',
    shop: { id: 'shop_new', name: 'Bwalya Hardware', province: 'copperbelt', town: 'Kitwe', area: 'Chisokone', phone: '0977157869', couriers: ['pickup'], verification: 'pending', verified: false },
  });
  api.setToken(null); // the page opens signed out, so only approved shops are loaded

  renderAt('/login?next=/seller');
  type(await screen.findByLabelText('Email').then(() => 'Email'), 'bwalya@example.com');
  type('Password', 'Bwalya-pass-1');
  fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1));

  expect(await screen.findByRole('heading', { name: /Bwalya Hardware/ })).toBeInTheDocument();
  expect(screen.queryByText("You don't have a shop yet")).not.toBeInTheDocument();
});

test('the owner sets a real courier price and buyers see it at checkout', async () => {
  const { ownerToken } = setup();
  api.__addProduct({ id: 'prd_fan', shopId: 'shop_fans', name: 'Standing Fan', category: 'home', price: 500, stock: 10, weightKg: 2 });
  api.__db().shops.find((s) => s.id === 'shop_fans').couriers = ['pickup', 'yango'];

  api.setToken(ownerToken);
  const owner = renderAt('/admin?tab=delivery');
  expect((await screen.findAllByText(/Starting values, not confirmed/)).length).toBeGreaterThan(0);
  // Yango is priced by distance: K20 for the first km, then K4.95/km over a typical 8 km trip = K54.65 → K55.
  type('Yango Delivery Motorbike: Minimum fare (K)', '20');
  fireEvent.click(screen.getByRole('button', { name: 'Save Yango Delivery' }));
  await waitFor(() => expect(api.__db().delivery.couriers.yango.distance.moto.minFare).toBe('20'));
  owner.unmount();

  const buyerToken = api.__signIn({ name: 'Chipo Banda', phone: '0966111000' });
  api.setToken(buyerToken);
  localStorage.setItem('zedmarket.location', JSON.stringify({ province: 'lusaka', town: 'Lusaka' }));
  localStorage.setItem('zedmarket.cart', JSON.stringify([{ id: 'prd_fan', qty: 1 }]));
  renderAt('/checkout');
  const yango = (await screen.findByLabelText(/Yango Delivery/)).closest('label');
  expect(within(yango).getByText('K55')).toBeInTheDocument();
});

test('an owner deletes a shop with a reason, and it leaves the marketplace', async () => {
  api.__signIn({
    name: 'Mutinta',
    phone: '0977700700',
    accountType: 'seller',
    shop: { id: 'shop_fans', name: 'Mutinta Appliances', province: 'lusaka', town: 'Lusaka', area: 'Cairo Road', phone: '0977700700', couriers: ['pickup'] },
  });
  api.__signIn({ name: 'Owner', phone: '0955000000', admin: true });

  renderAt('/admin?tab=shops');
  fireEvent.change(await screen.findByLabelText('Status'), { target: { value: '' } });
  const card = (await screen.findByRole('link', { name: 'Mutinta Appliances' })).closest('.order');
  fireEvent.click(within(card).getByRole('button', { name: 'Delete shop' }));
  type('Delete shop: reason', 'Owner asked to close');
  fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Mutinta Appliances' })).not.toBeInTheDocument());
  expect(api.__db().shops.some((s) => s.id === 'shop_fans')).toBe(false);
  expect(api.__db().notifications[0].title).toBe('Zed Market removed your shop Mutinta Appliances');

  // Without reloading the page, the shop is gone from the list of shops too.
  fireEvent.click(screen.getAllByRole('link', { name: 'Shops' })[0]);
  expect(await screen.findByRole('heading', { name: 'Shops across Zambia' })).toBeInTheDocument();
  expect(screen.queryByText('Mutinta Appliances')).not.toBeInTheDocument();
});

test('staff confirm a Mobile Money payment for a shop before the parcel can be sent', async () => {
  const { ownerToken } = setup();
  api.__db().orders.push({
    id: 'ZM-MOMO2',
    buyerId: 'usr_1',
    date: new Date().toISOString(),
    buyer: { name: 'Chipo', phone: '0966111000' },
    payment: 'Mobile Money',
    payByMomo: true,
    paid: false,
    total: 500,
    shipping: { province: 'lusaka', town: 'Lusaka' },
    shipments: [{ shopId: 'shop_fans', shopName: 'Mutinta Appliances', status: 'pending', paid: false, courierName: 'Collect from shop', items: [] }],
  });
  api.setToken(ownerToken);
  renderAt('/admin?tab=orders');
  const order = (await screen.findByText('ZM-MOMO2')).closest('.order');
  expect(within(order).getByText(/not paid yet/)).toBeInTheDocument();
  expect(within(order).queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument();
  fireEvent.click(within(order).getByRole('button', { name: 'Payment received' }));
  type('Payment received: reason', 'Shop confirmed by phone');
  fireEvent.click(within(order).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.__db().orders[0].shipments[0].paid).toBe(true));
  expect(await within(order).findByRole('button', { name: 'Mark as sent' })).toBeInTheDocument();
});

test("every shop has its own QR code linking to its shop page", async () => {
  const { sellerToken } = setup();
  api.setToken(sellerToken);
  renderAt('/seller?tab=promotions');
  expect(await screen.findByText(/Your shop's QR code/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: `${window.location.origin}/store/shop_fans` })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download poster (PNG)' })).toBeInTheDocument();
});

test("an owner deletes a customer's account; shop owners and staff can't be deleted there", async () => {
  api.__signIn({
    name: 'Mutinta',
    phone: '0977700700',
    accountType: 'seller',
    shop: { id: 'shop_fans', name: 'Mutinta Appliances', province: 'lusaka', town: 'Lusaka', area: 'Cairo Road', phone: '0977700700', couriers: ['pickup'] },
  });
  api.__signIn({ name: 'Fake Buyer', phone: '0966777888' });
  api.__signIn({ name: 'Owner', phone: '0955000000', admin: true });

  renderAt('/admin?tab=users');
  const row = (await screen.findByText('Fake Buyer')).closest('tr');
  const seller = screen.getByText('Mutinta').closest('tr');
  expect(within(seller).queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  expect(within(screen.getByText('0955000000').closest('tr')).queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();

  fireEvent.click(within(row).getByRole('button', { name: 'Delete account' }));
  type('Delete account: reason', 'Fake orders');
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText("Fake Buyer's account deleted")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Fake Buyer')).not.toBeInTheDocument());
  expect(api.__db().users.some((u) => u.name === 'Fake Buyer')).toBe(false);
});

test('staff do not see Delete account', async () => {
  api.__signIn({ name: 'Fake Buyer', phone: '0966777888' });
  api.__signIn({ name: 'Mapalo', phone: '0955111222' });
  api.__db().users.find((u) => u.name === 'Mapalo').staff = true;

  renderAt('/admin?tab=users');
  const row = (await screen.findByText('Fake Buyer')).closest('tr');
  expect(within(row).getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
});
