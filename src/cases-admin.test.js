import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as api from './api';
import App from './App';

const renderAt = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const shopDetails = {
  id: 'shop_fans',
  name: 'Mutinta Appliances',
  province: 'lusaka',
  town: 'Lusaka',
  area: 'Cairo Road',
  phone: '0977700700',
  couriers: ['pickup', 'yango'],
};

// A Lusaka shop, a buyer, and an order of 2 fans (K1000 + K45 Yango), paid by MTN.
async function setup() {
  const sellerToken = api.__signIn({ name: 'Mutinta', phone: '0977700700', accountType: 'seller', shop: shopDetails });
  api.__addProduct({
    id: 'prd_fan',
    shopId: 'shop_fans',
    name: 'Standing Fan',
    category: 'home',
    price: 500,
    stock: 10,
  });
  const buyerToken = api.__signIn({ name: 'Chipo', phone: '0966111000' });
  const order = await api.placeOrder({
    items: [{ productId: 'prd_fan', qty: 2 }],
    shipping: { name: 'Chipo', phone: '0966111000', province: 'lusaka', town: 'Lusaka', address: 'Plot 3' },
    couriers: { shop_fans: 'yango' },
    payment: 'momo',
  });
  // The shop confirms the buyer's Mobile Money arrived.
  api.setToken(sellerToken);
  await api.confirmPayment(order.id, 'shop_fans');
  api.setToken(buyerToken);
  return { sellerToken, buyerToken, order };
}

test('a buyer cancels a parcel before it is sent and is told about the refund', async () => {
  await setup();
  renderAt('/account');
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel this parcel' }));
  type('Why are you cancelling?', 'Changed my mind');
  fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
  expect(await screen.findByText(/Cancelled by you/)).toBeInTheDocument();
  expect(screen.getByText(/Refund of K1,045 on its way/)).toBeInTheDocument();
  expect(api.__db().products.find((p) => p.id === 'prd_fan').stock).toBe(10);
});

test('a shop cancels an order it cannot fill', async () => {
  const { sellerToken } = await setup();
  api.setToken(sellerToken);
  renderAt('/seller?tab=orders');
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
  type(/Why are you cancelling/, 'Out of stock');
  fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
  expect(await screen.findByText(/Cancelled by you/)).toBeInTheDocument();
  expect(api.__db().orders[0].shipments[0]).toMatchObject({ status: 'cancelled', cancelledBy: 'seller' });
});

