# Kamuit Admin — DB Extensions

These SQL files are applied by `scripts/apply_extensions.py` **after** the
sibling backends' Alembic migrations and **before** seeding.

They are strictly **additive** to the existing backend schemas:

- No column on any pre-existing table is dropped or altered in a breaking way.
- No existing index is removed.
- Every statement is idempotent (`CREATE ... IF NOT EXISTS`, `CREATE OR
  REPLACE FUNCTION/TRIGGER`).
- The backend apps (`kamuit-backend`, `user-management-backend`,
  `payment-backend`, `kamuit-mobile`) keep running unchanged. They do not know
  the new tables, views, or triggers exist.

## What they add

### `kamuit/` (applied to the `kamuit-backend` DB)

1. **`001_event_logs.sql`** — `ride_status_events`, `driver_run_status_events`,
   `preference_status_events`, `assignment_events`. Triggers on
   `rides / driver_runs / ride_preferences / ride_assignments` append one row
   per status transition. Also backfills one synthetic initial row per existing
   entity (labeled `reason_code = 'BACKFILL'`) so funnels have a baseline.

2. **`002_location_pings.sql`** — Append-only `driver_location_pings` table.
   Trigger on `driver_locations` copies every INSERT/UPDATE into the pings
   table, preserving the full GPS breadcrumb trail the app currently
   discards. Also creates the (empty) `driver_online_sessions` table that the
   `derive_sessions` worker fills.

3. **`003_otp_attempts.sql`** — Append-only `otp_attempt_events`. Trigger on
   `rides.otp_attempts` increments / `rides.otp_generated_at` changes logs each
   touch with timestamp and the ride's current status.

4. **`004_regional_dims.sql`** — Snap-to-grid generated columns at 500 m,
   2 km, and 10 km resolution on every point column (`rides.pickup_point`,
   `rides.drop_point`, `driver_runs.origin_point`, `driver_runs.dest_point`,
   `driver_location_pings.location_point`). These make heatmap
   `GROUP BY` queries instant without any PostGIS extension beyond what we
   already have.

5. **`005_search_inference.sql`** — View `inferred_searches` that treats each
   distinct `ride_preferences.preference_session_id` as a "search". This is
   a **best-effort proxy** because the matching service doesn't persist
   search telemetry; the dashboard labels it so.

### `payment/`

1. **`001_recon_view.sql`** — Helper views inside the payment DB for
   per-driver settlement rollups. Read-only; no writes.

### `user_mgmt/`

1. **`001_indexes.sql`** — Additional btree indexes on `users.email`,
   `users.created_at` etc. for faster dashboard queries. No schema shape
   change.

## Rolling back

`scripts/apply_extensions.py --drop` removes every object this directory
installs. The underlying backend tables are not touched.
