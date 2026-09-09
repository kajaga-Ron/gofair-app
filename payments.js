/**
 * MTN MoMo + Airtel Money Collections integration ("Request to Pay").
 *
 * IMPORTANT — read before relying on this for real money:
 *
 * 1. This code follows each provider's *documented* request/response
 *    shapes as of when it was written. Telco APIs change field names and
 *    behavior between versions without much notice, and this sandbox has
 *    NO network access to momodeveloper.mtn.com or airtel.africa — so
 *    none of this has been tested against a real MTN/Airtel server.
 *    Test thoroughly against each provider's own sandbox with your own
 *    credentials, and re-check field names against their current docs,
 *    before trusting this with real transactions.
 *
 * 2. Sandbox API keys are free to obtain from each developer portal.
 *    PRODUCTION access needs KYC / business verification directly with
 *    MTN Uganda and Airtel Uganda — budget real time for this; developer
 *    forums show this approval step has been a genuine bottleneck for
 *    some Ugandan developers. An aggregator (Relworx, Flutterwave, Eversend,
 *    etc.) that already holds both telcos' merchant relationships is a
 *    faster path to a live integration if the direct route stalls —
 *    worth a look if MTN/Airtel approval takes too long.
 *
 * 3. SIMULATION MODE: until you set real credentials via the env vars
 *    below, both providers here fake a successful payment ~4 seconds
 *    after being asked — the same shape as a real customer approving a
 *    prompt on their phone. This lets you build and test the entire
 *    wallet top-up flow today. It switches to real API calls
 *    automatically the moment the credentials are present.
 */

const crypto = require('crypto');

const MOMO_ENABLED = !!process.env.MOMO_SUBSCRIPTION_KEY;
const AIRTEL_ENABLED = !!process.env.AIRTEL_CLIENT_ID;

if (!MOMO_ENABLED) console.warn('⚠ MTN MoMo credentials not set — MoMo top-ups run in SIMULATION MODE (see payments.js).');
if (!AIRTEL_ENABLED) console.warn('⚠ Airtel Money credentials not set — Airtel top-ups run in SIMULATION MODE (see payments.js).');

function normalizeUgandaMsisdn(phone) {
  let p = String(phone).replace(/[^\d]/g, '');
  if (p.startsWith('0')) p = '256' + p.slice(1);
  if (!p.startsWith('256')) p = '256' + p;
  return p;
}

// ==================== MTN MoMo (Collections / Request to Pay) ====================

const MOMO_BASE = process.env.MOMO_TARGET_ENVIRONMENT === 'production'
  ? 'https://momodeveloper.mtn.com'
  : 'https://sandbox.momodeveloper.mtn.com';

let momoTokenCache = null;

async function momoGetToken() {
  if (momoTokenCache && momoTokenCache.expiresAt > Date.now()) return momoTokenCache.token;
  const auth = Buffer.from(`${process.env.MOMO_API_USER}:${process.env.MOMO_API_KEY}`).toString('base64');
  const res = await fetch(`${MOMO_BASE}/collection/token/`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Ocp-Apim-Subscription-Key': process.env.MOMO_SUBSCRIPTION_KEY
    }
  });
  if (!res.ok) throw new Error(`MoMo token request failed: ${res.status}`);
  const data = await res.json();
  momoTokenCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
  return momoTokenCache.token;
}

// externalId is OUR reference (the wallet ledger entry id) — the provider
// echoes it back in status checks and webhook callbacks so we can match
// the payment to the right driver/entry without ambiguity.
async function momoRequestToPay({ amount, phoneNumber, externalId, payerMessage, payeeNote }) {
  if (!MOMO_ENABLED) return simulateProvider('momo', externalId);

  const providerReferenceId = crypto.randomUUID(); // MTN's own tracking id (X-Reference-Id), used for status polling
  const token = await momoGetToken();
  const res = await fetch(`${MOMO_BASE}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Reference-Id': providerReferenceId,
      'X-Target-Environment': process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox',
      'Ocp-Apim-Subscription-Key': process.env.MOMO_SUBSCRIPTION_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: String(amount),
      currency: process.env.MOMO_CURRENCY || 'UGX', // MTN's sandbox often only accepts EUR — switch per their current sandbox docs if testing there
      externalId,
      payer: { partyIdType: 'MSISDN', partyId: normalizeUgandaMsisdn(phoneNumber) },
      payerMessage: payerMessage || 'GoFair wallet top-up',
      payeeNote: payeeNote || 'Wallet top-up'
    })
  });
  if (res.status !== 202) {
    const text = await res.text().catch(() => '');
    throw new Error(`MoMo requestToPay failed: ${res.status} ${text}`);
  }
  return { providerReferenceId, provider: 'momo', simulated: false };
}

async function momoGetStatus(providerReferenceId) {
  if (!MOMO_ENABLED) return simulateStatusCheck(providerReferenceId);
  const token = await momoGetToken();
  const res = await fetch(`${MOMO_BASE}/collection/v1_0/requesttopay/${providerReferenceId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Target-Environment': process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox',
      'Ocp-Apim-Subscription-Key': process.env.MOMO_SUBSCRIPTION_KEY
    }
  });
  if (!res.ok) throw new Error(`MoMo status check failed: ${res.status}`);
  const data = await res.json();
  return { status: data.status, raw: data }; // PENDING | SUCCESSFUL | FAILED
}

