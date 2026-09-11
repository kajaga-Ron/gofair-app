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
      document_photo_path TEXT, -- legacy local-disk path, kept for old records; new uploads use document_photo_data below
      selfie_path      TEXT,    -- legacy local-disk path, same reasoning
      document_photo_data TEXT, -- base64 photo data, stored directly in the database so it survives a Render redeploy (the local disk does not)
      selfie_data      TEXT,
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
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS document_photo_data TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS selfie_data TEXT;

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
    -- Each row is one item a Shop (Market) provider is selling — a
    -- photo, a name, a price, and a unit (kg, metre, piece, litre,
    -- dozen, or free-text "other" for anything that doesn't fit those).
    -- Unlike every other category, Market's pricing lives on the
    -- LISTING itself, not on the provider as a single flat rate — a
    -- shop sells many different things at many different prices.
    CREATE TABLE IF NOT EXISTS shop_listings (
      id            TEXT PRIMARY KEY,
      driver_id     TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      photo_data    TEXT,
      price         BIGINT NOT NULL,
      unit          TEXT NOT NULL,  -- 'kg' | 'meter' | 'piece' | 'liter' | 'dozen' | 'other'
      unit_custom_text TEXT,        -- only used when unit = 'other'
      currency      TEXT NOT NULL,
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shop_listings_driver ON shop_listings(driver_id);

    CREATE TABLE IF NOT EXISTS driver_offerings (
      id           TEXT PRIMARY KEY,
      driver_id    TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      category     TEXT NOT NULL,
      sub_type     TEXT NOT NULL,
      fixed_rate   BIGINT, -- only meaningful for 'fixed_by_provider' categories (household services)
      created_at   BIGINT NOT NULL,
      UNIQUE(driver_id, category, sub_type)
    );

    -- Live negotiation (open requests, back-and-forth offers) stays in
    -- server memory deliberately — it's short-lived and needs to be
    -- fast, and losing an in-progress negotiation on a restart is a
    -- minor inconvenience (just try again). But the FINAL outcome of
    -- every trip — completed, cancelled, or declined — is recorded here
    -- permanently, so it survives restarts/redeploys and can actually
    -- be looked up later for a dispute, a driver disagreement, or your
    -- own accounting. This table did not exist before, which meant NO
    -- trip in this app's whole history could ever be looked back on.
    CREATE TABLE IF NOT EXISTS trips (
      id                TEXT PRIMARY KEY,
      request_id        TEXT NOT NULL,
      thread_id         TEXT,
      rider_phone       TEXT,
      rider_name        TEXT,
      driver_id         TEXT REFERENCES drivers(id) ON DELETE SET NULL,
      driver_name       TEXT,
      service_category  TEXT NOT NULL,
      vehicle_type      TEXT,
      country           TEXT NOT NULL,
      currency          TEXT,
      pickup_name       TEXT,
      drop_name         TEXT,
      pickup_lat        DOUBLE PRECISION,
      pickup_lng        DOUBLE PRECISION,
      drop_lat          DOUBLE PRECISION,
      drop_lng          DOUBLE PRECISION,
      km                DOUBLE PRECISION,
      final_price       BIGINT,
      commission_amount BIGINT,
      commission_rate   NUMERIC,
      payment_method    TEXT,        -- 'cash' | 'card'
      status            TEXT NOT NULL, -- 'completed' | 'cancelled' | 'declined'
      cancelled_by      TEXT,        -- 'rider' | 'driver' | null
      penalized         BOOLEAN NOT NULL DEFAULT FALSE,
      rating_stars      INT,
      created_at        BIGINT NOT NULL,
      ended_at          BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);
    CREATE INDEX IF NOT EXISTS idx_trips_rider ON trips(rider_phone);
    CREATE INDEX IF NOT EXISTS idx_trips_ended ON trips(ended_at);

    -- Generic admin-editable overrides — lets fare rates and commission
    -- rates be changed from the admin panel at runtime, instead of
    -- needing a code change and a redeploy for every price adjustment.
    -- Checked first; falls back to the hardcoded defaults in
    -- config.js/categories.js when no override exists for a given key.
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       JSONB NOT NULL,
      updated_at  BIGINT NOT NULL
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
