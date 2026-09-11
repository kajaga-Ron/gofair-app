# GoFair — live negotiation backend

A real-time rider/driver fare negotiation app, with a driver verification
system gating who's even allowed to see or bid on ride requests. Riders
just pick a name; drivers must register with ID/permit/vehicle details
and photos, then get approved by an admin before their account can do
anything on the driver side.

## What's in here
- `server.js` — Node/Express + Socket.io backend. Ride requests and
  negotiation threads live in memory (fine — they're short-lived).
  Driver accounts live in `drivers.js`, backed by a JSON file, so
  applications survive a server restart.
- `public/index.html` — the rider/driver app.
- `public/admin.html` — password-gated review panel: see submitted
  documents, approve or reject each application.
- Map: OpenStreetMap + Leaflet (free, no API key). Address search:
  Nominatim (also free).

## Environment variables (set these before deploying — see below)
- `ADMIN_PASSWORD` — the password for `/admin.html`. Defaults to an
  insecure placeholder with a startup warning if you don't set one.
- `JWT_SECRET` — signs driver and admin session tokens. Defaults to an
  insecure placeholder with a startup warning if you don't set one.
- `PORT` — defaults to 3000; most hosts set this for you automatically.

## How driver verification works
1. A driver opens **Driver** mode → **Register**: name, phone, password,
   national ID number, driving permit number, vehicle plate/model, and
   photos of their ID, permit, and a selfie.
2. Their account is created with `status: "pending"` — at this point the
   backend will **not** let their socket connection see ride requests or
   place bids, even if someone tampers with the app's UI (this is
   enforced server-side in `server.js`, not just hidden in the frontend).
3. You (or whoever reviews applications) open `/admin.html`, log in with
   `ADMIN_PASSWORD`, and see every pending application with its photos.
4. Approve → the driver's app instantly unlocks (if they're online, they
   get pushed the update live; otherwise they see it next time they open
   the app or tap "Check status"). Reject → they see your note and can
   edit and resubmit.

## Run it locally
```bash
npm install
npm start
```
Open `http://localhost:3000` for the app and `http://localhost:3000/admin.html`
for the review panel (password `changeme123` unless you set `ADMIN_PASSWORD`).

## Deploy it for free (pick one)

**Render**
1. Push this folder to a GitHub repo.
2. On render.com → New → Web Service → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. In the service's Environment tab, add `ADMIN_PASSWORD` and
   `JWT_SECRET` (use a long random string for each).
5. Deploy. Render gives you a public URL immediately.

**Railway**
1. Push to GitHub, then railway.app → New Project → Deploy from repo.
2. Add `ADMIN_PASSWORD` and `JWT_SECRET` under Variables.
3. Railway auto-detects Node and runs `npm start`.

**Fly.io**
1. `fly launch` in this folder, accept the Node defaults.
2. `fly secrets set ADMIN_PASSWORD=... JWT_SECRET=...`
3. `fly deploy`.

## Known limits, and what's next
- **Documents stored as base64 in a JSON file**: fine to get a real
  approval workflow running today. Before handling real government ID
  documents at real scale, move document storage to an access-controlled,
  encrypted object store (e.g. S3), and restrict admin access beyond a
  single shared password (real admin accounts with their own logins).
  Uganda's Data Protection and Privacy Act, 2019 applies to this data.
- **In-memory ride/negotiation state**: if the server restarts, open ride
  requests are cleared (driver accounts are not — those persist in the
  JSON file). Add a real database when you're ready to keep ride history.
- **No real driver GPS, no payments yet** — see the earlier notes; those
  are the next layers on top of this same foundation.
- **CORS is wide open** (`origin: '*'`) for easy testing. Lock this down
  to your real domain before sharing this beyond a demo.

## Vehicle types + driver wallet (motorcycle & car, 7% commission)

- **Vehicle types**: riders choose Motorcycle or Car before requesting; a
  driver registers as one or the other. Matching is enforced server-side
  via Socket.io rooms — a car driver's connection is never even sent a
  motorcycle request, and vice versa.
- **Driver wallet / down payment**: every driver has a wallet balance.
  They must hold at least `DRIVER_MIN_WALLET_UGX` (default 5,000) to
  receive ride requests at all — enforced at connection time AND again
  before every bid, server-side.
- **Topping up**: since there's no live payment gateway wired in yet,
  drivers submit a top-up (amount + mobile money transaction reference)
  from the app; you confirm it in `/admin.html` under a Wallet Top-ups
  view once you've checked the transaction actually came through. Once
  confirmed, their balance updates instantly if they're online.
- **Commission**: when a driver marks a ride "complete," the backend
  automatically deducts `COMMISSION_RATE` (default 0.07 = 7%) of the
  agreed fare from their wallet — logged in their ledger. The rider is
  never charged anything extra; the whole fare goes to the driver
  directly (cash or mobile money outside the app), and your 7% comes out
  of their pre-loaded balance.
- **Additional env vars**: `DRIVER_MIN_WALLET_UGX`, `COMMISSION_RATE`
  (e.g. `0.07`).

### Honest gap here
Top-up confirmation is manual (you check the mobile money reference and
click Confirm) — there's no live MTN MoMo / Airtel Money API integration
yet, so nothing stops a driver from submitting a fake reference before
you check it. That's fine for a pilot with a small number of drivers you
can verify by phone, but doesn't scale — a real launch needs an actual
payment gateway webhook confirming the transaction automatically.

## Real MTN MoMo / Airtel Money top-ups

Drivers can now top up their wallet with a real payment prompt sent to
their phone — `payments.js` implements MTN MoMo's Collections
("Request to Pay") API and Airtel Money's Collections API. Manual
reference-based top-ups (admin reviews and confirms) still work as a
fallback and are shown as a secondary option in the app.

### Simulation mode (default, until you add real credentials)
Without any MTN/Airtel env vars set, both providers fake a successful
payment ~4 seconds after being asked — enough to test the entire wallet
top-up flow, including the polling and webhook paths, before either
telco account is approved. A console warning and a toast in the app both
make it obvious when you're in this mode.

