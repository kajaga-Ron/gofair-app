/**
 * Driver accounts + verification workflow — Postgres-backed.
 *
 * This replaces the earlier lowdb (JSON file) version. Same exported
 * function names as before so server.js and payments.js barely change,
 * but every function is now async (real SQL queries) instead of
 * synchronous — callers must await them.
 *
 * Document photos (ID, selfie) are no longer stored inline as base64 —
 * see documents.js. Only the file path is kept here.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const documents = require('./documents');
const ratings = require('./ratings');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-this';
if (JWT_SECRET === 'dev-only-secret-change-this') {
  console.warn('⚠ JWT_SECRET not set — using an insecure default. Set a real JWT_SECRET env var before deploying.');
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';
if (ADMIN_PASSWORD === 'changeme123') {
  console.warn('⚠ ADMIN_PASSWORD not set — using an insecure default. Set a real ADMIN_PASSWORD env var before deploying.');
}

const MIN_WALLET_BALANCE = Number(process.env.DRIVER_MIN_WALLET_UGX || 5000);
const COMMISSION_RATE = Number(process.env.COMMISSION_RATE || 0.07);

let counter = 1;
function nextId(prefix = 'drv') {
  return `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

// ---- row <-> JS object mapping (DB is snake_case, JS stays camelCase) ----

const config = require('./config');
const categories = require('./categories');

function rowToDriver(row) {
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    country: row.country || config.DEFAULT_COUNTRY,
    serviceCategory: row.service_category || 'ride',
    documentType: row.document_type,
    documentNumber: row.document_number,
    vehicleType: row.vehicle_type, // doubles as sub-type for non-vehicle categories
    vehiclePlate: row.vehicle_plate,
    vehicleModel: row.vehicle_model,
    vehicleColor: row.vehicle_color,
    trustRefereeName: row.trust_referee_name,
    trustRefereePhone: row.trust_referee_phone,
    trustRefereeType: row.trust_referee_type,
    fixedRate: row.fixed_rate ? Number(row.fixed_rate) : null,
    status: row.status,
    reviewNote: row.review_note,
    submittedAt: Number(row.submitted_at),
    reviewedAt: row.reviewed_at ? Number(row.reviewed_at) : null,
    walletBalance: Number(row.wallet_balance)
  };
}
function rowToLedgerEntry(row) {
  return {
    id: row.id,
    type: row.type,
    provider: row.provider || undefined,
    amount: Number(row.amount),
    momoRef: row.momo_ref || undefined,
    providerReferenceId: row.provider_reference_id || undefined,
    status: row.status,
    note: row.note,
    ts: Number(row.ts),
    decidedAt: row.decided_at ? Number(row.decided_at) : undefined
  };
}

function publicDriverView(d) {
  const { passwordHash, ...safe } = d;
  return safe;
}

async function findByPhone(phone) {
  const { rows } = await pool.query('SELECT * FROM drivers WHERE phone = $1', [phone]);
  return rowToDriver(rows[0]);
}
async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM drivers WHERE id = $1', [id]);
  return rowToDriver(rows[0]);
}

async function registerOrResubmit({ phone, password, fullName, country, serviceCategory, documentType, documentNumber, vehicleType, vehiclePlate, vehicleModel, vehicleColor, trustRefereeName, trustRefereePhone, trustRefereeType, fixedRate, documentPhoto, selfie }) {
  const existing = await findByPhone(phone);
  if (existing && existing.status === 'approved') {
    return { error: 'An approved driver account already exists for this phone number. Please log in instead.' };
  }
  const countryCode = config.isValidCountry(country) ? country : config.DEFAULT_COUNTRY;
  const categoryCode = categories.isValidCategory(serviceCategory) ? serviceCategory : 'ride';
  const categoryDef = categories.getCategory(categoryCode);
  const pricingModel = categories.pricingModelFor(categoryCode, vehicleType);

  if (categoryDef.requiresVehicle && (!vehicleType || !vehiclePlate)) {
    return { error: `${categoryDef.label} requires a vehicle type and plate number.` };
  }
  if (!categoryDef.requiresVehicle && !vehicleType) {
    return { error: `Choose what kind of ${categoryDef.label.toLowerCase()} you're offering.` };
  }
  if (categoryDef.requiresTrustReferee && (!trustRefereeName || !trustRefereePhone)) {
    return { error: `${categoryDef.label} requires a referee's name and phone number — someone who can vouch for you, such as your LC1 chairperson.` };
  }
  if (pricingModel === 'fixed_by_provider' && (!fixedRate || fixedRate <= 0)) {
    return { error: `Set the rate you charge for this work — customers will see this price upfront before booking you.` };
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const id = existing ? existing.id : nextId();

  // Save photos to disk AFTER we know the driver id, so they land in that driver's folder
  const documentPhotoPath = documents.saveDocument(id, 'document', documentPhoto);
  const selfiePath = documents.saveDocument(id, 'selfie', selfie);
  const storedFixedRate = pricingModel === 'fixed_by_provider' ? fixedRate : null;

  if (existing) {
    await pool.query(`
      UPDATE drivers SET
        password_hash = $1, full_name = $2, country = $3, service_category = $4, document_type = $5, document_number = $6,
        vehicle_type = $7, vehicle_plate = $8, vehicle_model = $9, vehicle_color = $10,
        trust_referee_name = $11, trust_referee_phone = $12, trust_referee_type = $13, fixed_rate = $14,
        document_photo_path = $15, selfie_path = $16,
        status = 'pending', review_note = '', submitted_at = $17, reviewed_at = NULL
      WHERE id = $18
    `, [passwordHash, fullName, countryCode, categoryCode, documentType, documentNumber, vehicleType, vehiclePlate, vehicleModel, vehicleColor,
        trustRefereeName || null, trustRefereePhone || null, trustRefereeType || null, storedFixedRate,
        documentPhotoPath, selfiePath, Date.now(), id]);
  } else {
    await pool.query(`
      INSERT INTO drivers (
        id, phone, password_hash, full_name, country, service_category, document_type, document_number,
        vehicle_type, vehicle_plate, vehicle_model, vehicle_color,
        trust_referee_name, trust_referee_phone, trust_referee_type, fixed_rate,
        document_photo_path, selfie_path, status, review_note, submitted_at, wallet_balance
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending','',$19,0)
    `, [id, phone, passwordHash, fullName, countryCode, categoryCode, documentType, documentNumber,
        vehicleType, vehiclePlate, vehicleModel, vehicleColor,
        trustRefereeName || null, trustRefereePhone || null, trustRefereeType || null, storedFixedRate,
        documentPhotoPath, selfiePath, Date.now()]);
  }
  return { driver: await findById(id) };
}

async function login({ phone, password }) {
  const driver = await findByPhone(phone);
  if (!driver) return { error: 'No account found for that phone number.' };
  if (!bcrypt.compareSync(password, driver.passwordHash)) return { error: 'Incorrect password.' };
  return { driver };
}

function signDriverToken(driver) {
  return jwt.sign({ driverId: driver.id }, JWT_SECRET, { expiresIn: '30d' });
}
async function verifyDriverToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return await findById(payload.driverId);
  } catch (e) {
    return null;
  }
}

function signAdminToken() {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
}
function verifyAdminToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET).role === 'admin';
  } catch (e) {
    return false;
  }
}

async function listByStatus(status) {
  const { rows } = status && status !== 'all'
    ? await pool.query('SELECT * FROM drivers WHERE status = $1 ORDER BY submitted_at DESC', [status])
    : await pool.query('SELECT * FROM drivers ORDER BY submitted_at DESC');
  return rows.map(rowToDriver).map(publicDriverView);
}

async function setStatus(id, status, note) {
  const { rowCount } = await pool.query(
    'UPDATE drivers SET status = $1, review_note = $2, reviewed_at = $3 WHERE id = $4',
    [status, note || '', Date.now(), id]
  );
  if (!rowCount) return { error: 'Driver not found' };
  return { driver: await findById(id) };
}

// Path lookup for the admin document-viewing route (server.js) — never
// exposed to the client directly, only used server-side to stream bytes.
async function getDocumentDiskPath(driverId, field) {
  const { rows } = await pool.query('SELECT document_photo_path, selfie_path FROM drivers WHERE id = $1', [driverId]);
  if (!rows[0]) return null;
  const relPath = field === 'selfie' ? rows[0].selfie_path : rows[0].document_photo_path;
  return documents.getDocumentPath(relPath);
}

// ---------------- Wallet: top-ups + commission ----------------

// The real minimum balance for THIS driver — depends on both their
// country (currency/cost of living) and their service category (some
// categories, like household services, use a trust referee instead of
// a cash deposit; delivery couriers carry a smaller per-job risk than a
// ride driver, so their deposit is a fraction of the ride amount).
function minDepositFor(driver) {
  const categoryDef = categories.getCategory(driver.serviceCategory);
  if (!categoryDef.requiresDeposit) return 0;
  const country = config.getCountry(driver.country);
  const multiplier = categoryDef.minDepositMultiplier || 1;
  return Math.round(country.minWalletBalance * multiplier);
}

async function walletView(driver) {
  const { rows } = await pool.query('SELECT * FROM ledger_entries WHERE driver_id = $1 ORDER BY ts DESC', [driver.id]);
  const country = config.getCountry(driver.country);
  const categoryRate = categories.commissionRateFor(driver.serviceCategory, driver.vehicleType);
  const baseRate = categoryRate !== null ? categoryRate : COMMISSION_RATE;
  const ratingSummary = await ratings.getDriverRatingSummary(driver.id);
  const rewardEligible = ratings.isRewardEligible(ratingSummary);
  return {
    walletBalance: driver.walletBalance || 0,
    minBalance: minDepositFor(driver),
    currency: country.currency,
    commissionRate: ratings.applyRewardDiscount(baseRate, ratingSummary),
    baseCommissionRate: baseRate,
    rewardEligible,
    rewardThreshold: { minRating: ratings.REWARD_MIN_RATING, minCompleted: ratings.REWARD_MIN_COMPLETED, discount: ratings.REWARD_COMMISSION_DISCOUNT },
    currentRating: ratingSummary,
    freeTrialMode: isFreeTrialMode(),
    depositRequired: categories.getCategory(driver.serviceCategory).requiresDeposit,
    ledger: rows.map(rowToLedgerEntry)
  };
}

// Set FREE_TRIAL_MODE=true in your hosting environment to let every
// driver receive ride requests regardless of wallet balance — useful for
// an introductory period where you want people to try the app without
// any deposit. Flip it back to false (or remove it) whenever you're
// ready to start requiring the deposit again — no code changes needed
// either time, no drivers need to re-register, nothing else changes.
function isFreeTrialMode() {
  return process.env.FREE_TRIAL_MODE === 'true';
}

function hasSufficientBalance(driver) {
  if (isFreeTrialMode()) return true;
  if (!categories.getCategory(driver.serviceCategory).requiresDeposit) return true;
  return (driver.walletBalance || 0) >= minDepositFor(driver);
}

async function requestTopup(driverId, amount, momoRef) {
  const driver = await findById(driverId);
  if (!driver) return { error: 'Driver not found' };
  if (!amount || amount <= 0) return { error: 'Enter a valid amount' };
  const entry = { id: nextId('led'), type: 'topup', amount, momoRef: momoRef || '', status: 'pending', ts: Date.now() };
  await pool.query(
    `INSERT INTO ledger_entries (id, driver_id, type, amount, momo_ref, status, ts) VALUES ($1,$2,'topup',$3,$4,'pending',$5)`,
    [entry.id, driverId, amount, momoRef || '', entry.ts]
  );
  return { driver: await findById(driverId), entry };
}

async function listPendingTopups() {
  const { rows } = await pool.query(`
    SELECT l.*, d.full_name AS driver_name, d.phone AS driver_phone
    FROM ledger_entries l JOIN drivers d ON d.id = l.driver_id
    WHERE l.type = 'topup' AND l.status = 'pending'
    ORDER BY l.ts DESC
  `);
  return rows.map(r => ({ driverId: r.driver_id, driverName: r.driver_name, driverPhone: r.driver_phone, ...rowToLedgerEntry(r) }));
}

async function decideTopup(driverId, topupId, approve, note) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM ledger_entries WHERE id = $1 AND driver_id = $2 AND type = 'topup' FOR UPDATE`,
      [topupId, driverId]
    );
    const entry = rows[0];
    if (!entry || !['pending', 'processing'].includes(entry.status)) {
      await client.query('ROLLBACK');
      return { error: 'Top-up request not found or already handled' };
    }
    const newStatus = approve ? 'confirmed' : 'rejected';
    await client.query(
      'UPDATE ledger_entries SET status = $1, note = $2, decided_at = $3 WHERE id = $4',
      [newStatus, note || '', Date.now(), topupId]
    );
    if (approve) {
      await client.query('UPDATE drivers SET wallet_balance = wallet_balance + $1 WHERE id = $2', [entry.amount, driverId]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { driver: await findById(driverId) };
}

async function createProviderTopup(driverId, amount, provider) {
  const driver = await findById(driverId);
  if (!driver) return { error: 'Driver not found' };
  const entry = { id: nextId('led'), type: 'topup', provider, amount, status: 'processing', ts: Date.now() };
  await pool.query(
    `INSERT INTO ledger_entries (id, driver_id, type, provider, amount, status, ts) VALUES ($1,$2,'topup',$3,$4,'processing',$5)`,
    [entry.id, driverId, provider, amount, entry.ts]
  );
  return { driver: await findById(driverId), entry };
}

async function attachProviderReference(driverId, entryId, providerReferenceId) {
  await pool.query(
    'UPDATE ledger_entries SET provider_reference_id = $1 WHERE id = $2 AND driver_id = $3',
    [providerReferenceId, entryId, driverId]
  );
}

async function getTopupEntry(driverId, entryId) {
  const { rows } = await pool.query(
    `SELECT * FROM ledger_entries WHERE id = $1 AND driver_id = $2 AND type = 'topup'`,
    [entryId, driverId]
  );
  return rows[0] ? rowToLedgerEntry(rows[0]) : null;
}

async function findTopupByEntryIdGlobal(entryId) {
  const { rows } = await pool.query(`SELECT * FROM ledger_entries WHERE id = $1 AND type = 'topup'`, [entryId]);
  if (!rows[0]) return null;
  return { driverId: rows[0].driver_id, entry: rowToLedgerEntry(rows[0]) };
}

async function deductCommission(driverId, fareAmount, rateOverride) {
  const rate = rateOverride !== undefined && rateOverride !== null ? rateOverride : COMMISSION_RATE;
  const commission = Math.round(fareAmount * rate);
  const client = await pool.connect();
  let newBalance;
  try {
    await client.query('BEGIN');
    const entry = { id: nextId('led'), ts: Date.now() };
    await client.query(
      `INSERT INTO ledger_entries (id, driver_id, type, amount, status, note, ts) VALUES ($1,$2,'commission',$3,'applied',$4,$5)`,
      [entry.id, driverId, -commission, `${Math.round(rate * 100)}% commission on ${fareAmount.toLocaleString()}`, entry.ts]
    );
    const { rows } = await client.query(
      'UPDATE drivers SET wallet_balance = wallet_balance - $1 WHERE id = $2 RETURNING wallet_balance',
      [commission, driverId]
    );
    newBalance = Number(rows[0].wallet_balance);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { driver: await findById(driverId), commission, newBalance };
}

// ---------------- Card fare payments (rider pays by card, driver paid out directly) ----------------
// This money never touches the driver's wallet_balance — it flows
// straight from the rider's card, through Flutterwave, to the driver's
// mobile money, with the commission simply never included in that
// payout. These rows exist purely as a transparent record for admin and
// driver history, not as a mechanism that moves wallet_balance.

async function createCardFarePayment({ threadId, driverId, riderPhone, fareAmount, commission, currency }) {
  const id = nextId('cfp');
  const payoutAmount = fareAmount - commission;
  await pool.query(
    `INSERT INTO card_fare_payments (id, thread_id, driver_id, rider_phone, fare_amount, commission, payout_amount, currency, status, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
    [id, threadId, driverId, riderPhone, fareAmount, commission, payoutAmount, currency, Date.now()]
  );
  return { id, payoutAmount };
}

async function getCardFarePayment(id) {
  const { rows } = await pool.query('SELECT * FROM card_fare_payments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function updateCardFarePayment(id, fields) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = $${i++}`);
    values.push(value);
  }
  values.push(id);
  await pool.query(`UPDATE card_fare_payments SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

async function listCardFarePayments(driverId) {
  const { rows } = await pool.query('SELECT * FROM card_fare_payments WHERE driver_id = $1 ORDER BY ts DESC', [driverId]);
  return rows;
}

// ---------------- Support / safety reports ----------------

async function createSupportReport({ reporterRole, reporterPhone, threadId, message }) {
  const id = nextId('sup');
  await pool.query(
    'INSERT INTO support_reports (id, reporter_role, reporter_phone, thread_id, message, status, ts) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, reporterRole, reporterPhone || null, threadId || null, message, 'open', Date.now()]
  );
  return { id };
}

async function listSupportReports(status) {
  const { rows } = status && status !== 'all'
    ? await pool.query('SELECT * FROM support_reports WHERE status = $1 ORDER BY ts DESC', [status])
    : await pool.query('SELECT * FROM support_reports ORDER BY ts DESC');
  return rows;
}

async function resolveSupportReport(id) {
  await pool.query("UPDATE support_reports SET status = 'resolved' WHERE id = $1", [id]);
}

module.exports = {
  publicDriverView, registerOrResubmit, login,
  signDriverToken, verifyDriverToken, signAdminToken, verifyAdminToken,
  listByStatus, setStatus, findById, getDocumentDiskPath,
  walletView, hasSufficientBalance, requestTopup, listPendingTopups, decideTopup, deductCommission,
  createProviderTopup, attachProviderReference, getTopupEntry, findTopupByEntryIdGlobal,
  createCardFarePayment, getCardFarePayment, updateCardFarePayment, listCardFarePayments,
  createSupportReport, listSupportReports, resolveSupportReport,
  isFreeTrialMode, COMMISSION_RATE, ADMIN_PASSWORD
};
