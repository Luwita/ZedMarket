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
      couriers: ['pickup'],
    },
  });
  const buyerToken = api.__signIn({ name: 'Chipo Banda', phone: '0966111000' });
  const staffToken = api.__signIn({ name: 'Staff', phone: '0955000000', admin: true });
  return { sellerToken, buyerToken, staffToken };
}

test('staff publish a home page banner and it leads the slideshow', async () => {
  const { staffToken } = setup();
  api.setToken(staffToken);
  const staff = renderAt('/admin?tab=marketing');
  type(await screen.findByLabelText('Banner title').then(() => 'Banner title'), 'Independence Day deals');
  type('Opens', '/shop?sort=deals');
  expect(screen.getAllByText('Independence Day deals').length).toBeGreaterThan(0); // live preview
  fireEvent.click(screen.getByRole('button', { name: 'Publish banner' }));
  expect(await screen.findByText(/^Live/)).toBeInTheDocument();
  staff.unmount();

  renderAt('/');
  expect(await screen.findByRole('heading', { name: 'Independence Day deals' })).toBeInTheDocument();
});

test('staff send a voucher to one customer, who finds it with the campaign name', async () => {
  const { staffToken, buyerToken } = setup();
  api.setToken(staffToken);
  const staff = renderAt('/admin?tab=marketing');
  type(await screen.findByLabelText(/Campaign name/).then(() => /Campaign name/), 'Sorry for the delay');
  type('Voucher (K)', '40');
  fireEvent.change(screen.getByLabelText('Send to', { selector: '#vc-aud' }), { target: { value: 'phone' } });
  type("Customer's phone", '0966111000');
  fireEvent.click(screen.getByRole('button', { name: 'Send vouchers' }));
  expect(await screen.findByText(/1 sent · 0 used/)).toBeInTheDocument();
  staff.unmount();

  api.setToken(buyerToken);
  renderAt('/account?tab=invite');
  expect(await screen.findByText('Sorry for the delay')).toBeInTheDocument();
  expect(screen.getByText('K40')).toBeInTheDocument();
});

test('sending vouchers to a whole group asks for confirmation first', async () => {
  const { staffToken } = setup();
  api.setToken(staffToken);
  renderAt('/admin?tab=marketing');
  type(await screen.findByLabelText(/Campaign name/).then(() => /Campaign name/), 'Everyone');
  fireEvent.click(screen.getByRole('button', { name: 'Send vouchers' }));
  expect(api.__db().vouchers).toHaveLength(0);
  fireEvent.click(await screen.findByRole('button', { name: /Confirm: send K30 to everyone/ }));
  await waitFor(() => expect(api.__db().vouchers).toHaveLength(3));
});

test('staff pay a shop and the shop sees it in its dashboard', async () => {
  const { staffToken, sellerToken } = setup();
  api.__db().orders.push({
    id: 'ZM-PAID1',
    buyerId: 'usr_2',
    paid: true,
    total: 500,
    shipping: { province: 'lusaka', town: 'Lusaka' },
    shipments: [{ shopId: 'shop_fans', status: 'delivered', subtotal: 500, discount: 0, fee: 0, items: [] }],
  });

  api.setToken(staffToken);
  const staff = renderAt('/admin?tab=payouts');
  const row = (await screen.findByRole('link', { name: 'Mutinta Appliances' })).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: 'Pay K475' }));
  type('Reference', 'MP261004.1530');
  fireEvent.click(within(row).getByRole('button', { name: 'Record payout' }));
  expect(await screen.findByText(/MTN MoMo MP261004.1530/)).toBeInTheDocument();
  staff.unmount();

  api.setToken(sellerToken);
  renderAt('/seller?tab=report');
  expect(await screen.findByText('Your money')).toBeInTheDocument();
  expect(screen.getByText(/MP261004.1530/)).toBeInTheDocument();
  expect(api.__db().notifications[0].title).toBe('Zed Market paid you K475');
});

test('staff take down a buying request with a reason', async () => {
  const { staffToken, buyerToken } = setup();
  api.setToken(buyerToken);
  await api.postBuyingRequest({ title: 'Cheap phones, WhatsApp me', qty: 5, province: 'lusaka', town: 'Lusaka' });

  api.setToken(staffToken);
  renderAt('/admin?tab=requests');
  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
  type('Remove: reason', 'Contact details in the title');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.__db().requests[0].status).toBe('removed'));
  expect(await screen.findByText('Nothing here.')).toBeInTheDocument();
});

test('a shop paid directly sees the commission it owes; staff record it when it is paid', async () => {
  const { staffToken, sellerToken } = setup();
  // A K500 parcel the buyer paid the shop for by Mobile Money: the shop owes the K25 commission.
  api.__db().orders.push({
    id: 'ZM-MOMO1',
    buyerId: 'usr_2',
    payByMomo: true,
    paid: true,
    total: 500,
    shipping: { province: 'lusaka', town: 'Lusaka' },
    shipments: [{ shopId: 'shop_fans', status: 'delivered', paid: true, subtotal: 500, discount: 0, fee: 0, items: [] }],
  });
  api.setToken(staffToken);
  await api.admin.saveCommissionAccount({ network: 'airtel', number: '0977000999', name: 'Zed Market Ltd' });

  api.setToken(sellerToken);
  const shop = renderAt('/seller?tab=report');
  expect(await screen.findByText('Send K25 to Zed Market')).toBeInTheDocument();
  expect(screen.getByText('0977000999')).toBeInTheDocument();
  shop.unmount();

  api.setToken(staffToken);
  const staff = renderAt('/admin?tab=payouts');
  const row = (await screen.findByRole('link', { name: 'Mutinta Appliances' })).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: 'Commission received' }));
  expect(within(row).getByLabelText('Amount')).toHaveValue(25);
  type('Reference', 'MP261013.0800');
  fireEvent.click(within(row).getByRole('button', { name: 'Record commission' }));
  expect(await screen.findByText(/commission from Mutinta Appliances/)).toBeInTheDocument();
  staff.unmount();

  api.setToken(sellerToken);
  renderAt('/seller?tab=report');
  expect(await screen.findByText(/commission you paid/)).toBeInTheDocument();
  expect(screen.queryByText(/to Zed Market$/)).not.toBeInTheDocument();
  expect(api.__db().notifications[0].title).toBe('Zed Market received your K25 commission');
});