### Going live
1. **MTN MoMo**: sign up at the [MoMo Developer Portal](https://momodeveloper.mtn.com),
   subscribe to the Collections product to get a subscription key, then
   provision a sandbox API user/key (their docs walk through this with
   just the subscription key — no approval needed for sandbox). Set:
   - `MOMO_SUBSCRIPTION_KEY`, `MOMO_API_USER`, `MOMO_API_KEY`
   - `MOMO_TARGET_ENVIRONMENT=sandbox` (then `production` once approved)
2. **Airtel Money**: register at the
   [Airtel developer portal](https://developers.airtel.africa), create
   an application with the Collections product to get a client ID/secret.
   Set:
   - `AIRTEL_CLIENT_ID`, `AIRTEL_CLIENT_SECRET`
   - `AIRTEL_ENVIRONMENT=staging` (then `production` once approved)
3. **Production access for both** requires KYC / business verification
   directly with MTN Uganda and Airtel Uganda — budget real time for
   this. If it stalls, a payments aggregator that already holds both
   telcos' merchant relationships (e.g. Relworx, Flutterwave, Eversend)
   can get you live faster than going direct to each telco separately —
   worth a look if approval drags on.
4. **Webhooks (optional but recommended once deployed)**: set
   `WEBHOOK_SECRET` to a random string, then register
   `https://your-domain/webhooks/momo/callback?token=<secret>` (and the
   Airtel equivalent) with each provider so confirmations arrive
   instantly instead of waiting for the app's poll cycle. Without this,
   the app still works — it just polls the provider directly every few
   seconds while a payment is pending.

### Honest limits
- **Not tested against real MTN/Airtel servers.** This was built against
  their documented API shapes, but this development environment has no
  network access to reach either provider — test thoroughly in each
  provider's own sandbox with real credentials before trusting this with
  real money, and re-check field names against their current docs since
  telco APIs do shift between versions.
- **Phone number used is whatever the driver registered with** — there's
  no separate "which wallet do you want to pay from" step. If a driver's
  MoMo-registered number differs from their GoFair account phone,
  the payment prompt won't reach them. Worth a note in your driver
  onboarding instructions.

## Database migration — driver accounts now in Postgres

Driver accounts, wallets, and ID/selfie photos used to live in a single
JSON file (`data/db.json`) — fine to get started, but risky for real
government ID documents and real driver money. They now live in
Postgres, which works identically whether it's a local install (for
development) or a Supabase project (for production) — Supabase's
database IS Postgres, so the same code and SQL work against either.

### Required: set DATABASE_URL

The server won't start without this.

**Local development:**
```bash
# Install Postgres (Mac: brew install postgresql · Ubuntu/Debian: apt install postgresql)
createuser fairfare -P    # set a password when prompted
createdb fairfare -O fairfare
export DATABASE_URL="postgres://fairfare:yourpassword@localhost:5432/fairfare"
npm start
```
The server creates its own tables automatically on first startup — no
separate migration step needed for a fresh database.

**Production (Supabase, free tier is fine to start):**
1. Create a project at [supabase.com](https://supabase.com)
2. Project Settings → Database → Connection string → copy the URI
3. Set it as `DATABASE_URL` in your hosting provider's environment
   variables (Render/Railway/Fly — wherever you deployed `gofair-server`)
4. Deploy — tables are created automatically on first startup, same as local

### If you were running the old JSON-file version
Your existing driver test data isn't lost — bring it over:
```bash
DATABASE_URL=postgres://... npm run migrate-from-json
```
This reads `data/db.json` (if present), imports every driver and their
wallet ledger into Postgres, and writes their document photos to disk.
Safe to run more than once — it skips any driver whose phone number
already exists in Postgres.

### What changed under the hood
- `db.js` — connection pool + automatic schema creation (`drivers` and
  `ledger_entries` tables)
- `drivers.js` — same exported functions as before, now backed by real
  SQL instead of a JSON file. Every function is now `async` — this
  matters if you're extending the code, not for how the app behaves.
- `documents.js` — ID/selfie photos are now written to disk under
  `uploads/drivers/<driverId>/` instead of embedded as base64 in the
  database. Only a file path is stored in Postgres. Documents are served
  to the admin panel through an authenticated endpoint
  (`/api/admin/drivers/:id/document/:field`) — never publicly reachable.

### Honest limits of this step
- **Local disk storage for documents won't survive a redeploy** on most
  hosting platforms (Render/Railway containers are ephemeral, and a new
  deploy gets a fresh filesystem). This is fine for developing and
  testing, but before a real launch, swap `documents.js` for Supabase
  Storage (or S3) — it's a contained change, since `drivers.js` only
  calls `saveDocument()` / `getDocumentDiskPath()` without knowing how
  or where the bytes actually live.
- **Ride requests and negotiation threads are still in-memory**
  (`server.js`), not in Postgres. That's a deliberate choice, not an
  oversight — they're short-lived (minutes), so losing them on a
  restart is a minor inconvenience rather than data loss, unlike driver
  accounts. Worth revisiting if you want permanent ride history for
  support or disputes later.
- **A single shared admin password is still the only access control**
  on the admin panel and now on document viewing too. Real admin
  accounts with individual logins matter more now that this panel is
  the only way to see driver ID photos.

## Live demand pricing, cancellation fairness, and driver ratings

### Smarter suggested fares
The fare a rider sees is no longer a flat formula — it's computed
server-side (`fare:suggest` socket event) from three live signals:
- **Time of day**: 1.2× during weekday rush hours (7–9am, 5–8pm Kampala
  time), 1.15× late night (11pm–5am), 1.0× otherwise
- **Live demand**: the real ratio of currently-open ride requests to
  currently-connected, approved, funded drivers for that vehicle type —
  the same signal Uber/Yango call "surge," computed here from data the
  server already tracks, no new infrastructure required
- **A rider's own cancellation penalty**, if one is active (see below)

The rider still proposes and negotiates their own final price — this
only changes the *starting suggestion* they see, not a price imposed on
them. Timezone is hardcoded to Africa/Kampala regardless of where the
server itself is hosted, so a US-hosted Render instance doesn't apply
American rush hour to Kampala rides.

### Cancellation fairness
Riders now have a lightweight identity too — just a phone number,
no password or approval, stored in a new `riders` table. If a rider
cancels a matched trip **after the driver has marked themselves
arrived**, their very next fare suggestion carries a one-time bump
(15% by default, `RIDER_CANCELLATION_PENALTY_PCT` env var) — enough to
discourage the costly kind of cancellation without being punitive.
Cancelling *before* the driver arrives is free, same as most platforms.
The penalty clears itself the moment they submit their next request.

### Driver ratings and priority access
Riders rate their driver 1–5 stars after each completed trip. Rather
than permanently hiding new requests from lower-rated drivers (which
risks a spiral where they can never earn enough trips to improve),
well-rated drivers (avg ≥ `HIGH_TIER_MIN_RATING`, default 4.5) — and
brand-new drivers with fewer than `MIN_RATINGS_FOR_TIERING` (default 3)
completed ratings — see a new request the instant it's posted. Every
other driver in that vehicle-type pool sees it `DRIVER_PRIORITY_DELAY_MS`
(default 20000ms) later, only if it's still unclaimed. This was tested
directly with millisecond-precision timing: a high-rated driver received
a test request at 2ms, a low-rated driver at exactly 1503ms with the
delay set to 1500ms for that test.

Ratings are visible to admins in `/admin.html`'s driver list.

### New environment variables
- `RIDER_CANCELLATION_PENALTY_PCT` (default `0.15`)
- `HIGH_TIER_MIN_RATING` (default `4.5`)
- `MIN_RATINGS_FOR_TIERING` (default `3`)
- `DRIVER_PRIORITY_DELAY_MS` (default `20000`)

### Honest limits
- The demand multiplier looks only at your own in-app open-requests vs.
  connected-drivers ratio — it has no visibility into whether drivers
  are simply not opening the app right now (e.g. a real supply drought
  at 2am), only what's actively happening inside GoFair at that
  moment. This is the same limitation any young platform has before it
  reaches real scale.
- A rider can dodge the cancellation penalty by using a different phone
  number next time, same as any phone-based identity system with no
  verification step. Fine for a pilot; a real launch would want at
  least SMS OTP verification on the rider phone number, similar in
  spirit to the driver verification system already in place.

## Admin mobile money number (for manual top-ups)

The manual top-up path needs an actual number to tell drivers where to
send money — set these before deploying:

- `ADMIN_MOMO_NUMBER` — your MTN MoMo number, e.g. `0700123456`
- `ADMIN_MOMO_NAME` — optional label shown next to it, e.g. `HANDLE Uganda`
- `ADMIN_AIRTEL_NUMBER` — your Airtel Money number, if you take those too
- `ADMIN_AIRTEL_NAME` — optional label for that one

These are shown to drivers via a public, unauthenticated endpoint
(`/api/config/topup-numbers`) — that's deliberate, since it's just where
to send money, not sensitive data. If none are set, the app tells the
driver to ask their admin instead of showing a blank field.

## Country/currency architecture + card payments (Visa/Mastercard)

### Country and currency — built to expand without disturbing existing code
`config.js` is now the single source of truth for currency and fare
rates per country. Only Uganda is active today (`ACTIVE_COUNTRIES` in
that file) — Zambia and Malawi have placeholder entries ready, but won't
appear as choices in the app until you add them to that list and put in
real local fare rates. No other file should ever hardcode a currency
symbol or fare number again — everything reads from this config,
including matching (a Uganda rider is never shown a Zambia driver, even
once Zambia is active), fare suggestions, and wallet minimums.

### Card payments — built on Flutterwave, deliberately
Flutterwave holds a Bank of Uganda Payment Service Provider license and
covers Uganda, Zambia, and Malawi with one integration (cards +
MTN MoMo + Airtel Money). That licensing detail is *why* this uses
Flutterwave specifically: it means GoFair itself never needs to hold
its own payment-system license — Flutterwave is legally the one
operating the payment system, and GoFair is a merchant using their
checkout and transfer APIs, same as any e-commerce business.

Two separate features, both card-based:

1. **Driver tops up their wallet by card** — same shape as the existing
   MTN MoMo/Airtel buttons, just another way to fund their own wallet.
   Low legal novelty — this is the driver depositing into their own
   account, same as before.

2. **Rider pays the fare by card, through the app** — a genuinely
   different money flow from everything else in this app. Every other
   payment path here only ever moves the driver's own money (their
   wallet). This one has the app receive a rider's card payment and
   automatically pay the driver out (minus the 7% commission) to their
   mobile money number.

   **Get this second one reviewed by a lawyer before real cards touch
   it.** Uganda's National Payment Systems Act, 2020 explicitly
   regulates "aggregators" — businesses that collect and move other
   people's money — and this is exactly that. Routing everything through
   Flutterwave (rather than GoFair pooling the money itself) is the
   standard way apps handle this without their own PSP license, but
   whether that's sufficient for HANDLE Uganda's specific structure is a
   real legal question, not a technical one, and I can't answer it.

### New environment variables
- `FLUTTERWAVE_SECRET_KEY` — enables real card payments. Without it, the
  app runs in **simulation mode**: card payments fake success ~4 seconds
  after being requested, tested end-to-end with a real Postgres
  database — confirmed a UGX 15,000 fare pays a driver out at exactly
  UGX 13,950 (15,000 minus 7%), with the driver's wallet balance
  correctly left untouched (this money never enters the wallet system).

### Getting real Flutterwave credentials
1. Sign up at [dashboard.flutterwave.com](https://dashboard.flutterwave.com)
2. Their test/sandbox API keys are available immediately, free, no
   approval needed — good enough to test the full flow for real
3. Production keys need Flutterwave's own KYC/business verification —
   budget time for this, same as the MTN/Airtel note earlier in this
   README, though multiple sources suggest Flutterwave's onboarding has
   generally been smoother than going directly to individual telcos

### Honest limits
- Driver payout uses Flutterwave's mobile-money-transfer API to send
  money to the driver's registered phone. The `account_bank` code used
  (`MPS`) is Uganda's — this needs to be looked up and changed per
  country in `payments.js` before Zambia/Malawi go live for real money.
- If a rider's card payment succeeds but the driver payout fails for any
  reason (network blip, wrong number, etc.), the app correctly does NOT
  pretend the trip is complete — it surfaces a `payout_failed` status so
  an admin can pay the driver manually and investigate. This state isn't
  automatically retried yet; that's worth adding before relying on this
  for real volume.
- None of this has been tested against Flutterwave's actual servers —
  same limitation as MTN/Airtel: this sandbox has no network access to
  reach them. Test thoroughly with real sandbox credentials before this
  touches real money.

## Rider/driver experience upgrades

### Fixed: drop-off address autocomplete
The pickup field's address suggestions worked, but the drop-off field's
didn't — traced to a CSS `overflow:hidden` on the container holding both
fields, which was silently clipping the second field's dropdown since it
needed to extend below the container's edge. Fixed.

### Vehicle details shown to riders
Drivers now register with a vehicle color alongside plate and model.
Riders see driver name, vehicle color/model, and plate both while
reviewing an offer and once matched — the same information Yango/inDrive
show before a rider gets in a stranger's car.

### Direct calling (tel: links)
Once matched, either side can tap "Call" to open their phone's native
dialer with the other party's real number pre-filled. **Worth knowing**:
this shares actual phone numbers between rider and driver — most large
platforms mask numbers through a paid calling service (Twilio,
Africa's Talking) specifically to avoid this. That's a real upgrade to
consider later, not something faked here.

### In-app chat
Either side can message the other during a trip, with quick-reply
buttons ("Where are you?", "I've arrived") plus free typing. Built on
the same Socket.io connection as everything else — no new
infrastructure, no message history kept (it's a short-lived per-trip
channel, not general messaging).

### Safety / customer care
A "🆘 Safety" button on both rider and driver trip screens offers:
- **Call support** directly (`SUPPORT_PHONE_NUMBER` env var)
- **Report an issue** — goes straight into a new admin dashboard tab
  ("Safety reports"), reviewable and markable as resolved

### Share my trip
A "📍 Share trip" button generates a link to `/track.html?trip=<id>` —
a public, no-login-required page a friend or family member can open to
see the driver's name, vehicle, plate, and coarse trip status (en route
/ arrived / completed). Deliberately doesn't expose live GPS
coordinates or exact addresses — just enough for someone to know their
person is in a known, verified vehicle.

### GPS-based country/currency/map detection
On load, the app quietly asks for location (never blocking if denied)
and reverse-geocodes it via Nominatim to detect the country. If it's an
**active** country (Uganda today), the map re-centers and the currency
switches automatically — no manual picker needed. If it detects a
country that exists in the system but isn't launched yet (Zambia,
Malawi), it tells the person plainly rather than pretending to work
there. Denied permission, or an unrecognized location, silently falls
back to Uganda — the app never breaks over this.

### New environment variables
- `SUPPORT_PHONE_NUMBER` — shown as a tappable "Call support" button
- `SUPPORT_WHATSAPP_NUMBER` — reserved for a future WhatsApp support link

### Honest limits
- A handful of cosmetic spots (a few input placeholder texts) still say
  "UGX" literally rather than reading the detected currency — harmless
  today since only Uganda is live, worth a final sweep before Zambia or
  Malawi actually launches.
- The "share trip" page polls the server every 6 seconds rather than
  pushing updates instantly — fine at today's scale, could move to a
  live socket connection if this needs to feel more real-time later.
- Support reports have no automatic escalation (e.g. SMS to an on-call
  admin) — someone needs to actually check the admin panel's Safety
  Reports tab. Worth adding real-time alerting before relying on this
  for genuine emergencies.

## Free trial mode — waive the minimum wallet balance

For an introductory period, you can let every driver receive ride
requests regardless of wallet balance — no deposit required to
participate. This is a single environment variable, so turning it on
now and off again in a few months needs zero code changes and no
driver re-registration:

```
FREE_TRIAL_MODE=true
```

**Turn it on now** (Render → your service → Environment → add this
variable). Drivers will see a friendly green banner ("🎉 Free trial
period — no minimum wallet balance required right now") instead of the
usual top-up warning, and can bid on rides with a zero balance.

**Turn it off later** by deleting the variable, or setting it to
`false` — the moment you do, the normal per-country minimum balance
requirement is back in force immediately, with no other changes needed.
Tested directly: with the flag on, a driver with a UGX 0 balance
successfully saw a request and placed a real bid; with it off, the same
driver was correctly blocked and shown "Top up your wallet before
accepting rides."

**What this does NOT change**: the 7% commission still applies to
completed rides during the trial — this only waives the *deposit*
requirement, not the platform's fee. If you want commission-free too
during the trial, that's a separate setting (`COMMISSION_RATE=0`) you'd
set alongside this one.

## Fixed: currency now follows the pickup point, not the rider's device

Originally, country/currency detection ran once at page load based on the
rider's own device location — meaning someone in Malawi arranging a ride
for someone standing in Zambia would incorrectly see Uganda's currency
the whole time, since their *own* location never changed.

Fixed: the country is now re-detected every time a pickup point is set
(map tap or address search), using the pickup's coordinates specifically
— not the device's. The device-location guess still runs once on load,
but only as an initial default before any pickup is chosen; the moment a
real pickup point is set, that takes over as the source of truth.

**Honest limitation**: this sandbox has no network access to
nominatim.openstreetmap.org (same restriction noted elsewhere for
MTN/Airtel/Flutterwave), so the live reverse-geocode call itself
couldn't be tested end-to-end here — only the matching/active-country
logic that runs after it, which was confirmed directly against the
server's own config. Since this reuses the same Nominatim service
already working for address search, it should behave the same way, but
test it for real on your end before relying on it.

## Added: Botswana and Zimbabwe (config only — not live yet)

Following the same pattern as Zambia and Malawi: both countries now
exist in `config.js` with currency, map center, and placeholder fare
rates, but neither is switched on (`ACTIVE_COUNTRIES` is still just
`['UG']`). They won't appear as a choice in the app, and GPS/pickup
detection will correctly tell a rider "GoFair isn't available here yet"
if their pickup point lands in either — same honest behavior as Zambia.

### A real decision worth confirming: Zimbabwe's currency
Zimbabwe officially uses the **ZiG** (Zimbabwe Gold, introduced April
2024), but as of recent reporting roughly **70% of actual transactions**
in the country are still denominated in **US dollars** — hotels, fuel,
restaurants, and most day-to-day commerce quote and settle in USD, with
ZiG mostly showing up as change. I set the config to `USD` for that
reason, but this is genuinely worth confirming before real money moves
through it — if you'd rather follow the official currency instead,
change `currency: 'USD'` to `currency: 'ZWG'` in `config.js`.

### Fare rates are placeholders, not researched pricing
Same caveat as Zambia/Malawi: the per-km rates for both new countries
are structurally reasonable guesses, not real local market research.
Also worth flagging specifically for **Botswana**: motorcycle-taxi
culture is far less established there than in Uganda — worth confirming
riders would even want that option before launch, rather than assuming
the same two-vehicle-type model transfers directly.

### To actually launch either one later
1. Replace the placeholder `rates` for that country in `config.js` with
   real researched local pricing
2. Confirm the currency choice (see Zimbabwe note above)
3. Add its code to `ACTIVE_COUNTRIES` — e.g. `['UG', 'ZW']`
4. Redeploy — no other code changes needed anywhere in the app

## Launched: Zambia and Malawi are now live alongside Uganda

`ACTIVE_COUNTRIES` is now `['UG', 'ZM', 'MW']`. Before flipping this on,
the placeholder rates for both were replaced with numbers calibrated
against real published pricing:

- **Zambia**: Yango's own Lusaka pricing page cites fares starting
  around $2/km for short trips (tapering for longer ones), with typical
  short rides costing $1.50-3 total, at roughly 25 ZMW/USD. GoFair's
  linear pricing formula doesn't taper the way Yango's does, so long
  trips here will price somewhat higher than Yango's own app — worth
  watching once real rides happen.
- **Malawi**: recalibrated against a published Blantyre taxi rate of
  roughly MWK 200/km. The original placeholder here was **5-8x too
  high** — exactly why these got checked against real reference points
  before real drivers and riders started seeing these numbers.

### Tested specifically for this launch
With three countries live simultaneously for the first time, I tested
that they stay properly isolated from each other — confirmed a ride
request posted in Zambia reaches a Zambia-registered driver and does
NOT leak to a Uganda-registered driver, even though both are now
connected to the same live app at the same time.

### Still worth confirming before real volume
- **Motorcycle-taxi culture isn't well documented in Zambia or Malawi**
  the way it is in Uganda — the motorcycle rates exist for consistency,
  but it's worth confirming riders and drivers in these markets
  actually want that option before assuming it transfers directly.
- These rates come from public pricing pages and blog posts, not a live
  pull from either competitor's current app — treat them as a
  well-informed starting point, not a guarantee, and adjust quickly if
  real trips feel mispriced in either direction.

## Drivers now explicitly select their country at registration

Previously, a driver's country was set silently from ambient GPS/pickup
detection at the moment they registered — which meant it could
accidentally be wrong if that detection had drifted for any reason
(e.g. testing pickup points in a different country right before
registering). Drivers now pick their country explicitly from a dropdown
at the top of the registration form, and that's what's actually sent to
the server — no ambient detection involved in this decision anymore.

Selecting a country now also updates, live, in the registration form:
- **The ID document labels**, using each country's real terminology:
  - Uganda: National ID / Driving Permit
  - Zambia: **National Registration Card (NRC)** / Driving Licence
  - Malawi: National Identity Card / Driving Licence
  - (Botswana: **Omang (National ID)** / Driving Licence — ready for
    when it's activated)
- **A note showing the currency and minimum wallet balance** for that
  country, so a driver knows what they're signing up for before they
  submit

## Diagnosing "rider request never reaches the driver"

If a test ride isn't showing up on the driver side, the most likely
cause as of this update is a **country mismatch** — a driver only ever
sees requests whose *pickup point* resolves to the same country they
registered under. Since currency/country now follows the pickup point
(an earlier fix in this README), it's easy to end up testing with a
driver registered in one country while your rider's last-set pickup
point was somewhere else — the app is correctly refusing to cross-match
them, but it looks like a bug if you don't know why.

**To rule this out**: confirm the rider's pickup point and the driver's
registered country actually match, confirm the driver is Approved (not
still Pending), confirm both vehicle types match (motorcycle vs car),
and confirm `FREE_TRIAL_MODE` is still set if the driver's wallet
balance is at zero — any one of these silently blocks the match.

## Fixed: wallet balance and top-up amount showing different currencies

A driver could see their wallet balance correctly in ZMW while the
"Enter amount" field right below it still said "(UGX)" — a real
inconsistency, caught during testing.

**Root cause**: the driver's own wallet display was reading a shared
`currentCurrency` variable that only got updated by *rider-side* pickup
detection — so a driver's wallet showed whatever currency a rider
search had last set in that same browser tab, coincidentally or not,
while a handful of static input placeholders were never wired to update
at all.

**Fixed properly**: introduced one function (`setCurrentCurrency`) that
both the rider's pickup-detection path and the driver's own wallet-load
path now both call — so a driver's currency is always authoritative
from their own account data, completely independent of anything a
rider search did earlier in the same session. Every place currency
shows (wallet balance, minimum-balance banner, top-up input, fare
counter-offer inputs) now updates together, from one source of truth.

**Verified with an isolated test against the real shipped code** (not a
reimplementation) — confirmed a Zambia driver's wallet load correctly
updates all four currency-displaying elements to ZMW simultaneously.

## Multi-category service platform — the foundation is now built

GoFair's engine now supports five service categories, not just rides —
built after researching how real platforms handle this (TaskRabbit's
background-check requirements for household services, Glovo/Jumia
Food's per-delivery payout model rather than a deposit).

| Category | Vehicle required | Deposit required | Trust referee required |
|---|---|---|---|
| Ride | Yes | Yes (full) | No |
| Delivery | Yes | Yes (40% of ride deposit) | No |
| Household service | No | **No** | **Yes** — an LC1 chairperson or personal referee, since this is the one category where a provider enters someone's home |
| Waste & recycling | Yes | Yes | No |
| Gig work | No | No | No (optional) |

**Only `ride` is switched on** — same "configured but not live" pattern
as the countries. The other four exist fully in the config and are
provably working (tested directly, see below), but won't appear as
options in the app until deliberately activated.

### Why household services need a referee instead of a deposit
This mirrors TaskRabbit's own reasoning, confirmed via their public
background-check documentation: a cash deposit protects against a
driver not showing up; it does nothing to protect a customer who's
letting a stranger into their home. A referee — someone in the
provider's actual community who'd stake their own reputation vouching
for them — is a locally-grounded substitute for the formal background-
check services (Checkr, Persona) that don't operate in this region.

### Why food delivery does NOT use TaskRabbit/Glovo's own model
Real food-delivery platforms researched (Glovo, Jumia Food) pay couriers
per-delivery with commission deducted from money they already control —
they don't use a pre-funded deposit at all. GoFair's deposit model
exists specifically because many rides settle in cash directly between
rider and driver, so the deposit is how commission actually gets
collected. Delivery keeps a deposit for that same reason, just smaller
(40% of the ride amount) since a courier's per-job risk is lower.

### Tested directly, not just written
- A household registration *without* a referee is correctly rejected
  with a message pointing to the LC1 chairperson requirement
- A household registration *with* a referee succeeds, with no vehicle
  plate required at all
- That same driver's wallet correctly shows no deposit requirement
- **Category isolation confirmed live**: a plumbing request reaches a
  registered plumber and does NOT leak to a connected ride driver, even
  with both online at the same time

### What's still needed before any category beyond rides can launch
- **Real fare/rate formulas per category** — the existing distance-based
  formula (base + per-km) makes sense for rides and deliveries, but not
  for household services (typically hourly or a flat callout) or gig
  work. This needs category-specific pricing logic, not just relabeling.
- **Food delivery's vendor/menu system** — genuinely separate work, not
  covered by this category framework at all (see the "food delivery"
  discussion elsewhere in this README-adjacent history)
- **RecycleCash's reversed money flow** — the `moneyDirectionFor()`
  function exists and is tested at the config level, but the actual
  payment logic (who pays whom, how commission applies when the
  *provider* is the one being paid) hasn't been built into the payment
  functions yet

## Fixed-pricing model — negotiate only where the real evidence supports it

Research before implementation, not assumption: checked how real
platforms in this exact space actually evolved, not just what sounded
consistent with GoFair's existing identity.

- **Lynk (Kenya)** — the closest real precedent for household services —
  started with almost exactly GoFair's negotiate-a-quote model and
  **deliberately abandoned it**: negotiated quotes created quality-
  control problems and didn't scale. They moved to standardized,
  provider-set upfront pricing instead.
- **Wecyclers (Nigeria)** pays a fixed rate per kilogram for recyclables.
  **TakaTaka Solutions (Kenya)** charges a fixed collection fee. Neither
  real African success story in this category negotiates, ever.

**What changed as a result:**

| Category | Pricing | Why |
|---|---|---|
| Ride | Negotiate (unchanged) | GoFair's real point of difference from Uber/Bolt |
| Delivery | Negotiate (unchanged) | Same reasoning — delivery fee genuinely varies by distance |
| Household service | **Fixed, set by the provider** | Following Lynk's hard-won lesson instead of repeating it |
| Waste collection | **Fixed, set by the platform** | Following TakaTaka's model |
| Recyclables | **Fixed per kilogram, set by the platform** | Following Wecyclers' model |
| Gig work | Negotiate (unchanged) | Genuinely mixed globally; kept closest to how a worker proposes a one-off rate |

**Built and tested, not just designed:**
- The server is now authoritative on price for every fixed category — a
  driver's app could send any number, and it's correctly ignored in
  favor of the provider's real registered rate (household) or the
  country's published rate (waste/recycling)
- Counter-offers are correctly blocked entirely on fixed-price threads —
  confirmed directly: an attempted counter-offer produces no response
- A household provider now sets their own rate at registration, shown
  to a customer as a real number, not typed in per-job
- **A real bug was caught and fixed during this work**: adding the new
  `fixed_rate` column initially misaligned the registration SQL's column
  and value counts by one — verified programmatically (not just by eye)
  before this ever touched a real database, and confirmed correct
  afterward

### Honest scope limit
The rider-facing side of booking a fixed-price provider is not yet
built as its own interface — today's negotiation-card UI (propose,
counter, accept) still technically works for fixed categories (since
the server just gives one unchangeable "offer" instead of allowing
counters), but a real "browse providers and their published rates, then
book" screen — closer to how Lynk or TaskRabbit actually look — hasn't
been designed yet. Worth building before any category beyond rides
actually launches to real users.

## Commission rates set per category, plus a real ratings-based reward

### Final commission rates
| Category | Commission |
|---|---|
| Ride, Delivery | 7% (unchanged — controlled by `COMMISSION_RATE` env var, same as always) |
| Household services | 7% |
| Gig work | 5% |
| Waste collection | 7% |
| Recycling | 1% |

Recycling's 1% (rather than 0%, which I'd originally suggested given
Wecyclers' real revenue comes from selling materials downstream, not
from the household transaction) — a deliberate, small compromise:
enough to matter to the business, small enough not to meaningfully
erode what the household is paid for their recyclables.

**Tested for real, not just displayed**: confirmed a gig job actually
had exactly 5% deducted from the driver's wallet (not 7%, which would
be an easy copy-paste mistake to make elsewhere in the codebase), and
every category's own commission rate shown in their wallet matches
what actually gets deducted at payment time.

### A real financial reward for well-rated, experienced providers
Not just a badge — a provider with **20+ completed jobs and a 4.8+
average rating** now pays **2 percentage points less commission** on
every future job (e.g. a ride driver's 7% becomes 5%). Configurable via
`REWARD_MIN_RATING`, `REWARD_MIN_COMPLETED`, and
`REWARD_COMMISSION_DISCOUNT` env vars.

**Verified with real money, not just a UI check**: simulated a driver
with 20 five-star ratings, then had them complete a real UGX 20,000
trip — confirmed exactly UGX 1,000 (5%) was deducted from their wallet,
not the UGX 1,400 (7%) a driver without the reward would have paid on
the same trip. The wallet screen shows both the driver's earned rate
and their un-discounted base rate side by side, so the reward is
visible and motivating, not just a silent internal calculation.

### Free trial mode confirmed universal
`FREE_TRIAL_MODE` was already checked before any category-specific
logic runs, so it correctly waives the deposit requirement for every
category, not just rides — confirmed by reading the code path directly
rather than assuming.

## Fare rates recalibrated after real testing feedback — prices were too high

Real drivers and riders testing Uganda, Zambia, and Malawi all reported
fares feeling too expensive. This is exactly the kind of feedback that
matters more than any published rate card, and it was right — the
original per-km rate scaled too aggressively for longer trips.

### Uganda — solved directly against real data
Found a specific, granular real-world source for Kampala boda-boda
pricing: **~1,000 UGX for 1-3km, ~2,000 for 4-6km, ~3,000 for 7-10km**.
Solved the base+per-km formula directly against those numbers
(base≈1,000, perKm≈230) rather than adjusting by feel. The result:

| Distance | Old fare | New fare |
|---|---|---|
| 2km (motorcycle) | 2,400 | 1,500 |
| 5km (motorcycle) | 4,500 | 2,250 |
| 10km (motorcycle) | 8,000 | 3,500 |
| 5km (car) | 8,500 | 4,750 |
| 10km (car) | 15,000 | 8,000 |

The reduction gets larger at longer distances (56% cheaper at 10km vs.
37% at 2km) — that's the actual bug: the old per-km rate compounded too
steeply the further a trip went, exactly matching what real testers
noticed.

### Zambia and Malawi — same proportional correction
Granular per-distance-bracket data wasn't available for these two the
way it was for Kampala, so the same ~45-50% reduction to the per-km
rate was applied proportionally, since the same complaint applied
across all three countries. **Worth watching closely** as real testing
continues in these two specifically — Uganda's fix is grounded in
direct evidence, Zambia and Malawi's is a reasoned proportional
correction, not independently verified data.

### Nothing else changed
This is a pure numbers change in `config.js` — no matching, payment, or
category logic was touched, confirmed by the full regression suite
passing unchanged afterward.

## Fare update: Uganda reverted, Zambia and Malawi checked against real data

**Uganda reverted to the original rate** (base 1,000/perKm 700 for
motorcycle, base 2,000/perKm 1,300 for car) — the earlier recalibration
was undone on explicit instruction.

**Zambia adjusted upward slightly**, grounded in a specific real data
point: Lusaka taxi rides run roughly **$2.70 (≈67 ZMW) for a 5km trip**,
consistently reported across sources. The prior estimate (52 ZMW for
5km) undershot this a bit; now set to hit that real figure almost
exactly (base 22, perKm 9 → 67 ZMW at 5km).

**Malawi kept at the already-reduced rate — a genuine, honest tension
worth knowing about.** Research turned up two real sources that
disagree by almost 10x: one taxi-fare calculator states an explicit
formula of 5,000 MWK base + 400 MWK/km (implying ~7,000 MWK for a 5km
ride), while another (Blantyre-specific) suggests roughly 200 MWK/km
with almost no base fee. Rather than split the difference blindly, this
kept the lower rate — real tester feedback (people finding the price
too high, in actual use) is stronger evidence than either published
number, and the higher calculator figure may reflect airport-transfer
or premium pricing rather than everyday local fares. **Worth watching
closely as more real Malawi testing happens** — this is the one number
in the whole rate table resting on judgment rather than solid data.

## All five categories now activated, plus multi-category providers

`ACTIVE_CATEGORIES` is now `['ride', 'delivery', 'household', 'waste',
'gig']` — every category built this session is live in the config.

### A real architectural addition: one provider, multiple categories
A driver can now register for more than one category on the same
verified identity — the explicit example: a motorcycle rider offering
both passenger rides and deliveries on the same bike, same ID, same
wallet. Built with a new `driver_offerings` table rather than
overloading the existing single-category fields, so:

- **Identity is verified once** (ID, selfie, vehicle, referee if
  needed) — approving the driver approves every offering they listed
- **Each offering is matched completely independently** — a driver only
  appears in a category's request pool if they're actually eligible for
  *that* category's deposit/referee requirements, not an all-or-nothing
  check across everything they've registered
- **One shared wallet, correctly charged per category** — commission and
  deposit rules apply per-transaction based on which category the job
  actually was, not the driver's "primary" registration

**Tested directly, not just designed**: registered one driver as
primary=ride with delivery as an additional offering, confirmed they
received both a ride request AND a delivery request in their live feed,
and successfully bid on both using the one wallet and one approved
identity.

### Registration form updated
After choosing a primary category, drivers now see "Also offer any of
these on the same identity?" with the other active categories as
checkboxes — checking one reveals its own sub-type choice (and a rate
input, for categories like household services that need one).

### Honest scope limit — the rider side still needs its own picker
Everything above is proven correct on the backend and in driver
registration. **The rider-facing request screen has not been updated
yet** — a customer opening the app today still only sees the original
ride request flow, with no way to ask for a plumber, a delivery, a
waste pickup, or gig help. Activating the categories and enabling
multi-category providers was real, necessary groundwork, but a
customer literally cannot request anything but a ride until that
screen exists. That's the next real piece of work, not yet started.

## The rider-facing request flow — now built for all five categories

This closes the real gap flagged earlier: activating categories on the
provider side didn't give customers any way to actually request them.
That's fixed now.

### What a rider sees now
1. **"What do you need?"** — a picker screen with all five categories,
   shown before anything else
2. **A form that adapts to what they picked**:
   - **Ride / Delivery** — the familiar two-point map (pickup + drop),
     sub-type choice (motorcycle/car for rides; motorcycle/bicycle/on
     foot for delivery), and a negotiable price they propose
   - **Household services / Gig work** — a single location (no route —
     there's no "drop-off" for a plumber visit), sub-type choice
     (plumbing/electrical/cleaning/other; errands/manual
     labour/digital)
   - **Waste collection** — single location, no price to propose — the
     exact fixed platform fee is shown before they even request it
   - **Recycling** — single location plus a "how many kg?" field, with
     the exact payout calculated live (kg × the country's per-kg rate)
     and clearly labeled as money they'll **receive**, not pay

### Fixed-price categories no longer show a fake negotiation
Offer cards now check the thread's real pricing model — for household,
waste, and recycling, the "Counter" button and input are gone entirely,
matching what the server already enforced (counter-offers were already
blocked server-side; the UI now honestly reflects that instead of
showing a button that would silently fail).

### Recycling's reversed money flow is handled honestly in the UI
Since a recycler pays the household, not the other way around: the
accept button says "Accept — you'll receive X" instead of "Accept X",
the matched-trip screen says "You'll receive" instead of "Fare agreed
at", and the **"Pay by Card" button is hidden entirely** for recycling
— it would never have made sense for the person being paid to also be
prompted to pay.

### Commission collection — confirmed still works for every category
No new payment logic was needed here: the driver-marks-complete (cash)
and rider-pays-by-card flows both already resolved the correct
category-specific commission rate from earlier work in this session.
Verified directly with a fresh test: a waste-collection fare of a fixed
platform rate, and a recycling payout calculated per-kilogram, both
came through the exact right numbers via the live `fare:suggest`
endpoint before ever reaching a real request.

### Safety features — confirmed untouched
Direct calling, in-app chat, the safety/customer-care button, and trip
sharing all operate generically off the matched-trip data, regardless
of category — verified they weren't accidentally broken by this rework
rather than assumed.

### Full regression re-run
Every existing test in the project — vehicle matching, payments, chat,
card payments with commission, multi-category providers, fixed
pricing, service category isolation — still passes unchanged after this
rebuild.

## Honest answer: map locations are not real yet, plus a bug fix

Asked directly whether the map shows real locations of the requester
and provider to each other. The honest answer, checked directly rather
than assumed:

- **Rider's own pickup/drop pins are real** — they set those themselves
- **The "driver" marker shown after matching is simulated** — a fake
  marker with a randomized starting position that animates toward the
  pickup point. This is NOT the real driver's live GPS location. This
  has been a known limitation since the very first version of this
  app — real GPS tracking has never been built.
- **The driver's screen has no map at all** — it's a list of cards
  (pickup name, distance, price), never shows the rider's location
  visually.

### Bug found and fixed while checking this
The simulated driver marker didn't appear **at all** for the newer
single-location categories (household, gig, waste, recycling) —
`spawnDriverOnMap()` required both a pickup AND a drop point to exist
before showing anything, but single-location categories never set a
distinct drop point. Fixed by falling back to the pickup point itself
as the destination for map-fitting purposes when there's no real drop
point, matching how the rest of the single-location flow already works.

### What real GPS tracking would actually require
Worth naming clearly since it's a real, sizeable feature, not a small
tweak: continuously streaming each phone's actual location over the
existing socket connection (`navigator.geolocation.watchPosition()` on
each device, relayed through the server to the other party), updating
both markers live rather than animating a fake one. Not built — this
is genuine future work if real live tracking matters more than the
current simulation.

## Real GPS tracking — the simulated marker is gone, replaced with real device locations

Following up on the honest gap flagged earlier ("this doesn't show real
locations, it's a fake animation") — real, bidirectional location
sharing is now built.

### How it works
- Once a trip is genuinely **matched** (not during open bidding — a
  deliberate privacy boundary), each side's device starts sharing its
  own real GPS location via `navigator.geolocation.watchPosition()`
- Locations are relayed through the server, throttled to once every 3
  seconds so a fast-updating GPS doesn't flood the connection
- **The rider's map** now shows the driver's real marker, moving as
  they actually move — no more scripted animation toward the pickup
  point
- **The driver's screen now has a live map view for the first time** —
  reusing the same shared map element that already sat behind the
  driver's card-based interface, showing the rider's real location
- Location sharing stops the moment a trip completes or is cancelled,
  on both sides — no lingering tracking after a trip ends

### The privacy boundary, tested directly
The server **refuses to relay any location update sent before a thread
is actually matched** — confirmed with a real test: a location sent
during open bidding correctly reached nobody, while the identical
message sent one step later, after acceptance, correctly reached the
other party. This isn't incidental; the server checks `thread.status
=== 'accepted'` before relaying anything at all.

### Honest limits
- If either side denies location permission, the trip still works —
  it just falls back to no live marker for that side, same graceful
  degradation used elsewhere in the app (e.g. the earlier
  GPS-based country detection)
- The actual `navigator.geolocation` browser behavior couldn't be
  exercised in this development sandbox (there's no real device or
  browser here) — the relay logic itself was tested directly and
  proven correct, but the on-device experience (permission prompts,
  how smoothly a real phone's GPS updates the marker) needs a real
  phone to fully confirm
