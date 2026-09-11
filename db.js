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
      vehicle_type     TEXT, -- doubles as "sub-type" for every category now (e.g. household's 'plumbing', gig's 'errands'), not just a literal vehicle — nullable since non-vehicle categories still need it filled in, just with a different meaning than the column name suggests
      vehicle_plate    TEXT, -- null for non-vehicle categories (household services, most gig work)
      vehicle_model    TEXT,
      vehicle_color    TEXT,
      document_photo_path TEXT,
      selfie_path      TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      review_note      TEXT NOT NULL DEFAULT '',
      submitted_at     BIGINT NOT NULL,
      reviewed_at      BIGINT,
      wallet_balance   BIGINT NOT NULL DEFAULT 0
    );
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'UG';
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_color TEXT;
    ALTER TABLE drivers ALTER COLUMN vehicle_type DROP NOT NULL;
    ALTER TABLE drivers ALTER COLUMN vehicle_plate DROP NOT NULL;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS service_category TEXT NOT NULL DEFAULT 'ride';
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS trust_referee_name TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS trust_referee_phone TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS trust_referee_type TEXT; -- 'lc1' | 'personal'
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS fixed_rate BIGINT; -- provider's own set rate, for categories priced 'fixed_by_provider' (e.g. household services) — null for negotiated categories

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

    -- A driver's identity (ID, vehicle, referee) is verified once, but
    -- they can offer MULTIPLE service categories on that one identity —
    -- e.g. the same motorcycle and rider doing both passenger rides and
    -- deliveries. Each row is one category+sub-type combination they're
    -- registered for; approving the driver approves every offering they
    -- listed at once, since it's the same underlying identity check.
    CREATE TABLE IF NOT EXISTS driver_offerings (
      id           TEXT PRIMARY KEY,
      driver_id    TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      category     TEXT NOT NULL,
      sub_type     TEXT NOT NULL,
      fixed_rate   BIGINT, -- only meaningful for 'fixed_by_provider' categories (household services)
      created_at   BIGINT NOT NULL,
      UNIQUE(driver_id, category, sub_type)
    );

    CREATE TABLE IF NOT EXISTS support_reports (
      id             TEXT PRIMARY KEY,
      reporter_role  TEXT NOT NULL,     -- 'rider' | 'driver'
      reporter_phone TEXT,
      thread_id      TEXT,
      message        TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'open',
      ts             BIGINT NOT NULL
    );

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
