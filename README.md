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