test('return: buyer reports a fault, shop rejects, buyer escalates, staff refund', async () => {
  const { sellerToken, buyerToken, order } = await setup();
  Object.assign(api.__db().orders[0].shipments[0], { status: 'delivered', deliveredAt: new Date().toISOString() });

  // Buyer reports the problem.
  const buyer = renderAt('/account');
  fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));
  type('Reason', 'faulty');
  type('How many Standing Fan', '1');
  type('Tell the shop more', 'Stops after 10 minutes');
  fireEvent.click(screen.getByRole('button', { name: 'Send to the shop' }));
  expect(await screen.findByRole('link', { name: 'Waiting for the shop' })).toBeInTheDocument();
  const caseId = api.__db().cases[0].id;
  expect(api.__db().cases[0].items).toEqual([{ productId: 'prd_fan', qty: 1, name: 'Standing Fan' }]);
  buyer.unmount();

  // Shop rejects it from the Returns tab.
  api.setToken(sellerToken);
  const shop = renderAt('/seller?tab=returns');
  fireEvent.click(await screen.findByText(/Faulty/));
  await screen.findByText('Your answer');
  type('Message to the buyer', 'It worked when we sent it');
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(await screen.findByText('Rejected by the shop')).toBeInTheDocument();
  shop.unmount();

  // Buyer escalates from the case page.
  api.setToken(buyerToken);
  const again = renderAt(`/cases/${caseId}`);
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Zed Market to step in' }));
  expect(await screen.findByText('With Zed Market')).toBeInTheDocument();
  again.unmount();

  // Staff decide.
  api.__signIn({ name: 'Staff', phone: '0950000001', admin: true });
  renderAt('/admin?tab=cases');
  const card = (await screen.findByText(order.id, { exact: false })).closest('.order');
  fireEvent.change(within(card).getByLabelText('Refund amount'), { target: { value: '500' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Refund buyer' }));
  fireEvent.change(within(card).getByLabelText('Refund buyer: reason'), { target: { value: 'Photos show the fault' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.__db().cases[0]).toMatchObject({ status: 'resolved', refundAmount: 500 }));
  expect(api.__db().refunds).toEqual([expect.objectContaining({ amount: 500, reason: 'return', status: 'due' })]);
});

test('a shop that was not approved sees why, fixes its details and is approved', async () => {
  const { sellerToken } = await setup();
  Object.assign(api.__db().shops.find((s) => s.id === 'shop_fans'), {
    verification: 'rejected',
    verified: false,
    verificationNote: 'NRC number does not match the name',
  });
  api.setToken(sellerToken);
  const seller = renderAt('/seller');
  expect(await screen.findByText(/NRC number does not match the name/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Shop & delivery' }));
  type(await screen.findByLabelText('Full name (as on your NRC)').then(() => 'Full name (as on your NRC)'), 'Mutinta Hamoonga');
  type('NRC number', '12345');
  fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
  expect(await screen.findByText('Enter your NRC number like 123456/78/1')).toBeInTheDocument();
  type('NRC number', '123456/78/1');
  fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
  expect(await screen.findByText(/Waiting for approval \(usually/)).toBeInTheDocument();
  seller.unmount();

  api.__signIn({ name: 'Staff', phone: '0950000001', admin: true });
  renderAt('/admin?tab=shops');
  const card = (await screen.findByRole('link', { name: 'Mutinta Appliances' })).closest('.order');
  expect(within(card).getByText(/123456\/78\/1/)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(api.__db().shops.find((s) => s.id === 'shop_fans').verification).toBe('verified'));
  expect(api.__db().actions[0]).toMatchObject({ action: 'shop verified', admin: 'Staff' });
});

test('staff remove a listing and the seller sees why', async () => {
  const { sellerToken } = await setup();
  api.__signIn({ name: 'Staff', phone: '0950000001', admin: true });
  const staff = renderAt('/admin?tab=products');
  const row = (await screen.findByRole('link', { name: 'Standing Fan' })).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
  fireEvent.change(within(row).getByLabelText('Remove: reason'), {
    target: { value: 'Photo shows a different brand' },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.__db().products.find((p) => p.id === 'prd_fan').removedReason).toBeTruthy());
  staff.unmount();

  api.setToken(sellerToken);
  renderAt('/seller');
  expect(await screen.findByText(/Photo shows a different brand/)).toBeInTheDocument();
});

test('the admin panel is for staff only', async () => {
  api.__signIn({ name: 'Chipo', phone: '0966111000' });
  renderAt('/admin');
  expect(await screen.findByText('This page is for Zed Market staff.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Admin/ })).not.toBeInTheDocument();
});

test('staff see the overview and an Admin link', async () => {
  await setup();
  api.__signIn({ name: 'Staff', phone: '0950000001', admin: true });
  renderAt('/admin');
  expect(await screen.findByText('Needs attention')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Admin/ }).length).toBeGreaterThan(0);
  expect(screen.queryByRole('link', { name: 'Open a shop' })).not.toBeInTheDocument(); // staff accounts don't sell
  for (const tab of ['Shops', 'Listings', 'Reviews', 'Users', 'Orders', 'Disputes', 'Refunds', 'Payouts', 'Staff', 'Settings', 'Activity log']) {
    fireEvent.click(screen.getByRole('button', { name: tab }));
    await waitFor(() => expect(document.querySelector('.admin').textContent.length).toBeGreaterThan(50));
  }
});