// ==================== Airtel Money (Collections) ====================

const AIRTEL_BASE = process.env.AIRTEL_ENVIRONMENT === 'production'
  ? 'https://openapi.airtel.africa'
  : 'https://openapiuat.airtel.africa';

let airtelTokenCache = null;

async function airtelGetToken() {
  if (airtelTokenCache && airtelTokenCache.expiresAt > Date.now()) return airtelTokenCache.token;
  const res = await fetch(`${AIRTEL_BASE}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.AIRTEL_CLIENT_ID,
      client_secret: process.env.AIRTEL_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  if (!res.ok) throw new Error(`Airtel token request failed: ${res.status}`);
  const data = await res.json();
  airtelTokenCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
  return airtelTokenCache.token;
}

// `reference` is OUR ledger entry id, sent as both the payment reference
// and the transaction id so Airtel's callback/status response echoes it
// back for matching.
async function airtelRequestToPay({ amount, phoneNumber, reference }) {
  if (!AIRTEL_ENABLED) return simulateProvider('airtel', reference);

  const token = await airtelGetToken();
  const res = await fetch(`${AIRTEL_BASE}/merchant/v1/payments/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Country': 'UG',
      'X-Currency': 'UGX',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reference,
      subscriber: { country: 'UG', currency: 'UGX', msisdn: normalizeUgandaMsisdn(phoneNumber) },
      transaction: { amount, country: 'UG', currency: 'UGX', id: reference }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Airtel requestToPay failed: ${res.status} ${JSON.stringify(data)}`);
  return { providerReferenceId: reference, provider: 'airtel', simulated: false, raw: data };
}

async function airtelGetStatus(reference) {
  if (!AIRTEL_ENABLED) return simulateStatusCheck(reference);
  const token = await airtelGetToken();
  const res = await fetch(`${AIRTEL_BASE}/standard/v1/payments/${reference}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'X-Country': 'UG', 'X-Currency': 'UGX' }
  });
  if (!res.ok) throw new Error(`Airtel status check failed: ${res.status}`);
  const data = await res.json();
  const raw = data?.data?.transaction?.status || 'PENDING';
  return { status: mapAirtelStatus(raw), raw: data };
}
function mapAirtelStatus(s) {
  if (['TS', 'SUCCESS', 'SUCCESSFUL'].includes(s)) return 'SUCCESSFUL';
  if (['TF', 'FAILED'].includes(s)) return 'FAILED';
  return 'PENDING';
}

// ==================== Simulation mode ====================

const simulatedTransactions = new Map(); // referenceId -> { status, resolveAt }

function simulateProvider(provider, referenceId) {
  const id = referenceId || crypto.randomUUID();
  simulatedTransactions.set(id, { status: 'PENDING', resolveAt: Date.now() + 4000 });
  return Promise.resolve({ providerReferenceId: id, provider, simulated: true });
}
function simulateStatusCheck(referenceId) {
  const tx = simulatedTransactions.get(referenceId);
  if (!tx) return Promise.resolve({ status: 'FAILED', raw: { reason: 'unknown simulated transaction' } });
  if (tx.status === 'PENDING' && Date.now() >= tx.resolveAt) tx.status = 'SUCCESSFUL';
  return Promise.resolve({ status: tx.status, raw: { simulated: true } });
}

