const { pool } = require('./db');

let counter = 1;
function nextId() {
  return `lst_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

const VALID_UNITS = ['kg', 'meter', 'piece', 'liter', 'dozen', 'other'];

// A simple, transparent keyword match — not AI, just a sensible
// starting guess based on common goods. The seller can always override
// it, or pick 'other' and type whatever unit actually fits (a sack, a
// bundle, a roll — anything).
const UNIT_KEYWORDS = {
  kg: ['rice', 'sugar', 'flour', 'beans', 'maize', 'meat', 'fish', 'potato', 'onion', 'tomato', 'charcoal', 'cement', 'sand', 'coffee', 'cassava', 'millet'],
  meter: ['fabric', 'cloth', 'wire', 'rope', 'cable', 'ribbon', 'timber', 'lumber', 'pipe', 'chain', 'hose'],
  liter: ['milk', 'oil', 'petrol', 'diesel', 'water', 'paint', 'juice', 'fuel', 'paraffin'],
  dozen: ['eggs'],
  piece: ['phone', 'shirt', 'shoe', 'book', 'chair', 'table', 'bag', 'bottle', 'egg', 'brick', 'tile', 'battery']
};

function suggestUnit(itemName) {
  const lower = (itemName || '').toLowerCase();
  for (const unit of ['dozen', 'kg', 'meter', 'liter', 'piece']) { // 'dozen' checked before 'piece' so "eggs" doesn't fall through to piece's singular "egg" match
    if (UNIT_KEYWORDS[unit].some(k => lower.includes(k))) return unit;
  }
  return null; // no confident guess — seller picks freely, including 'other'
}

async function createListing(driverId, { name, price, unit, unitCustomText, currency, photo }) {
  if (!name || !name.trim()) return { error: 'Enter what you\'re selling' };
  if (!price || price <= 0) return { error: 'Enter a valid price' };
  if (!VALID_UNITS.includes(unit)) return { error: 'Choose a valid unit' };
  if (unit === 'other' && (!unitCustomText || !unitCustomText.trim())) return { error: 'Describe the unit (e.g. "per sack", "per bundle")' };
  if (photo && !/^data:([^;]+);base64,(.+)$/.test(photo)) return { error: 'Invalid photo data' };

  const id = nextId();
  await pool.query(
    `INSERT INTO shop_listings (id, driver_id, name, photo_data, price, unit, unit_custom_text, currency, active, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9)`,
    [id, driverId, name.trim(), photo || null, price, unit, unit === 'other' ? unitCustomText.trim() : null, currency, Date.now()]
  );
  return { id };
}

async function listListingsForDriver(driverId) {
  const { rows } = await pool.query('SELECT * FROM shop_listings WHERE driver_id = $1 ORDER BY created_at DESC', [driverId]);
  return rows.map(rowToListing);
}

// Rider-facing browse — active listings from approved shops in a
// country. Joins against drivers so a shop that's been suspended or
// hasn't been approved yet never shows up here.
async function browseListings(country) {
  const { rows } = await pool.query(
    `SELECT sl.*, d.full_name AS shop_name, d.phone AS shop_phone, d.id AS shop_driver_id
     FROM shop_listings sl
     JOIN drivers d ON d.id = sl.driver_id
     WHERE sl.active = TRUE AND d.status = 'approved' AND d.country = $1
     ORDER BY sl.created_at DESC`,
    [country]
  );
  return rows.map(r => ({ ...rowToListing(r), shopName: r.shop_name, shopDriverId: r.shop_driver_id }));
}

async function getListing(id) {
  const { rows } = await pool.query(
    `SELECT sl.*, d.status AS shop_status, d.country AS shop_country, d.full_name AS shop_name, d.phone AS shop_phone
     FROM shop_listings sl JOIN drivers d ON d.id = sl.driver_id WHERE sl.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  return { ...rowToListing(rows[0]), shopStatus: rows[0].shop_status, shopCountry: rows[0].shop_country, shopName: rows[0].shop_name, shopPhone: rows[0].shop_phone };
}

async function setListingActive(id, driverId, active) {
  const { rowCount } = await pool.query('UPDATE shop_listings SET active = $1 WHERE id = $2 AND driver_id = $3', [active, id, driverId]);
  return rowCount > 0;
}
async function deleteListing(id, driverId) {
  const { rowCount } = await pool.query('DELETE FROM shop_listings WHERE id = $1 AND driver_id = $2', [id, driverId]);
  return rowCount > 0;
}

function rowToListing(r) {
  return {
    id: r.id, driverId: r.driver_id, name: r.name, photo: r.photo_data,
    price: Number(r.price), unit: r.unit, unitCustomText: r.unit_custom_text,
    currency: r.currency, active: r.active, createdAt: Number(r.created_at)
  };
}

module.exports = { suggestUnit, createListing, listListingsForDriver, browseListings, getListing, setListingActive, deleteListing, VALID_UNITS };
