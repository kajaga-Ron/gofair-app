/**
 * Ratings, and the priority-access mechanic they drive.
 *
 * Design choice: a highly-rated driver gets a new request the instant it
 * appears; everyone else in that vehicle-type pool gets it DRIVER_PRIORITY_DELAY_MS
 * later if it's still unclaimed. A brand-new driver (fewer than
 * MIN_RATINGS_FOR_TIERING trips) is treated as high-tier too, on the
 * logic that nobody should be locked out of ever earning enough trips to
 * build a real rating in the first place — that's a deliberate choice,
 * not an oversight, since permanently hiding requests from low-rated
 * drivers risks a spiral where they can never improve.
 */

const { pool } = require('./db');

const HIGH_TIER_MIN_RATING = Number(process.env.HIGH_TIER_MIN_RATING || 4.5);
const MIN_RATINGS_FOR_TIERING = Number(process.env.MIN_RATINGS_FOR_TIERING || 3);
const PRIORITY_DELAY_MS = Number(process.env.DRIVER_PRIORITY_DELAY_MS || 20000);

let counter = 1;
function nextId() {
  return `rat_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

async function addRating(driverId, riderPhone, stars) {
  const id = nextId();
  await pool.query(
    'INSERT INTO ratings (id, driver_id, rider_phone, stars, ts) VALUES ($1,$2,$3,$4,$5)',
    [id, driverId, riderPhone, stars, Date.now()]
  );
  return getDriverRatingSummary(driverId);
}

async function getDriverRatingSummary(driverId) {
  const { rows } = await pool.query(
    'SELECT AVG(stars)::numeric(10,2) AS avg, COUNT(*)::int AS count FROM ratings WHERE driver_id = $1',
    [driverId]
  );
  return { avg: rows[0].avg ? Number(rows[0].avg) : null, count: rows[0].count };
}

// Batch version for splitting a room full of connected drivers into tiers
// without a query per driver.
async function getRatingSummaries(driverIds) {
  if (!driverIds.length) return {};
  const { rows } = await pool.query(
    `SELECT driver_id, AVG(stars)::numeric(10,2) AS avg, COUNT(*)::int AS count
     FROM ratings WHERE driver_id = ANY($1::text[]) GROUP BY driver_id`,
    [driverIds]
  );
  const byId = {};
  driverIds.forEach(id => { byId[id] = { avg: null, count: 0 }; });
  rows.forEach(r => { byId[r.driver_id] = { avg: Number(r.avg), count: r.count }; });
  return byId;
}

function isHighTier(summary) {
  if (!summary || summary.count < MIN_RATINGS_FOR_TIERING) return true; // new driver grace period
  return summary.avg >= HIGH_TIER_MIN_RATING;
}

module.exports = { addRating, getDriverRatingSummary, getRatingSummaries, isHighTier, PRIORITY_DELAY_MS, HIGH_TIER_MIN_RATING, MIN_RATINGS_FOR_TIERING };
