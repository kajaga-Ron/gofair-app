/**
 * One-time migration: imports driver accounts from the old data/db.json
 * (lowdb) file into Postgres. Only needed if you were running the
 * previous JSON-file version and want to keep that test data — a fresh
 * setup can skip this entirely.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node migrate-from-json.js
 *
 * Safe to run more than once — it skips any driver phone number that
 * already exists in Postgres rather than duplicating it.
 */

const fs = require('fs');
const path = require('path');
const { pool, initSchema } = require('./db');
const documents = require('./documents');

const OLD_DB_PATH = path.join(__dirname, 'data', 'db.json');

async function main() {
  if (!fs.existsSync(OLD_DB_PATH)) {
    console.log('No data/db.json found — nothing to migrate.');
    process.exit(0);
  }

  await initSchema();
  const old = JSON.parse(fs.readFileSync(OLD_DB_PATH, 'utf8'));
  const oldDrivers = old.drivers || [];
  console.log(`Found ${oldDrivers.length} driver(s) in data/db.json.`);

  let imported = 0, skipped = 0;
  for (const d of oldDrivers) {
    const { rows } = await pool.query('SELECT id FROM drivers WHERE phone = $1', [d.phone]);
    if (rows.length) { skipped++; continue; }

    // old records stored photos as base64 inline — write them to disk now
    const documentPhotoPath = d.documents?.documentPhoto ? documents.saveDocument(d.id, 'document', d.documents.documentPhoto) : null;
    const selfiePath = d.documents?.selfie ? documents.saveDocument(d.id, 'selfie', d.documents.selfie) : null;

    await pool.query(`
      INSERT INTO drivers (
        id, phone, password_hash, full_name, document_type, document_number,
        vehicle_type, vehicle_plate, vehicle_model, document_photo_path, selfie_path,
        status, review_note, submitted_at, reviewed_at, wallet_balance
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [
      d.id, d.phone, d.passwordHash, d.fullName, d.documentType, d.documentNumber,
      d.vehicleType || 'car', d.vehiclePlate, d.vehicleModel || null, documentPhotoPath, selfiePath,
      d.status, d.reviewNote || '', d.submittedAt, d.reviewedAt || null, d.walletBalance || 0
    ]);

    for (const entry of (d.ledger || [])) {
      await pool.query(`
        INSERT INTO ledger_entries (id, driver_id, type, provider, amount, momo_ref, provider_reference_id, status, note, ts, decided_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO NOTHING
      `, [
        entry.id, d.id, entry.type, entry.provider || null, entry.amount,
        entry.momoRef || null, entry.providerReferenceId || null, entry.status,
        entry.note || '', entry.ts, entry.decidedAt || null
      ]);
    }
    imported++;
  }

  console.log(`Migration complete: ${imported} imported, ${skipped} skipped (already existed).`);
  process.exit(0);
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
