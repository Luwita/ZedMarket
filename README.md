# Zed Market

Zambia's online marketplace for local shops. Buyers shop retail or wholesale from sellers in all 10 provinces,
filter by their province and town, pay in Kwacha, and get orders delivered by Zambian couriers. Shop owners open a
shop, upload products and fulfil orders from a dashboard.

## Run it

```bash
npm install
npm run dev      # React app on http://localhost:3000 + API on http://localhost:4000
```

No database install is needed for development: the API uses [PGlite](https://pglite.dev) (Postgres running inside
Node) and stores data in `server/.data/`. The marketplace starts empty: shop owners sign up and add their
products, and staff approve each shop before buyers can see it. To try it with demo shops and products instead, set
`SEED_DEMO=1` in `server/.env` before the first start.

To remove every shop, product and order (keeping user accounts, staff and settings), stop `npm run dev` and run
`npm run reset:catalog -- --yes`. A backup of the local database is saved in `server/.data/` first. Delete
`server/.data/` to start over completely.

## Sign-in (Clerk)

Accounts are run by [Clerk](https://clerk.com), which has a free plan. There is no SMS: nothing is texted, and Clerk
sends the emails itself.

- **Set it up once:** in the Clerk dashboard create an application with **Email address + Password** and **Google**
  turned on. Under **API keys** copy the *Secret key* into `CLERK_SECRET_KEY` (`server/.env`, or Render) and the
  *Publishable key* into `REACT_APP_CLERK_PUBLISHABLE_KEY` (`.env.local` at the project root, or Render, which must
  have it before the build runs because the website is built with it). Without them nobody can sign in.
- **Sign up** with name, email and password, or with Google. Clerk emails a 6-digit code to confirm the address.
  A sign-in from a new device can also ask for an emailed code. **Forgot password?** emails a code that sets a new
  one; signed-in people change it under My account → Password & privacy.
- **The browser signs in with Clerk directly**; it is downloaded only when someone signs in or comes back signed in,
  so guests browsing on mobile data never fetch it. Every API request carries Clerk's session token, checked here
  with the secret key ([server/clerkAuth.js](server/clerkAuth.js)).
- **ZedMarket's own account** (the `users` table: shop, orders, role) is linked by `users.auth_id` and created on
  the first request, with the email and name read from Clerk. Deleting an account also deletes the Clerk sign-in.
- **Owners** are the `ADMIN_EMAILS` addresses, once Clerk has verified them (on a development computer also before).
  **Staff** are added by owners in the admin Staff tab by the email address they sign in with; they take over that
  account when they sign in with that verified address.
- **Phone numbers** are no longer verified or used to sign in. Shops still give a phone number for buyers to reach
  them. Updates about orders and payments appear in the app under Notifications.
- **Phone app (Expo):** Google refuses sign-in inside app web views, so the phone app uses email and password.

Add the live site's address to Clerk (Domains) and, for Google, follow Clerk's *Social connections → Google* steps.


```bash
npm test             # React tests (use an in-memory fake API)
npm run test:server  # API tests against a real in-memory Postgres
npm run build        # production build of the React app
```

## How it fits together

```
React app (src/)  ──/api──▶  Express API (server/)  ──SQL──▶  Postgres (PGlite locally, hosted in production)
```

- **src/**: the React app. Cart, saved items and the buyer's location stay in the browser; everything else comes
  from the API (`src/api.js`, `src/context/StoreContext.js`).
- **server/**: Express API. `routes/` (catalogue, orders, reviews, seller tools), `queries.js` (search and shared
  SQL), `schemas.js` (request validation), `auth.js` (phone sign-in codes and sessions), `migrations/` (database
  schema, applied automatically on start), `seed.js` (demo data, only with `SEED_DEMO=1`).
- **src/data/**: shared by both sides: provinces and towns, couriers and weight-based delivery pricing, product
  options, search synonyms (`search.js`), platform fees (`fees.js`: commission, VAT, featured-listing limits), and
  `pricing.js`, which prices an order including discount codes and agreed wholesale prices. The server always
  re-prices orders itself; prices sent by the browser are ignored.
- **public/sw.js**: service worker that makes the app installable and keeps viewed pages working offline.
  `scripts/make-icons.js` regenerates the app icons.

### API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/session/me` | signed in: the ZedMarket account |
| POST | `/api/session/welcome` | signed in: name, kind of account and invite code, right after sign-up |
| GET | `/api/shops`, `/api/shops/:id`, `/api/products/:id`, `/api/stats/provinces` | anyone |
| GET | `/api/products?q=&cat=&prov=&town=&shop=&sort=&page=&limit=` | anyone: search, filter, sort, page |
| GET | `/api/products/:id/reviews`, `/api/shops/:id/reviews` | anyone |
| POST | `/api/reviews` | buyer, after the parcel is delivered, once per item per order |
| PATCH | `/api/reviews/:id/reply` | shop owner |
| POST | `/api/products/bulk` | shop owner: up to 200 products; all rows checked, all or nothing |
| GET | `/api/seller/report?days=`, `/api/seller/reviews` | shop owner |
| POST | `/api/shops` | signed in (one shop per account) |
| PATCH | `/api/shops/:id` | shop owner |
| POST/PATCH/DELETE | `/api/products[/:id]` | shop owner, own products only |
| POST | `/api/uploads` | shop owner (JPEG/PNG/WebP, max 1.5 MB) |
| POST | `/api/orders` | signed in: checks stock, prices and courier rules, then reduces stock |
| GET | `/api/orders/mine` | buyer's orders |
| GET | `/api/orders/shop` | parcels for the owner's shop |
| PATCH | `/api/orders/:id/shipments/:shopId` | shop owner: pending → dispatched → delivered |
| POST | `/api/orders/quote` | signed in: exact totals for checkout (codes, agreed prices) without ordering |
| POST | `/api/orders/:id/shipments/:shopId/payment-sent` | buyer: "I've paid" by Mobile Money, with an optional transaction ID |
| POST | `/api/orders/:id/shipments/:shopId/paid` | shop owner: the Mobile Money arrived; the parcel can now be sent |
| GET/POST | `/api/conversations`, `/api/conversations/:id[/messages]`, `/api/conversations/unread` | buyer or shop in the conversation |
| GET/POST/PATCH | `/api/seller/coupons[/:id]` | shop owner: discount codes |
| POST/DELETE | `/api/products/:id/feature` | shop owner: feature on the home page (3 at a time, 7 days) |
| POST/GET/PATCH | `/api/price-requests`, `/mine`, `/shop`, `/:id/respond`, `/:id/accept` | wholesale price requests |
| GET | `/api/seller/statement?month=YYYY-MM` | shop owner: delivered parcels, commission, payout |
| GET/DELETE | `/api/me/export`, `/api/me` | signed in: download or delete your data |
| POST | `/api/orders/:id/shipments/:shopId/cancel` | buyer or shop, before the parcel is sent |
| POST/GET/PATCH | `/api/cases`, `/mine`, `/shop`, `/:id`, `/:id/respond`, `/:id/escalate`, `/:id/withdraw` | returns and missing parcels |
| GET/POST | `/api/seller/verification`, `/api/seller/removed-products` | shop owner |
| * | `/api/admin/...` | staff only (see Admin panel) |

## Configuration and deployment

Copy `server/.env.example` to `server/.env` to change settings. For production:

1. Create a Postgres database (e.g. Neon, Supabase or Render) and set `DATABASE_URL`.
2. Set `NODE_ENV=production`, `ADMIN_EMAILS` and `CLERK_SECRET_KEY`, and build with `REACT_APP_CLERK_PUBLISHABLE_KEY`.
3. `npm run build`, then `npm run server`. The API serves the built app too, so one process is enough.

Product photos are stored in the database, so nothing needs a permanent disk. Node.js 22.9 or newer is needed.

### Render + Neon

Use a Neon project in Frankfurt (`aws-eu-central-1`) and a Render service in Frankfurt, next to each other and the
closest region to Zambia. Give the live site the Neon project's `production` branch, and this computer a separate
`development` branch, so testing here never touches live data. `scripts/copy-database.js` copies all data between two
databases (e.g. to move the live database to another region).

`neon env pull` (or `neon deploy`) writes `DATABASE_URL` (pooled, for the app) and `DATABASE_URL_UNPOOLED` (direct,
for database updates) to `.env.local`, which `npm run server` and `npm run dev` load after `server/.env`. With them
set, this computer uses that Neon database instead of the local one; without `.env.local` it uses the local database
in `server/.data/`. `npm run reset:catalog` only ever touches the local database.

[render.yaml](render.yaml) describes the service (`zedmarket`, Frankfurt). In Render choose **New → Blueprint**, pick
this repository, and fill in the settings it asks for: `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (the
`production` branch's addresses, pasted without quotes), `ADMIN_EMAILS`, `CLERK_SECRET_KEY` and `REACT_APP_CLERK_PUBLISHABLE_KEY`. In
production the server refuses to start without a `postgresql://` `DATABASE_URL`, and says so in the log. Every push to `main` deploys again; database changes are applied automatically when the server
starts. On Render's free plan the server sleeps after a while without visitors and takes up to a minute to wake.

The app can be installed on phones ("Add to home screen" / the Install button) once it is served over HTTPS.
The service worker only runs in production builds, so it never serves stale files during development.

## Expo app (iPhone and Android)

`mobile/` is an [Expo](https://expo.dev) app. It shows the phone layout of the web app full-screen from the Zed
Market server and adds the phone-app parts around it ([mobile/App.js](mobile/App.js)): safe areas, a launch screen,
the Android back button, the phone's share sheet, printing receipts, opening WhatsApp/phone/maps links in their own
apps, and a "can't connect" screen.

The phone layout itself is in the web app: [src/pages/HomeApp.js](src/pages/HomeApp.js) (banner, shortcuts,
categories, Retail/Wholesale feed), [src/components/TabBar.js](src/components/TabBar.js) and
[src/mobile.css](src/mobile.css). Going back to a list returns to the same place in it.

Expo Go on an iPhone only opens the project when the terminal (`npx expo login`) and Expo Go are signed in to the
same Expo account. If `npx expo login` crashes on Windows while opening the browser, run
`npx expo login -u your-username` instead.

To run it on your own phone, install **Expo Go** from the App Store or Play Store, connect the phone to the same
Wi-Fi as this computer, then:

```bash
npm run build && npm run server      # terminal 1: the website and API on port 4000
cd mobile && npm install && npx expo start   # terminal 2: shows a QR code
```

Scan the QR code (iPhone: Camera app; Android: inside Expo Go). The app finds the server on this computer by
itself. After changing the web app, run `npm run build` again and reopen the app.

For the App Store and Google Play, set `EXPO_PUBLIC_WEB_URL` to the hosted `https://` address
(see [mobile/.env.example](mobile/.env.example)) and build in Expo's cloud with `npx eas-cli@latest build`; no Mac
is needed for the build, but the App Store needs an Apple Developer account.

## Payments

Zed Market never holds a buyer's money: buyers pay the shop directly, and the shop moves the order along once it
has the money. Buyers choose one of two ways to pay:

- **Mobile Money, straight to the shop.** Every shop gives a Mobile Money number (network, number and the name it
  is registered in) when it opens; a shop can't be saved without one. After ordering, the buyer is shown and texted
  that number with the amount for each shop, sends the money, and taps **I've paid** (with the transaction ID if
  they have it). The shop checks its Mobile Money, taps **Payment received** in My shop → Orders, and only then can
  it update the order: sent (or ready to collect), then delivered. The buyer is told at each step, in the app and
  by text. An order from several shops is paid shop by shop.
- **Pay on Delivery**, with the couriers that allow it.

Unpaid Mobile Money orders don't hold stock forever: halfway to the limit set in Admin → Settings (24 hours to
start) the buyer is reminded where to pay and by when, and at the limit the parcel is cancelled and both sides are
told. If the buyer says they paid but the shop hasn't confirmed, the shop is reminded instead and the order is never
cancelled automatically. These checks run every 10 minutes while the server is awake. Staff can confirm a payment
for a shop (Admin → Orders → Payment received, with a reason) when the owner confirms by phone.

A shop's Mobile Money number is shown only to its owner, to staff, and to buyers on their own orders. Shops opened
before this was added see a reminder to add their number; until they do, buyers can only pay them on delivery.

Because shops collect the money themselves, the Payouts tab shows what each shop **owes** Zed Market (the
commission, as a negative balance) minus any Zed Market voucher its buyers used. Commission becomes due 7 days
after delivery, once the return window has passed. Owners save the Mobile Money number or bank account shops pay
it to (Admin → Payouts); each shop sees the amount and that number under My shop → Sales report. When the money
arrives, staff choose **Commission received** and enter the reference (never more than the shop owes), and
**Remind** sends the shop the amount and where to pay, in the app and by text. A shop that doesn't pay can be
suspended from the Shops tab. If a parcel is cancelled after the
shop confirmed the payment, a refund is recorded, the shop is told to send the money back, and staff mark the refund
as paid once it has. (Orders with the older `paid` status, from before direct payment, still count as paid to Zed
Market in the payouts.)

## Selling tools

- **Messages:** buyers ask a shop about a product; both sides see unread counts. Messages poll every few seconds;
  there is no live connection yet.
- **Discount codes:** percent or Kwacha off, optional minimum spend, total uses and last day; each customer can use
  a code once. Codes apply only to the issuing shop's products.
- **Featured listings:** up to 3 products per shop, 7 days at a time, shown on the home page with a "Featured"
  label. Free during launch (see `FEATURED_LIMIT` and `FEATURED_DAYS` in `src/data/fees.js`).
- **Wholesale price requests:** a buyer asks for a price on a quantity; the shop answers with a price valid for
  1–14 days; the buyer accepts and can order exactly that quantity at that price, once.
- **Receipts and statements:** printable buyer receipts show each shop's TPIN and the VAT included for
  VAT-registered shops. Monthly seller statements show commission (set in Admin → Settings) and payout.

## Cancellations, returns and disputes

- Buyers (or the shop) can cancel a parcel until it is sent. Stock, the discount-code use and any agreed wholesale
  price are given back, and a refund is recorded if the shop had confirmed the buyer's payment.
- Within 7 days of delivery the buyer can report a problem with items (with photos), or a parcel that never arrived
  once it has been sent. The shop accepts (refund, replacement or repair) or rejects with a reason.
- If the shop rejects, or doesn't answer within 3 days, the buyer can escalate to Zed Market staff, who decide.
- Refunds are recorded as "due". The shop has the buyer's money, so staff ask the shop to send it back (or pay it
  and recover it from the shop) and record the reference. Return refunds are deducted on the shop's monthly
  statement, with the commission on those goods given back.

## Admin panel

Staff use `/admin` and land there when they sign in. Staff accounts run the marketplace: they can't open or own a
shop (a shop owner who joins the team needs a different email address).

- **Owners** are the addresses in `ADMIN_EMAILS` (in `server/.env`), checked on every request, so removing an address
  takes away access immediately. Owners can't be suspended or removed from inside the app.
- **Staff** are added and removed by owners in the **Staff** tab. They can do everything else in the panel.
- **Settings** (owners only): commission rate, welcome and referral voucher amounts, voucher minimum spend and how
  long vouchers last. Each order keeps the commission rate in force when it was placed, so a change never rewrites
  past statements or payouts. Every change is in the activity log.
- **Acting for a shop**: staff can edit a shop's details or any listing, and mark parcels sent or delivered (e.g. when
  a courier confirms by phone). Each needs a reason, which the shop is told and the log keeps.

- **Overview** of what needs attention: disputes, refunds to pay, shops to verify, parcels not sent after 2 days.
  A **Before you launch** list at the top shows what is still not set up (sign-in keys, commission rate, where shops
  pay commission, courier rates, Zed Market Points, shops without a Mobile Money number) and disappears when
  everything is done.
- **Shops**: every new shop waits for approval before buyers can see it. Applicants give their full name, NRC
  number and optional PACRA number. Staff approve (the shop goes live with a ✓ badge) or reject with a note the owner
  sees; the owner can correct their details and resubmit. While waiting, owners can already add products. Staff can
  also suspend a live shop (hides all products and stops orders) or restore it. Owners can **delete** a shop for
  good, with a reason: its parcels not yet delivered are cancelled and the buyers told, a shop that never sold
  anything is removed completely, and one with past orders is hidden but kept on record so buyers keep their order
  history and any commission it owes stays on the books. Either way the owner can open a new shop afterwards.
- **Listings and reviews**: remove with a reason the seller can see; restore listings.
- **Users**: suspend (signs them out everywhere and blocks sign-in) or restore.
- **Orders**: find by order number, name or phone; cancel parcels, including ones already with a courier.
- **Disputes** and **Refunds** as described above.
- **Analytics**: sales (GMV), commission earned, customers, new shops, vouchers and refunds for the last 7/30/90/365
  days, a sales-per-day chart, and breakdowns by province, shop, category, payment method and courier. Download as CSV.
- **Payouts**: the balance between Zed Market and each shop. Buyers pay shops directly (Mobile Money or on
  delivery), so the shop already holds the money: it owes the commission and gets back any Zed Market voucher. Money
  stays on hold for 7 days after delivery and while a return is open. Staff record each Mobile Money or bank payout
  with its reference (never more than is available); the shop is notified and sees its balance and history under
  Report in the seller dashboard.
- **QR codes**: every shop also has its own QR code in My shop → Promotions, linking to its shop page, to print for
  the counter or share.
- **Sign-up QR codes**: ready-made images for the live site are in [qr-codes/](qr-codes/); codes for shop owners (`/login?join=seller`, leads on to shop setup) and customers
  (`/login?join=buyer`), with a printable poster to download and WhatsApp sharing. They always use the address the
  site is on, so make them once the site is live.
- **Marketing**: home page banners (shown before the standard slides, with an end date), voucher campaigns paid
  for by Zed Market (everyone, shoppers, shop owners, one province or one phone number; group sends need a second
  click), and announcements to the 🔔 bell.
- **Buying requests**: remove spam or prohibited requests with a reason the buyer sees.
- **Support**: questions sent from the Help page; staff reply (the customer gets a notification) and close them.
- **Activity log**: every staff action with who did it and why.

NRC numbers are personal data: they are only visible to staff and the shop owner, and ID photos are deliberately not
collected (uploaded files are reachable by URL).

## Shopping features

- **Notifications** (🔔 in the header, with red counters): new orders and parcels to send for shops; dispatch,
  ready to collect, delivery, cancellations, returns, refunds, offers and price quotes for buyers; approval
  decisions for shop owners. Messages and My shop show their own counters.
- **Help & support** (`/help`): quick answers plus a chat with Zed Market staff.
- **Buying requests** (`/requests`): a buyer posts what they need (quantity, budget, town); approved shops send a
  price per unit; the buyer accepts one and messages the shop.
- **Invite & vouchers** (My account): every customer has an invite code and share link (`/login?ref=CODE`). A friend
  who joins with it gets a K50 voucher; the inviter gets K50 when the friend's first order is delivered. Vouchers
  are paid for by Zed Market (not the shop), need K300 of products, last 60 days, and come back if the whole order
  is cancelled. Owners change the amounts in Admin → Settings.
- **Zed Market Points**: collection points where any shop can send a parcel for the buyer to collect. Owners add the
  real partner outlets in Admin → Delivery. Until then the live site offers no points; the example points only show
  while developing on your own computer.
- **Resell in my shop**: a shop owner can list another shop's product in their own shop with a 15% margin to
  start from. They buy it from the supplier (or use their own stock) and send it themselves.
- **Shop pages**: cover photo, about text, opening hours, directions (Google Maps) and share buttons
  (WhatsApp, Facebook, copy link) on shops, products and requests.
- **Batch actions**: tick the cart items to buy now (the rest stay in the cart), save or remove several at once,
  "Buy again" on past orders, and mark several parcels as sent in one go in the seller dashboard.

## Delivery options ([src/data/couriers.js](src/data/couriers.js))

Yango (and the shop's own rider) deliver to the buyer's door. Parcels sent with Platinum, a bus or Zampost wait at
the courier's office in the buyer's town (Platinum office, bus station or post office), where the buyer collects them
with the order number and ID; checkout, the order page and the "on its way" text say where.

| Option | Same town | Same province | Other province |
| --- | --- | --- | --- |
| Collect from shop | ✓ | ✓ | ✓ |
| Shop's own delivery to the door (shop sets its own fees) | ✓ | ✓ | |
| Yango Delivery to the door (listed towns only) | ✓ | | |
| Platinum Couriers, collect at their office | ✓ | ✓ | ✓ |
| Intercity bus parcel, collect at the bus station | | ✓ | ✓ |
| Zampost EMS, collect at the post office | ✓ | ✓ | ✓ |
| Zed Market Point (off until staff switch it on in Admin → Delivery) | ✓ | ✓ | ✓ |

**How each courier charges** (what they publish, checked October 2026; owners confirm the real rates in Admin →
Delivery, where these notes are shown too):

- **Yango** charges like a ride, by distance. The starting fares are Yango's published Lusaka maximums: motorbike K10.17
  for the first km then K4.95 per km; car (parcels over 10 kg, up to 20 kg) K19 for the first 1.5 km then K4.20 per km
  plus K0.80 per minute. The trip is measured between the shop's and the buyer's map positions (straight line × 1.3
  for roads). Shops set their position once in their settings, and buyers can share theirs at checkout; without
  both, an 8 km trip is assumed and the price is shown as an estimate. The buyer's position is shown to the shop to
  give the rider. Yango runs in Lusaka, Kitwe, Ndola and Solwezi.
- **Platinum Couriers** publishes no rate card; it advertises small parcels "across Zambia for just K30", so that is
  the starting fee, plus a per-kg rate for heavy parcels to confirm with them.
- **Bus parcels** and **Zampost EMS** are priced at the counter by size and weight, with no published table; the
  starting values are placeholders to replace with what the bus station and post office quote.

Base fees cover a parcel up to 5 kg; heavier parcels pay a per-kg rate, and couriers with a weight limit
(e.g. Yango 20 kg, Zampost 30 kg) are not offered for heavier parcels. Every product has a weight per unit.
The values in [src/data/couriers.js](src/data/couriers.js) are only **starting values**. Owners enter the rates
agreed with each courier in **Admin → Delivery**: fee per distance, extra-kg rate, heaviest parcel, delivery times,
Yango towns, pay on delivery, or switch a courier off. Blank fees mean the courier doesn't cover that distance.
Saved rates are stored in the database and used by checkout and the server straight away; past orders keep the fee
they were charged. Each courier shows "⚠ not confirmed" until it has been saved.

## Search

Search runs in Postgres with the `pg_trgm` extension: it tolerates typos in what the shopper typed (solr → Solar,
chitenje → Chitenge), understands local words listed in [src/data/search.js](src/data/search.js) (nshima → mealie
meal, tekkies → sneakers), and matches shop names, towns (`kitwe` → products sold in Kitwe) and categories. Add
synonyms to that file as you learn how customers search.

## Bulk upload

Shop owners can upload a CSV (saved from Excel or Google Sheets) from the dashboard. Columns: `name, category,
price, was_price, stock, weight_kg, low_stock_at, made_in_zambia, wholesale, options, description`. Wholesale
looks like `10:90; 50:80` and options like `Size=S|M|L; Colour=Black|Blue`. A template can be downloaded from
the dashboard.

## Still to do before launch

- **Commission account:** save the Mobile Money number shops send their commission to in Admin → Payouts.
- **Text or WhatsApp copies of notifications**: notifications are in the app only. Texts or WhatsApp (a WhatsApp
  Business account) can be added later.
- **Legal review:** the pages under `/legal` are drafts and must be reviewed by a Zambian lawyer. Register with the
  Office of the Data Protection Commissioner as required.
- **Tax:** receipts are not ZRA Smart Invoices. Shops that must issue fiscal invoices still need to do so, and
  Zed Market's own commission invoicing needs ZRA integration.
- **Real delivery data:** enter courier rates and Zed Market Points in Admin → Delivery, and the commission rate in
  Admin → Settings. The admin Overview lists whichever of these are still missing.
- **Photo storage** in object storage (S3-compatible) for multi-server hosting; photos are currently saved to disk.
- A search index (e.g. a trigram index over product name, description and shop) once the catalogue reaches tens of
  thousands of products. Synonym and town matching currently scan the product table.
