/**
 * Admin-editable overrides for fare rates and commission rates.
 *
 * Before this existed, every price adjustment — a fare too high in one
 * country, a commission rate that needs tweaking — required a code
 * change, a GitHub upload, and a Render redeploy. This lets an admin
 * change those numbers directly from the admin panel, in seconds.
 *
 * Key scheme:
 *   rate:<country>:<vehicleType>   -> { base, perKm }   (overrides config.js country rates)
 *   wasteRate:<country>            -> { collectionFee, recyclingPerKg }
 *   commission:<category>:<subType> -> number 0-1       (overrides categories.js commissionRate)
 *
 * A small in-memory cache avoids a database round-trip on every single
 * fare calculation — refreshed on every write, and reloaded fresh on
 * server start.
 */

const { pool } = require('./db');

let cache = null; // Map<key, value> once loaded

async function loadCache() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  cache = new Map(rows.map(r => [r.key, r.value]));
}

async function ensureCacheLoaded() {
  if (!cache) await loadCache();
}

async function getSetting(key) {
  await ensureCacheLoaded();
  return cache.has(key) ? cache.get(key) : null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, JSON.stringify(value), Date.now()]
  );
  await ensureCacheLoaded();
  cache.set(key, value);
}

async function deleteSetting(key) {
  await pool.query('DELETE FROM settings WHERE key = $1', [key]);
  await ensureCacheLoaded();
  cache.delete(key);
}

async function getAllSettings() {
  await ensureCacheLoaded();
  return Object.fromEntries(cache.entries());
}

// Convenience helpers for the two specific things that need overriding
async function getRateOverride(country, vehicleType) {
  return getSetting(`rate:${country}:${vehicleType}`);
}
async function setRateOverride(country, vehicleType, base, perKm) {
  return setSetting(`rate:${country}:${vehicleType}`, { base, perKm });
}
async function getWasteRateOverride(country) {
  return getSetting(`wasteRate:${country}`);
}
async function setWasteRateOverride(country, collectionFee, recyclingPerKg) {
  return setSetting(`wasteRate:${country}`, { collectionFee, recyclingPerKg });
}
async function getCommissionOverride(category, subType) {
  return getSetting(`commission:${category}:${subType}`);
}
async function setCommissionOverride(category, subType, rate) {
  return setSetting(`commission:${category}:${subType}`, rate);
}

module.exports = {
  getSetting, setSetting, deleteSetting, getAllSettings,
  getRateOverride, setRateOverride, getWasteRateOverride, setWasteRateOverride,
  getCommissionOverride, setCommissionOverride
};
