/**
 * Postgres connection + schema.
 *
 * Works unchanged against a local Postgres install (for development) or
 * a Supabase project (for production) — Supabase's database IS Postgres,
 * so the same connection string shape and the same SQL below both work.
 * Only the connection string differs.
 *
 * Local dev:   DATABASE_URL=postgres://fairfare:yourpassword@localhost:5432/fairfare
 * Supabase:    DATABASE_URL=postgres://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
 *              (find this under Project Settings -> Database -> Connection string)
 */

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('✖ DATABASE_URL is not set. See README.md for local Postgres or Supabase setup.');
  process.exit(1);
}

// Supabase (and most managed Postgres) requires SSL; local dev typically doesn't use it.
const needsSSL = /supabase\.co|sslmode=require/.test(connectionString) || process.env.PGSSL === 'require';

const pool = new Pool({
  connectionString,
  ssl: needsSSL ? { rejectUnauthorized: false } : false
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id               TEXT PRIMARY KEY,
      phone            TEXT UNIQUE NOT NULL,
      password_hash    TEXT NOT NULL,
      full_name        TEXT NOT NULL,
      country          TEXT NOT NULL DEFAULT 'UG',
      document_type    TEXT NOT NULL,
      document_number  TEXT NOT NULL,
      vehicle_type     TEXT NOT NULL,
      vehicle_plate    TEXT NOT NULL,
      vehicle_model    TEXT,
      document_photo_path TEXT,
      selfie_path      TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      review_note      TEXT NOT NULL DEFAULT '',
      submitted_at     BIGINT NOT NULL,
      reviewed_at      BIGINT,
      wallet_balance   BIGINT NOT NULL DEFAULT 0
    );
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UG';

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id                   TEXT PRIMARY KEY,
      driver_id            TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      type                 TEXT NOT NULL,          -- 'topup' | 'commission'
      provider             TEXT,                   -- 'manual' | 'momo' | 'airtel' | NULL (commission)
      amount               BIGINT NOT NULL,         -- negative for commission deductions
      momo_ref             TEXT,
      provider_reference_id TEXT,
      status               TEXT NOT NULL,           -- pending | processing | confirmed | rejected | applied
      note                 TEXT NOT NULL DEFAULT '',
      ts                   BIGINT NOT NULL,
      decided_at           BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_driver ON ledger_entries(driver_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_status ON ledger_entries(type, status);
    CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);

    CREATE TABLE IF NOT EXISTS riders (
      phone                      TEXT PRIMARY KEY,
      full_name                  TEXT NOT NULL,
      country                    TEXT NOT NULL DEFAULT 'UG',
      cancellation_penalty_active BOOLEAN NOT NULL DEFAULT FALSE,
      cancellation_penalty_pct   NUMERIC NOT NULL DEFAULT 0,
      cancellation_strikes       INT NOT NULL DEFAULT 0,
      created_at                 BIGINT NOT NULL
    );
    ALTER TABLE riders ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UG';

    CREATE TABLE IF NOT EXISTS card_fare_payments (
      id              TEXT PRIMARY KEY,
      thread_id       TEXT NOT NULL,
      driver_id       TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      rider_phone     TEXT NOT NULL,
      fare_amount     BIGINT NOT NULL,
      commission      BIGINT NOT NULL,
      payout_amount   BIGINT NOT NULL,
      currency        TEXT NOT NULL,
      status          TEXT NOT NULL,       -- pending | paid | payout_failed | completed
      tx_ref          TEXT,
      transfer_ref    TEXT,
      note            TEXT NOT NULL DEFAULT '',
      ts              BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_card_fare_driver ON card_fare_payments(driver_id);

    CREATE TABLE IF NOT EXISTS ratings (
      id          TEXT PRIMARY KEY,
      driver_id   TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      rider_phone TEXT NOT NULL,
      stars       INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
      ts          BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ratings_driver ON ratings(driver_id);
  `);
}

module.exports = { pool, initSchema };
