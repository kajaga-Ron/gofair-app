/**
 * Persistent trip history.
 *
 * The live negotiation (open requests, back-and-forth offers) stays in
 * server memory — it's short-lived, needs to be fast, and losing an
 * in-progress negotiation on a restart is a minor inconvenience (just
 * try again). But before this file existed, that was true of EVERY
 * trip, including ones that had already completed and had real money
 * change hands — there was no permanent record anywhere. This module
 * fixes that: the final outcome of a trip is written here once, at the
 * moment it actually ends, regardless of how it ended.
 */

const { pool } = require('./db');

let counter = 1;
function nextId() {
  return `trip_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

async function recordTrip({
  requestId, threadId, riderPhone, riderName, driverId, driverName,
  serviceCategory, vehicleType, country, currency,
  pickupName, dropName, pickup, drop, km,
  finalPrice, commissionAmount, commissionRate, paymentMethod,
  status, cancelledBy, penalized, ratingStars, createdAt
}) {
  const id = nextId();
  await pool.query(
    `INSERT INTO trips (
      id, request_id, thread_id, rider_phone, rider_name, driver_id, driver_name,
      service_category, vehicle_type, country, currency,
      pickup_name, drop_name, pickup_lat, pickup_lng, drop_lat, drop_lng, km,
      final_price, commission_amount, commission_rate, payment_method,
      status, cancelled_by, penalized, rating_stars, created_at, ended_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
    [
      id, requestId || null, threadId || null, riderPhone || null, riderName || null, driverId || null, driverName || null,
      serviceCategory || 'ride', vehicleType || null, country || 'UG', currency || null,
      pickupName || null, dropName || null,
      pickup ? pickup[0] : null, pickup ? pickup[1] : null, drop ? drop[0] : null, drop ? drop[1] : null, km || null,
      finalPrice || null, commissionAmount || null, commissionRate || null, paymentMethod || null,
      status, cancelledBy || null, !!penalized, ratingStars || null, createdAt || Date.now(), Date.now()
    ]
  );
  return { id };
}

// Attaches a rating to an already-recorded trip — ratings happen after
// the trip record is written, since the rider rates on the "trip done"
// screen which appears after completion.
async function attachRatingToTrip(threadId, stars) {
  await pool.query('UPDATE trips SET rating_stars = $1 WHERE thread_id = $2', [stars, threadId]);
}

async function listTripsForDriver(driverId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM trips WHERE driver_id = $1 ORDER BY ended_at DESC LIMIT $2', [driverId, limit]
  );
  return rows;
}
async function listTripsForRider(riderPhone, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM trips WHERE rider_phone = $1 ORDER BY ended_at DESC LIMIT $2', [riderPhone, limit]
  );
  return rows;
}
async function getTripByThreadId(threadId) {
  const { rows } = await pool.query('SELECT * FROM trips WHERE thread_id = $1', [threadId]);
  return rows[0] || null;
}
// For the admin panel — a simple, real look at what's actually happened
// on the platform, rather than no historical view at all.
async function listRecentTrips(limit = 100) {
  const { rows } = await pool.query('SELECT * FROM trips ORDER BY ended_at DESC LIMIT $1', [limit]);
  return rows;
}

module.exports = { recordTrip, attachRatingToTrip, listTripsForDriver, listTripsForRider, getTripByThreadId, listRecentTrips };
