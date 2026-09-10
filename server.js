/**
 * GoFair — real-time fare negotiation backend.
 *
 * One rider posts a trip with a proposed fare. Any connected driver can
 * accept it outright, or open a "negotiation thread" with a counter-offer.
 * Offers can go back and forth on that thread until either side accepts
 * or declines. When one thread is accepted, the ride is matched and every
 * other driver's thread on that request is closed automatically.
 *
 * Ride requests and negotiation threads stay in-memory (Map objects) —
 * they're short-lived by nature (minutes, not months), so losing them on
 * a restart is a minor inconvenience, not data loss. Driver accounts,
 * wallets, and documents are NOT in-memory — see db.js/drivers.js, which
 * persist to Postgres (works against a local install or Supabase).
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { initSchema } = require('./db');
const config = require('./config');
const drivers = require('./drivers');
const riders = require('./riders');
const ratings = require('./ratings');
const payments = require('./payments');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // demo-friendly; tighten this to your real domain before going further
});

app.use(express.json({ limit: '15mb' })); // documents arrive as base64 images
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Driver registration & login ----------------

// No auth needed — just tells the app which countries are live and what
// currency/vehicle-type combinations to offer. Adding a country later
// means adding it to config.js, not touching this route.
app.get('/api/config/countries', (req, res) => {
  res.json({ countries: config.publicCountryList(), allCountries: config.fullCountryList(), defaultCountry: config.DEFAULT_COUNTRY });
});

app.post('/api/driver/register', async (req, res) => {
  const { phone, password, fullName, country, documentType, documentNumber, vehicleType, vehiclePlate, vehicleModel, vehicleColor, documentPhoto, selfie } = req.body || {};
  if (!phone || !password || !fullName || !vehiclePlate || !documentPhoto || !selfie) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!['national_id', 'driving_license'].includes(documentType) || !documentNumber) {
    return res.status(400).json({ error: 'Choose an ID type (National ID or Driving Permit/Licence) and enter its number.' });
  }
  if (!['motorcycle', 'car'].includes(vehicleType)) {
    return res.status(400).json({ error: 'Choose a vehicle type (Motorcycle or Car).' });
  }
  try {
    const result = await drivers.registerOrResubmit({ phone, password, fullName, country, documentType, documentNumber, vehicleType, vehiclePlate, vehicleModel, vehicleColor, documentPhoto, selfie });
    if (result.error) return res.status(400).json({ error: result.error });
    const token = drivers.signDriverToken(result.driver);
    res.json({ token, driver: drivers.publicDriverView(result.driver) });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ error: 'Could not complete registration — please try again.' });
  }
});

app.post('/api/driver/login', async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: 'Phone and password required.' });
  const result = await drivers.login({ phone, password });
  if (result.error) return res.status(401).json({ error: result.error });
  const token = drivers.signDriverToken(result.driver);
  res.json({ token, driver: drivers.publicDriverView(result.driver) });
});

app.get('/api/driver/me', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const driver = await drivers.verifyDriverToken(token);
  if (!driver) return res.status(401).json({ error: 'Invalid or expired session.' });
  res.json({ driver: drivers.publicDriverView(driver) });
});

// ---------------- Admin: review applications ----------------

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!drivers.verifyAdminToken(token)) return res.status(401).json({ error: 'Admin session required.' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== drivers.ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect admin password.' });
  res.json({ token: drivers.signAdminToken() });
});

app.get('/api/admin/drivers', requireAdmin, async (req, res) => {
  const list = await drivers.listByStatus(req.query.status || 'pending');
  const summaries = await ratings.getRatingSummaries(list.map(d => d.id));
  res.json({ drivers: list.map(d => ({ ...d, rating: summaries[d.id] })) });
});

// Streams a driver's ID/selfie photo to the admin panel. Never publicly
// served — only reachable with a valid admin session, and only these two
// field names are accepted (no arbitrary file paths from the client).
app.get('/api/admin/drivers/:id/document/:field', requireAdmin, async (req, res) => {
  const { field } = req.params;
  if (!['document', 'selfie'].includes(field)) return res.status(400).end();
  const diskPath = await drivers.getDocumentDiskPath(req.params.id, field);
  if (!diskPath) return res.status(404).end();
  res.sendFile(diskPath);
});

app.post('/api/admin/drivers/:id/approve', requireAdmin, async (req, res) => {
  const result = await drivers.setStatus(req.params.id, 'approved', req.body?.note);
  if (result.error) return res.status(404).json({ error: result.error });
  const d = result.driver;
  const targetSocketId = driverSocketsByDriverId.get(d.id);
  if (targetSocketId) await admitDriverIfEligible(targetSocketId, d);
  res.json({ driver: drivers.publicDriverView(d) });
});

app.post('/api/admin/drivers/:id/reject', requireAdmin, async (req, res) => {
  const result = await drivers.setStatus(req.params.id, 'rejected', req.body?.note || 'Application did not meet requirements.');
  if (result.error) return res.status(404).json({ error: result.error });
  const d = result.driver;
  const targetSocketId = driverSocketsByDriverId.get(d.id);
  if (targetSocketId) io.to(targetSocketId).emit('driver:status', { status: 'rejected', reviewNote: d.reviewNote });
  res.json({ driver: drivers.publicDriverView(d) });
});

// ---------------- Wallet: driver-side ----------------

async function requireDriver(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const driver = await drivers.verifyDriverToken(token);
  if (!driver) return res.status(401).json({ error: 'Invalid or expired session.' });
  req.driver = driver;
  next();
}

// No auth needed — this is just informational (where to send money),
// not sensitive. Configure your real numbers via env vars before deploying.
app.get('/api/config/topup-numbers', (req, res) => {
  res.json({
    momoNumber: process.env.ADMIN_MOMO_NUMBER || null,
    momoName: process.env.ADMIN_MOMO_NAME || null,
    airtelNumber: process.env.ADMIN_AIRTEL_NUMBER || null,
    airtelName: process.env.ADMIN_AIRTEL_NAME || null
  });
});

// Support/safety contact — same "just informational" reasoning as the
// top-up numbers: no auth needed, and it's shown right on the trip
// screen where someone might need it urgently.
app.get('/api/config/support', (req, res) => {
  res.json({
    phone: process.env.SUPPORT_PHONE_NUMBER || null,
    whatsapp: process.env.SUPPORT_WHATSAPP_NUMBER || null
  });
});

app.post('/api/support/report', async (req, res) => {
  const { reporterRole, reporterPhone, threadId, message } = req.body || {};
  if (!['rider', 'driver'].includes(reporterRole) || !message || !message.trim()) {
    return res.status(400).json({ error: 'Missing report details.' });
  }
  const result = await drivers.createSupportReport({ reporterRole, reporterPhone, threadId, message: message.trim().slice(0, 2000) });
  res.json({ ok: true, id: result.id });
});

app.get('/api/admin/support-reports', requireAdmin, async (req, res) => {
  res.json({ reports: await drivers.listSupportReports(req.query.status || 'open') });
});

app.post('/api/admin/support-reports/:id/resolve', requireAdmin, async (req, res) => {
  await drivers.resolveSupportReport(req.params.id);
  res.json({ ok: true });
});

// Public, read-only trip status for the "share my trip" safety feature —
// deliberately unauthenticated (a friend/family member opening a shared
// link has no account) and deliberately minimal: driver identity, vehicle,
// fare, and coarse status only. No live GPS coordinates are exposed here.
app.get('/api/trip/:threadId/share', (req, res) => {
  const t = threads.get(req.params.threadId);
  if (!t) return res.status(404).json({ error: 'Trip not found or already finished.' });
  res.json({
    status: t.status,
    driverName: t.driverName || null,
    vehiclePlate: t.vehiclePlate || null,
    vehicleModel: t.vehicleModel || null,
    vehicleColor: t.vehicleColor || null,
    fare: t.finalPrice || null,
    driverArrived: !!t.driverArrived
  });
});

app.get('/api/driver/wallet', requireDriver, async (req, res) => {
  res.json(await drivers.walletView(req.driver));
});

app.post('/api/driver/wallet/topup-request', requireDriver, async (req, res) => {
  const { amount, momoRef } = req.body || {};
  const result = await drivers.requestTopup(req.driver.id, Number(amount), momoRef);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ entry: result.entry, wallet: await drivers.walletView(result.driver) });
});

// Real-time top-up via MTN MoMo, Airtel Money, or Visa/Mastercard: sends
// a payment prompt straight to the driver's registered phone (mobile
// money) or opens a Flutterwave card checkout.
app.post('/api/driver/wallet/topup/initiate', requireDriver, async (req, res) => {
  const { provider, amount } = req.body || {};
  if (!['momo', 'airtel', 'card'].includes(provider)) return res.status(400).json({ error: 'Choose momo, airtel, or card.' });
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });

  const created = await drivers.createProviderTopup(req.driver.id, amt, provider);
  if (created.error) return res.status(400).json({ error: created.error });
  const entry = created.entry;
  const currency = config.getCountry(req.driver.country).currency;

  try {
    let result;
    if (provider === 'momo') {
      result = await payments.momoRequestToPay({ amount: amt, phoneNumber: req.driver.phone, externalId: entry.id });
    } else if (provider === 'airtel') {
      result = await payments.airtelRequestToPay({ amount: amt, phoneNumber: req.driver.phone, reference: entry.id });
    } else {
      result = await payments.flwInitiatePayment({
        amount: amt, currency, txRef: entry.id,
        customerPhone: req.driver.phone, customerName: req.driver.fullName
      });
    }
    await drivers.attachProviderReference(req.driver.id, entry.id, provider === 'card' ? entry.id : result.providerReferenceId);
    res.json({ entryId: entry.id, status: 'processing', simulated: !!result.simulated, checkoutLink: result.link || null });
  } catch (e) {
    await drivers.decideTopup(req.driver.id, entry.id, false, 'Payment request could not be sent: ' + e.message);
    res.status(502).json({ error: 'Could not reach the payment provider. Please try again.' });
  }
});

// The frontend polls this while a payment is pending — it asks the
// provider directly, so it works even before you've wired up a public
// webhook URL for instant push confirmation.
app.get('/api/driver/wallet/topup/:entryId/status', requireDriver, async (req, res) => {
  const entry = await drivers.getTopupEntry(req.driver.id, req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Top-up not found.' });

  if (entry.status !== 'processing') {
    return res.json({ status: entry.status, wallet: await drivers.walletView(await drivers.findById(req.driver.id)) });
  }
  try {
    let check;
    if (entry.provider === 'momo') check = await payments.momoGetStatus(entry.providerReferenceId);
    else if (entry.provider === 'airtel') check = await payments.airtelGetStatus(entry.providerReferenceId);
    else check = await payments.flwVerifyByTxRef(entry.providerReferenceId);

    if (check.status === 'SUCCESSFUL') {
      const result = await drivers.decideTopup(req.driver.id, entry.id, true);
      await broadcastWalletUpdate(req.driver.id, result.driver);
      return res.json({ status: 'confirmed', wallet: await drivers.walletView(result.driver) });
    }
    if (check.status === 'FAILED') {
      const result = await drivers.decideTopup(req.driver.id, entry.id, false, 'Payment was not completed.');
      return res.json({ status: 'rejected', wallet: await drivers.walletView(result.driver) });
    }
    res.json({ status: 'processing' });
  } catch (e) {
    res.json({ status: 'processing' }); // transient provider error — let the frontend retry on its next poll
  }
});

// Providers POST here the instant a payment resolves, for faster
// confirmation than polling. Requires a public HTTPS URL once deployed —
// register {your-domain}/webhooks/momo/callback (and the Airtel
// equivalent) with each provider's dashboard. A shared-secret query
// param guards against random internet traffic hitting this endpoint.
function verifyWebhookSecret(req, res) {
  const expected = process.env.WEBHOOK_SECRET;
  if (expected && req.query.token !== expected) {
    res.status(401).end();
    return false;
  }
  return true;
}

app.post('/webhooks/momo/callback', async (req, res) => {
  if (!verifyWebhookSecret(req, res)) return;
  const { externalId, status } = req.body || {};
  const found = await drivers.findTopupByEntryIdGlobal(externalId);
  if (!found) return res.status(200).end(); // unknown reference — ack anyway, nothing more we can do
  const result = await drivers.decideTopup(found.driverId, found.entry.id, status === 'SUCCESSFUL', req.body?.reason);
  if (!result.error) await broadcastWalletUpdate(found.driverId, result.driver);
  res.status(200).end();
});

app.post('/webhooks/airtel/callback', async (req, res) => {
  if (!verifyWebhookSecret(req, res)) return;
  const txn = req.body?.transaction || req.body?.data?.transaction || {};
  const entryId = txn.id || txn.airtel_money_id;
  const status = ['TS', 'SUCCESS', 'SUCCESSFUL'].includes(txn.status) ? 'SUCCESSFUL' : 'FAILED';
  const found = await drivers.findTopupByEntryIdGlobal(entryId);
  if (!found) return res.status(200).end();
  const result = await drivers.decideTopup(found.driverId, found.entry.id, status === 'SUCCESSFUL', txn.message);
  if (!result.error) await broadcastWalletUpdate(found.driverId, result.driver);
  res.status(200).end();
});

// ---------------- Rider pays fare by card (Visa/Mastercard via Flutterwave) ----------------
//
// This is the one place real money conceptually flows THROUGH the app
// rather than directly rider-to-driver — which is exactly why it's built
// entirely on top of Flutterwave (a Bank-of-Uganda-licensed Payment
// Service Provider): Flutterwave is legally the one moving the money,
// GoFair is a merchant using their checkout and transfer APIs. Get
// this reviewed by a lawyer before real cards touch it — the legal
// position here is genuinely different from every other payment path
// in this app, all of which only ever move the driver's own money.

app.post('/api/rider/fare/pay/initiate', async (req, res) => {
  const { threadId, riderPhone, riderName } = req.body || {};
  const t = threads.get(threadId);
  if (!t || t.status !== 'accepted' || t.riderPhone !== riderPhone) {
    return res.status(400).json({ error: 'This trip is not ready for payment, or the details don\'t match.' });
  }
  const currency = config.getCountry(t.country || config.DEFAULT_COUNTRY).currency;
  const commission = Math.round(t.finalPrice * drivers.COMMISSION_RATE);

  const payment = await drivers.createCardFarePayment({
    threadId, driverId: t.driverId, riderPhone, fareAmount: t.finalPrice, commission, currency
  });

  try {
    const result = await payments.flwInitiatePayment({
      amount: t.finalPrice, currency, txRef: payment.id,
      customerPhone: riderPhone, customerName: riderName || 'Rider'
    });
    res.json({ paymentId: payment.id, checkoutLink: result.link, simulated: !!result.simulated, amount: t.finalPrice, currency });
  } catch (e) {
    await drivers.updateCardFarePayment(payment.id, { status: 'payout_failed', note: 'Could not start payment: ' + e.message });
    res.status(502).json({ error: 'Could not reach the payment provider. Please try again.' });
  }
});

// Frontend polls this after the rider completes (or is shown) the card
// checkout. On confirmed payment, this is also where the driver's payout
// (fare minus commission) actually gets triggered.
app.get('/api/rider/fare/pay/:paymentId/status', async (req, res) => {
  const payment = await drivers.getCardFarePayment(req.params.paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });

  if (payment.status !== 'pending') {
    return res.json({ status: payment.status });
  }
  try {
    const check = await payments.flwVerifyByTxRef(payment.id);
    if (check.status !== 'SUCCESSFUL') {
      return res.json({ status: 'pending' }); // keep polling — not yet paid or still processing
    }

    await drivers.updateCardFarePayment(payment.id, { status: 'paid', tx_ref: payment.id });

    const driver = await drivers.findById(payment.driver_id);
    try {
      const payout = await payments.flwPayoutToMobileMoney({
        amount: payment.payout_amount, currency: payment.currency,
        phoneNumber: driver.phone, reference: `${payment.id}_payout`,
        narration: 'GoFair trip payout'
      });
      await drivers.updateCardFarePayment(payment.id, { status: 'completed', transfer_ref: payout.transferId });
    } catch (e) {
      // The rider's card WAS charged successfully — this failure is on the payout side only.
      // Flagged clearly so an admin can pay the driver manually and investigate.
      await drivers.updateCardFarePayment(payment.id, { status: 'payout_failed', note: 'Driver payout failed: ' + e.message });
      return res.json({ status: 'payout_failed', amount: payment.fare_amount, currency: payment.currency });
    }

    // Same completion side-effects as the cash-payment trip:complete path
    const t = threads.get(payment.thread_id);
    if (t && t.status === 'accepted') {
      t.status = 'completed';
      const driverSocketId = driverSocketsByDriverId.get(payment.driver_id);
      if (driverSocketId) io.to(driverSocketId).emit('trip:completed', { threadId: t.id, price: payment.fare_amount, role: 'driver', paidByCard: true });
      if (t.riderSocketId) io.to(t.riderSocketId).emit('trip:completed', { threadId: t.id, price: payment.fare_amount, role: 'rider', driverName: t.driverName, paidByCard: true });
    }
    res.json({ status: 'completed', payoutAmount: payment.payout_amount, currency: payment.currency });
  } catch (e) {
    res.json({ status: 'pending' }); // transient provider error — let the frontend retry on its next poll
  }
});

// ---------------- Wallet: admin-side ----------------

app.get('/api/admin/topups', requireAdmin, async (req, res) => {
  res.json({ topups: await drivers.listPendingTopups() });
});

app.post('/api/admin/topups/:driverId/:topupId/confirm', requireAdmin, async (req, res) => {
  const result = await drivers.decideTopup(req.params.driverId, req.params.topupId, true, req.body?.note);
  if (result.error) return res.status(404).json({ error: result.error });
  await broadcastWalletUpdate(req.params.driverId, result.driver);
  res.json({ wallet: await drivers.walletView(result.driver) });
});

app.post('/api/admin/topups/:driverId/:topupId/reject', requireAdmin, async (req, res) => {
  const result = await drivers.decideTopup(req.params.driverId, req.params.topupId, false, req.body?.note || 'Could not verify this transaction.');
  if (result.error) return res.status(404).json({ error: result.error });
  await broadcastWalletUpdate(req.params.driverId, result.driver);
  res.json({ wallet: await drivers.walletView(result.driver) });
});

// ---- In-memory state (rides + negotiations — short-lived by nature) ----
const requests = new Map();
const threads = new Map();
const driverSocketsByDriverId = new Map(); // driverId -> current socket.id, for pushing instant wallet/status updates

let counter = 1;
function nextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

function requestPublicView(r) {
  return {
    id: r.id, riderName: r.riderName, pickup: r.pickup, drop: r.drop,
    pickupName: r.pickupName, dropName: r.dropName, proposedFare: r.proposedFare,
    vehicleType: r.vehicleType, country: r.country, km: r.km, status: r.status, createdAt: r.createdAt
  };
}
function threadPublicView(t) {
  return {
    id: t.id, requestId: t.requestId, driverName: t.driverName,
    vehiclePlate: t.vehiclePlate, vehicleModel: t.vehicleModel, vehicleColor: t.vehicleColor,
    offers: t.offers, status: t.status
  };
}
function driverRoom(country, vehicleType) {
  return `driver:${country}:${vehicleType}`;
}

// ---------------- Fare suggestion: base + time-of-day + live demand ----------------
// Mirrors the client-side formula in public/index.html so the two stay in
// sync, but only this server-side version factors in real-time demand and
// a rider's cancellation penalty — the client can't see either of those.

function baseFareForKm(km, vehicleType, country) {
  const rates = config.getCountry(country).rates;
  const r = rates[vehicleType] || rates.car;
  return r.base + r.perKm * km;
}

// Uganda time (EAT, UTC+3) regardless of where the server itself is
// hosted — a US-hosted Render instance shouldn't apply "New York rush
// hour" to Kampala rides. NOTE: this stays Uganda-specific until a
// second country actually goes live — a real multi-country version
// would look up each country's own timezone here too.
function kampalaHour() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Kampala', hour: 'numeric', hour12: false });
  return parseInt(fmt.format(new Date()), 10) % 24;
}

function timeOfDayMultiplier() {
  const hour = kampalaHour();
  const isWeekdayRush = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 20);
  const isLateNight = hour >= 23 || hour < 5;
  if (isWeekdayRush) return 1.2;
  if (isLateNight) return 1.15;
  return 1.0;
}

// Live ratio of open requests to currently-available (connected, approved,
// funded) drivers for that country + vehicle type — the same signal
// Uber/Yango call "surge," computed here from data the server already
// has, no new infrastructure required.
function demandMultiplier(country, vehicleType) {
  const openCount = Array.from(requests.values()).filter(r => r.status === 'open' && r.vehicleType === vehicleType && r.country === country).length;
  const room = io.sockets.adapter.rooms.get(driverRoom(country, vehicleType));
  const driverCount = room ? room.size : 0;
  if (driverCount === 0) return openCount > 0 ? 1.3 : 1.0; // no one online at all — a mild nudge, not a guess at infinity
  const ratio = openCount / driverCount;
  if (ratio >= 2) return 1.4;
  if (ratio >= 1) return 1.2;
  if (ratio >= 0.5) return 1.1;
  return 1.0;
}

function roundToNearest(n, step) {
  return Math.round(n / step) * step;
}

async function broadcastRideToRoomTiered(country, vehicleType, requestView) {
  const room = io.sockets.adapter.rooms.get(driverRoom(country, vehicleType));
  if (!room || !room.size) return;

  const socketIds = Array.from(room);
  const driverIdBySocket = {};
  socketIds.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s?.data?.driverId) driverIdBySocket[sid] = s.data.driverId;
  });
  const summaries = await ratings.getRatingSummaries(Object.values(driverIdBySocket));

  const highTier = [];
  const lowTier = [];
  socketIds.forEach(sid => {
    const driverId = driverIdBySocket[sid];
    const summary = driverId ? summaries[driverId] : null;
    (ratings.isHighTier(summary) ? highTier : lowTier).push(sid);
  });

  highTier.forEach(sid => io.to(sid).emit('ride:available', requestView));

  if (lowTier.length) {
    setTimeout(() => {
      const current = requests.get(requestView.id);
      if (current && current.status === 'open') {
        lowTier.forEach(sid => io.to(sid).emit('ride:available', requestView));
      }
    }, ratings.PRIORITY_DELAY_MS);
  }
}

async function broadcastWalletUpdate(driverId, driver) {
  const targetSocketId = driverSocketsByDriverId.get(driverId);
  if (!targetSocketId) return;
  io.to(targetSocketId).emit('wallet:update', await drivers.walletView(driver));
  await admitDriverIfEligible(targetSocketId, driver);
}

// Puts a driver's live connection into the request pool for their vehicle
// type IF they're approved and above the minimum wallet balance — the
// single choke point both the socket 'identify' handler and every wallet
// change call, so a driver who tops up while connected gets unlocked
// immediately without needing to reconnect.
async function admitDriverIfEligible(socketId, driver) {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  socket.data.approved = driver.status === 'approved';
  socket.data.vehicleType = driver.vehicleType;
  socket.data.country = driver.country;

  if (driver.status !== 'approved') {
    socket.emit('driver:status', { status: driver.status, reviewNote: driver.reviewNote });
    return;
  }
  const wallet = await drivers.walletView(driver);
  socket.emit('driver:status', { status: 'approved', wallet });
  if (!drivers.hasSufficientBalance(driver)) return; // approved, but can't join the pool until topped up

  socket.join(driverRoom(driver.country, driver.vehicleType));
  const open = Array.from(requests.values())
    .filter((r) => r.status === 'open' && r.vehicleType === driver.vehicleType && r.country === driver.country)
    .map(requestPublicView);
  socket.emit('ride:list', open);
}

io.on('connection', (socket) => {
  socket.data.role = null;
  socket.data.name = null;

  // Client identifies itself as rider or driver. Riders just need a name.
  // Drivers must present a valid token for an APPROVED, adequately-funded
  // account — enforced here (and again at thread:start) regardless of
  // what the frontend UI shows.
  socket.on('identify', async ({ role, name, token, phone, country }) => {
    socket.data.role = role;

    if (role === 'driver') {
      const driver = token ? await drivers.verifyDriverToken(token) : null;
      if (!driver) {
        socket.data.approved = false;
        socket.emit('driver:status', { status: 'unauthenticated' });
        return;
      }
      driverSocketsByDriverId.set(driver.id, socket.id);
      socket.data.driverId = driver.id;
      socket.data.name = driver.fullName; // use the verified name, not a free-typed one
      socket.data.phone = driver.phone;
      socket.data.vehiclePlate = driver.vehiclePlate;
      socket.data.vehicleModel = driver.vehicleModel;
      socket.data.vehicleColor = driver.vehicleColor;
      await admitDriverIfEligible(socket.id, driver);
    } else {
      socket.data.name = (name || '').trim() || 'Rider';
      socket.data.country = config.isValidCountry(country) ? country : config.DEFAULT_COUNTRY;
      if (phone) {
        const rider = await riders.findOrCreateRider(phone, socket.data.name);
        socket.data.riderPhone = rider.phone;
      }
    }
  });

  // Rider checks the live suggested fare before submitting a request —
  // this is the one place demand, time-of-day, and any cancellation
  // penalty actually get applied; the client only shows what this
  // returns, it doesn't compute pricing itself.
  socket.on('fare:suggest', async ({ vehicleType, km }, ack) => {
    if (!ack) return;
    if (!['motorcycle', 'car'].includes(vehicleType) || typeof km !== 'number') {
      return ack({ error: 'Invalid request' });
    }
    const country = socket.data.country || config.DEFAULT_COUNTRY;
    const base = baseFareForKm(km, vehicleType, country);
    const tMult = timeOfDayMultiplier();
    const dMult = demandMultiplier(country, vehicleType);
    let penaltyPct = 0;
    if (socket.data.riderPhone) {
      const penalty = await riders.peekPenalty(socket.data.riderPhone);
      if (penalty.active) penaltyPct = penalty.pct;
    }
    const suggested = roundToNearest(base * tMult * dMult * (1 + penaltyPct), 500);
    ack({
      suggestedFare: suggested,
      currency: config.getCountry(country).currency,
      demandMultiplier: dMult,
      timeMultiplier: tMult,
      penaltyApplied: penaltyPct > 0,
      penaltyPct
    });
  });

  // Rider posts a new trip + proposed fare, for a specific vehicle type
  socket.on('ride:create', async (data, ack) => {
    if (socket.data.role !== 'rider') return ack && ack({ error: 'not a rider' });
    if (!['motorcycle', 'car'].includes(data.vehicleType)) return ack && ack({ error: 'choose a vehicle type' });
    const country = socket.data.country || config.DEFAULT_COUNTRY;

    for (const [id, r] of requests) {
      if (r.riderSocketId === socket.id && r.status === 'open') {
        requests.delete(id);
        io.to(driverRoom(r.country, r.vehicleType)).emit('ride:removed', { requestId: id });
      }
    }

    if (socket.data.riderPhone) await riders.consumePenalty(socket.data.riderPhone); // one-time nudge, not a standing surcharge

    const id = nextId('req');
    const r = {
      id, riderSocketId: socket.id, riderName: socket.data.name, riderPhone: socket.data.riderPhone || null,
      country,
      pickup: data.pickup, drop: data.drop, pickupName: data.pickupName, dropName: data.dropName,
      proposedFare: data.proposedFare, vehicleType: data.vehicleType, km: data.km,
      status: 'open', createdAt: Date.now()
    };
    requests.set(id, r);
    await broadcastRideToRoomTiered(country, data.vehicleType, requestPublicView(r));
    ack && ack({ requestId: id });
  });

  socket.on('ride:cancel', ({ requestId }) => {
    const r = requests.get(requestId);
    if (!r || r.riderSocketId !== socket.id) return;
    requests.delete(requestId);
    io.to(driverRoom(r.country, r.vehicleType)).emit('ride:removed', { requestId });
    for (const [tid, t] of threads) {
      if (t.requestId === requestId && t.status === 'open') {
        t.status = 'declined';
        io.to(t.driverSocketId).emit('thread:closed', { threadId: tid });
      }
    }
  });

  // Driver opens a negotiation thread on a request (first offer = their price;
  // if it equals the rider's ask, the frontend can treat it as a straight accept)
  socket.on('thread:start', async ({ requestId, price }, ack) => {
    if (socket.data.role !== 'driver' || !socket.data.approved) {
      return ack && ack({ error: 'Your driver account is not approved yet.' });
    }
    const driverRecord = await drivers.findById(socket.data.driverId);
    if (!driverRecord || !drivers.hasSufficientBalance(driverRecord)) {
      return ack && ack({ error: 'Top up your wallet before accepting rides.' });
    }
    const r = requests.get(requestId);
    if (!r || r.status !== 'open') return ack && ack({ error: 'request no longer open' });
    if (r.vehicleType !== socket.data.vehicleType) return ack && ack({ error: 'vehicle type mismatch' });

    const id = nextId('thr');
    const t = {
      id, requestId, driverSocketId: socket.id, driverName: socket.data.name, driverPhone: socket.data.phone,
      vehiclePlate: socket.data.vehiclePlate, vehicleModel: socket.data.vehicleModel, vehicleColor: socket.data.vehicleColor,
      offers: [{ by: 'driver', price, ts: Date.now() }], status: 'open'
    };
    threads.set(id, t);
    io.to(r.riderSocketId).emit('thread:new', threadPublicView(t));
    ack && ack({ threadId: id });
  });

  // Either side sends a counter-offer on an existing thread
  socket.on('thread:offer', ({ threadId, price, by }) => {
    if (by === 'driver' && !socket.data.approved) return;
    const t = threads.get(threadId);
    if (!t || t.status !== 'open') return;
    t.offers.push({ by, price, ts: Date.now() });
    const r = requests.get(t.requestId);
    if (by === 'rider' && r && r.riderSocketId === socket.id) {
      io.to(t.driverSocketId).emit('thread:update', threadPublicView(t));
    } else if (by === 'driver' && t.driverSocketId === socket.id) {
      if (r) io.to(r.riderSocketId).emit('thread:update', threadPublicView(t));
    }
  });

  // Either side accepts the latest offer on a thread -> ride matched
  socket.on('thread:accept', ({ threadId }) => {
    const t = threads.get(threadId);
    if (!t || t.status !== 'open' || !t.offers.length) return;
    const finalPrice = t.offers[t.offers.length - 1].price;
    t.status = 'accepted';
    t.finalPrice = finalPrice;
    const r = requests.get(t.requestId);
    if (r) {
      r.status = 'matched';
      t.riderSocketId = r.riderSocketId;
      t.riderPhone = r.riderPhone;
      t.country = r.country;
    }
    const driverSocket = io.sockets.sockets.get(t.driverSocketId);
    if (driverSocket) t.driverId = driverSocket.data.driverId;

    io.to(t.driverSocketId).emit('ride:matched', {
      threadId, price: finalPrice, role: 'driver', counterpartName: r ? r.riderName : 'Rider',
      counterpartPhone: r ? r.riderPhone : null
    });
    if (r) {
      io.to(r.riderSocketId).emit('ride:matched', {
        threadId, price: finalPrice, role: 'rider', counterpartName: t.driverName,
        counterpartPhone: t.driverPhone,
        vehiclePlate: t.vehiclePlate, vehicleModel: t.vehicleModel, vehicleColor: t.vehicleColor
      });
      for (const [tid2, t2] of threads) {
        if (t2.requestId === r.id && tid2 !== threadId && t2.status === 'open') {
          t2.status = 'declined';
          io.to(t2.driverSocketId).emit('ride:closed', { requestId: r.id });
        }
      }
      requests.delete(r.id);
      io.to(driverRoom(r.country, r.vehicleType)).emit('ride:removed', { requestId: r.id });
    }
  });

  // Driver marks a ride as physically completed (fare collected directly
  // from the rider) — this is the trigger that deducts the platform's
  // commission from the driver's wallet.
  socket.on('trip:complete', async ({ threadId }) => {
    const t = threads.get(threadId);
    if (!t || t.status !== 'accepted' || t.driverSocketId !== socket.id) return;
    t.status = 'completed';

    const result = await drivers.deductCommission(t.driverId, t.finalPrice);
    if (!result.error) {
      socket.emit('wallet:update', await drivers.walletView(result.driver));
    }
    socket.emit('trip:completed', { threadId, price: t.finalPrice, role: 'driver' });
    if (t.riderSocketId) {
      io.to(t.riderSocketId).emit('trip:completed', { threadId, price: t.finalPrice, role: 'rider', driverName: t.driverName });
    }
  });

  // Driver marks that they've physically reached the pickup point — this
  // is the trigger that determines whether a later cancellation is "free"
  // or earns the rider a fine on their next fare suggestion.
  // Simple in-trip chat — either side can message the other once matched.
  // Deliberately minimal: no history persistence, since this is a
  // short-lived per-trip channel, not a general messaging feature.
  socket.on('chat:send', ({ threadId, text }) => {
    const t = threads.get(threadId);
    if (!t || !text || !text.trim()) return;
    const trimmed = text.trim().slice(0, 500); // basic length guard
    let from;
    if (t.driverSocketId === socket.id) from = 'driver';
    else if (t.riderSocketId === socket.id) from = 'rider';
    else return; // not a participant in this thread

    const payload = { threadId, from, text: trimmed, ts: Date.now() };
    if (from === 'driver' && t.riderSocketId) io.to(t.riderSocketId).emit('chat:message', payload);
    if (from === 'rider' && t.driverSocketId) io.to(t.driverSocketId).emit('chat:message', payload);
  });

  socket.on('trip:arrived', ({ threadId }) => {
    const t = threads.get(threadId);
    if (!t || t.status !== 'accepted' || t.driverSocketId !== socket.id) return;
    t.driverArrived = true;
    t.arrivedAt = Date.now();
    if (t.riderSocketId) io.to(t.riderSocketId).emit('trip:driverArrived', { threadId });
  });

  // Rider cancels after being matched. Free if the driver hasn't arrived
  // yet; past that point, it cost the driver real time and fuel, so the
  // rider's NEXT fare suggestion carries a small bump — a nudge, not a
  // ban, and it clears itself the moment they actually request again.
  socket.on('trip:cancel', async ({ threadId }) => {
    const t = threads.get(threadId);
    if (!t || t.status !== 'accepted' || t.riderSocketId !== socket.id) return;
    t.status = 'declined';

    let penalized = false;
    if (t.driverArrived && t.riderPhone) {
      await riders.applyCancellationPenalty(t.riderPhone);
      penalized = true;
    }
    io.to(t.driverSocketId).emit('trip:cancelledByRider', { threadId, penalized });
    socket.emit('trip:cancelConfirmed', { threadId, penalized });
  });

  // Rider rates the driver once a trip is complete. The thread record is
  // kept around after completion specifically so this still works —
  // nothing to look up on the (now-deleted) original ride request.
  socket.on('trip:rate', async ({ threadId, stars }, ack) => {
    const t = threads.get(threadId);
    const n = Number(stars);
    if (!t || t.riderSocketId !== socket.id || !Number.isInteger(n) || n < 1 || n > 5) {
      return ack && ack({ error: 'Invalid rating' });
    }
    const summary = await ratings.addRating(t.driverId, t.riderPhone, n);
    const driverSocketId = driverSocketsByDriverId.get(t.driverId);
    if (driverSocketId) io.to(driverSocketId).emit('rating:received', { stars: n, summary });
    ack && ack({ ok: true, summary });
  });

  socket.on('thread:decline', ({ threadId, by }) => {
    const t = threads.get(threadId);
    if (!t) return;
    t.status = 'declined';
    const r = requests.get(t.requestId);
    if (by === 'driver') {
      if (r) io.to(r.riderSocketId).emit('thread:closed', { threadId });
    } else {
      io.to(t.driverSocketId).emit('thread:closed', { threadId });
    }
  });

  socket.on('disconnect', () => {
    if (socket.data.role === 'rider') {
      for (const [id, r] of requests) {
        if (r.riderSocketId === socket.id) {
          requests.delete(id);
          io.emit('ride:removed', { requestId: id });
          for (const [tid, t] of threads) {
            if (t.requestId === id && t.status === 'open') {
              t.status = 'declined';
              io.to(t.driverSocketId).emit('thread:closed', { threadId: tid });
            }
          }
        }
      }
    } else if (socket.data.role === 'driver') {
      if (socket.data.driverId) driverSocketsByDriverId.delete(socket.data.driverId);
      for (const [tid, t] of threads) {
        if (t.driverSocketId === socket.id && t.status === 'open') {
          t.status = 'declined';
          const r = requests.get(t.requestId);
          if (r) io.to(r.riderSocketId).emit('thread:closed', { threadId: tid });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    server.listen(PORT, () => console.log(`GoFair server listening on port ${PORT}`));
  })
  .catch((e) => {
    console.error('✖ Could not set up the database schema — check DATABASE_URL.', e);
    process.exit(1);
  });