// ==================== Flutterwave (card payments — Visa/Mastercard) ====================
//
// Flutterwave is a Bank-of-Uganda-licensed Payment Service Provider that
// also covers Zambia and Malawi with the same integration — that matters
// here specifically because it means GoFair itself never needs its
// own payment-system license: Flutterwave is legally the one "operating
// the payment system," and GoFair is a merchant using their service,
// same as any e-commerce business. That licensing point is the whole
// reason this uses Flutterwave rather than a custom card form.
//
// Uses Flutterwave's Standard/Inline Checkout: the customer enters card
// details on Flutterwave's own secure page or modal — never inside this
// app — which also means GoFair never touches raw card numbers and
// has no PCI-DSS compliance burden.

const FLW_ENABLED = !!process.env.FLUTTERWAVE_SECRET_KEY;
if (!FLW_ENABLED) console.warn('⚠ Flutterwave credentials not set — card payments run in SIMULATION MODE (see payments.js).');

const FLW_BASE = 'https://api.flutterwave.com/v3';

// Creates a payment session. `txRef` is OUR reference (e.g. a ledger or
// card_fare_payments row id) — Flutterwave echoes it back on
// verification so we can match the payment to the right record.
async function flwInitiatePayment({ amount, currency, txRef, customerEmail, customerPhone, customerName, redirectUrl }) {
  if (!FLW_ENABLED) return simulateFlwInitiate(txRef);

  const res = await fetch(`${FLW_BASE}/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tx_ref: txRef,
      amount: String(amount),
      currency,
      redirect_url: redirectUrl || 'https://example.com/payment-complete',
      customer: {
        email: customerEmail || 'rider@gofair.app', // Flutterwave requires an email even where the app itself doesn't collect one
        phonenumber: customerPhone,
        name: customerName || 'GoFair user'
      },
      customizations: { title: 'GoFair', description: 'GoFair payment' }
    })
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(`Flutterwave payment initiation failed: ${JSON.stringify(data)}`);
  }
  return { link: data.data.link, txRef, simulated: false };
}

// Never trust a client-reported "payment succeeded" — always verify
// server-side against Flutterwave directly before crediting anything.
async function flwVerifyByTxRef(txRef) {
  if (!FLW_ENABLED) return simulateFlwVerify(txRef);

  const res = await fetch(`${FLW_BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`, {
    headers: { 'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
  });
  const data = await res.json();
  if (!res.ok) return { status: 'FAILED', raw: data };
  const successful = data.data?.status === 'successful' && data.data?.amount >= 0;
  return { status: successful ? 'SUCCESSFUL' : 'FAILED', amount: data.data?.amount, currency: data.data?.currency, raw: data };
}

// Pays a driver out directly to their mobile money number — used after a
// rider pays a fare by card, so the driver still gets paid the way
// they're used to (their own mobile money), just with the commission
// already deducted before it's sent rather than taken from their wallet.
async function flwPayoutToMobileMoney({ amount, currency, phoneNumber, reference, narration }) {
  if (!FLW_ENABLED) return simulateFlwPayout(reference);

  const res = await fetch(`${FLW_BASE}/transfers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      account_bank: 'MPS', // Flutterwave's mobile-money-as-bank code for Uganda; varies by country — verify in their current docs before going live elsewhere
      account_number: normalizeUgandaMsisdn(phoneNumber),
      amount,
      currency,
      reference,
      narration: narration || 'GoFair driver payout'
    })
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(`Flutterwave payout failed: ${JSON.stringify(data)}`);
  }
  return { transferId: data.data.id, simulated: false };
}

// ---- Flutterwave simulation mode ----
const simulatedFlwPayments = new Map();

function simulateFlwInitiate(txRef) {
  simulatedFlwPayments.set(txRef, { status: 'PENDING', resolveAt: Date.now() + 4000 });
  return Promise.resolve({ link: null, txRef, simulated: true });
}
function simulateFlwVerify(txRef) {
  const tx = simulatedFlwPayments.get(txRef);
  if (!tx) return Promise.resolve({ status: 'FAILED', raw: { reason: 'unknown simulated transaction' } });
  if (tx.status === 'PENDING' && Date.now() >= tx.resolveAt) tx.status = 'SUCCESSFUL';
  return Promise.resolve({ status: tx.status, raw: { simulated: true } });
}
function simulateFlwPayout(reference) {
  return Promise.resolve({ transferId: `sim_${reference}`, simulated: true });
}
module.exports = {
  MOMO_ENABLED, AIRTEL_ENABLED, FLW_ENABLED,
  momoRequestToPay, momoGetStatus,
  airtelRequestToPay, airtelGetStatus,
  flwInitiatePayment, flwVerifyByTxRef, flwPayoutToMobileMoney
};
