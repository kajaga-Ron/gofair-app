/**
 * Riders don't need the driver's full verification workflow — no ID,
 * no admin approval — but they do need a stable identity so that a
 * "cancelled after the driver arrived" penalty actually follows them to
 * their next request instead of resetting the moment they refresh the
 * app. Phone number is that identity: light enough not to add friction,
 * durable enough to be worth tracking.
 */

const { pool } = require('./db');

const CANCELLATION_PENALTY_PCT = Number(process.env.RIDER_CANCELLATION_PENALTY_PCT || 0.15);

async function findOrCreateRider(phone, fullName) {
  const { rows } = await pool.query('SELECT * FROM riders WHERE phone = $1', [phone]);
  if (rows.length) {
    // keep the display name fresh in case they changed it
    if (fullName && fullName !== rows[0].full_name) {
      await pool.query('UPDATE riders SET full_name = $1 WHERE phone = $2', [fullName, phone]);
    }
    return rowToRider(rows[0]);
  }
  await pool.query(
    'INSERT INTO riders (phone, full_name, created_at) VALUES ($1,$2,$3)',
    [phone, fullName || 'Rider', Date.now()]
  );
  const { rows: created } = await pool.query('SELECT * FROM riders WHERE phone = $1', [phone]);
  return rowToRider(created[0]);
}

function rowToRider(row) {
  if (!row) return null;
  return {
    phone: row.phone,
    fullName: row.full_name,
    cancellationPenaltyActive: row.cancellation_penalty_active,
    cancellationPenaltyPct: Number(row.cancellation_penalty_pct),
    cancellationStrikes: row.cancellation_strikes
  };
}

// Called when a rider cancels AFTER the driver has already arrived —
// the one scenario worth discouraging, since cancelling before that
// costs the driver comparatively little.
async function applyCancellationPenalty(phone) {
  await pool.query(
    `UPDATE riders SET cancellation_penalty_active = TRUE, cancellation_penalty_pct = $1, cancellation_strikes = cancellation_strikes + 1 WHERE phone = $2`,
    [CANCELLATION_PENALTY_PCT, phone]
  );
}

// Read-only check used while showing the rider a suggested fare, so they
// see the bumped number before they commit to requesting again.
async function peekPenalty(phone) {
  const { rows } = await pool.query(
    'SELECT cancellation_penalty_active, cancellation_penalty_pct FROM riders WHERE phone = $1',
    [phone]
  );
  if (!rows.length || !rows[0].cancellation_penalty_active) return { active: false, pct: 0 };
  return { active: true, pct: Number(rows[0].cancellation_penalty_pct) };
}

// Called once the rider actually submits a new request — the fine is a
// one-time nudge, not a permanent surcharge.
async function consumePenalty(phone) {
  await pool.query(
    'UPDATE riders SET cancellation_penalty_active = FALSE, cancellation_penalty_pct = 0 WHERE phone = $1',
    [phone]
  );
}

module.exports = { findOrCreateRider, applyCancellationPenalty, peekPenalty, consumePenalty, CANCELLATION_PENALTY_PCT };
