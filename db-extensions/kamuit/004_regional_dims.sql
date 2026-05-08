-- ============================================================================
-- 004_regional_dims.sql
--
-- Side-tables that cache grid-bucket IDs for every point geography we care
-- about. Enables sub-second heatmap GROUP BYs without touching the schema
-- of `rides` or `driver_runs` themselves.
--
-- We do NOT use PostGIS `ST_SnapToGrid` at query time or as a generated
-- column (some expressions aren't provably immutable across PostGIS
-- versions). Instead, a trigger derives the buckets from lat/lng and
-- upserts them into a parallel cache table.
--
-- Cell sizes (WGS84 degrees, approximate at US mid-latitudes):
--   * 500 m  ~ 0.005  degrees
--   * 2 km   ~ 0.020  degrees
--   * 10 km  ~ 0.100  degrees
--
-- Cell key format is TEXT "lng_idx:lat_idx" so it round-trips to integer
-- coords cleanly for the frontend.
--
-- Idempotent.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Helper: pure function used by triggers and ad-hoc queries.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_cell_key(lng DOUBLE PRECISION,
                                          lat DOUBLE PRECISION,
                                          grid_deg DOUBLE PRECISION)
RETURNS TEXT AS $$
    SELECT CASE
      WHEN lng IS NULL OR lat IS NULL THEN NULL
      ELSE FLOOR(lng / grid_deg)::text || ':' || FLOOR(lat / grid_deg)::text
    END
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION admin_cell_center_lng(key TEXT, grid_deg DOUBLE PRECISION)
RETURNS DOUBLE PRECISION AS $$
    SELECT (SPLIT_PART(key, ':', 1)::bigint + 0.5) * grid_deg;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION admin_cell_center_lat(key TEXT, grid_deg DOUBLE PRECISION)
RETURNS DOUBLE PRECISION AS $$
    SELECT (SPLIT_PART(key, ':', 2)::bigint + 0.5) * grid_deg;
$$ LANGUAGE SQL IMMUTABLE;

-- --------------------------------------------------------------------------
-- ride_geo_cache
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride_geo_cache (
    ride_id           UUID PRIMARY KEY,
    pickup_lat        DOUBLE PRECISION,
    pickup_lng        DOUBLE PRECISION,
    drop_lat          DOUBLE PRECISION,
    drop_lng          DOUBLE PRECISION,
    pickup_cell_500m  TEXT,
    pickup_cell_2km   TEXT,
    pickup_cell_10km  TEXT,
    drop_cell_500m    TEXT,
    drop_cell_2km     TEXT,
    drop_cell_10km    TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rgc_pickup_500m   ON ride_geo_cache (pickup_cell_500m);
CREATE INDEX IF NOT EXISTS ix_rgc_pickup_2km    ON ride_geo_cache (pickup_cell_2km);
CREATE INDEX IF NOT EXISTS ix_rgc_pickup_10km   ON ride_geo_cache (pickup_cell_10km);
CREATE INDEX IF NOT EXISTS ix_rgc_drop_2km      ON ride_geo_cache (drop_cell_2km);

CREATE OR REPLACE FUNCTION sync_ride_geo_cache() RETURNS TRIGGER AS $$
DECLARE
    plat DOUBLE PRECISION; plng DOUBLE PRECISION;
    dlat DOUBLE PRECISION; dlng DOUBLE PRECISION;
BEGIN
    IF NEW.pickup_point IS NOT NULL THEN
        plat := ST_Y(NEW.pickup_point::geometry);
        plng := ST_X(NEW.pickup_point::geometry);
    END IF;
    IF NEW.drop_point IS NOT NULL THEN
        dlat := ST_Y(NEW.drop_point::geometry);
        dlng := ST_X(NEW.drop_point::geometry);
    END IF;

    INSERT INTO ride_geo_cache (
        ride_id, pickup_lat, pickup_lng, drop_lat, drop_lng,
        pickup_cell_500m, pickup_cell_2km, pickup_cell_10km,
        drop_cell_500m,   drop_cell_2km,   drop_cell_10km,
        updated_at
    ) VALUES (
        NEW.id, plat, plng, dlat, dlng,
        admin_cell_key(plng, plat, 0.005),
        admin_cell_key(plng, plat, 0.020),
        admin_cell_key(plng, plat, 0.100),
        admin_cell_key(dlng, dlat, 0.005),
        admin_cell_key(dlng, dlat, 0.020),
        admin_cell_key(dlng, dlat, 0.100),
        now()
    )
    ON CONFLICT (ride_id) DO UPDATE SET
        pickup_lat = EXCLUDED.pickup_lat,
        pickup_lng = EXCLUDED.pickup_lng,
        drop_lat   = EXCLUDED.drop_lat,
        drop_lng   = EXCLUDED.drop_lng,
        pickup_cell_500m = EXCLUDED.pickup_cell_500m,
        pickup_cell_2km  = EXCLUDED.pickup_cell_2km,
        pickup_cell_10km = EXCLUDED.pickup_cell_10km,
        drop_cell_500m   = EXCLUDED.drop_cell_500m,
        drop_cell_2km    = EXCLUDED.drop_cell_2km,
        drop_cell_10km   = EXCLUDED.drop_cell_10km,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ride_geo_cache ON rides;
CREATE TRIGGER trg_sync_ride_geo_cache
    AFTER INSERT OR UPDATE OF pickup_point, drop_point ON rides
    FOR EACH ROW EXECUTE FUNCTION sync_ride_geo_cache();

-- --------------------------------------------------------------------------
-- driver_run_geo_cache
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_run_geo_cache (
    driver_run_id     UUID PRIMARY KEY,
    origin_lat        DOUBLE PRECISION,
    origin_lng        DOUBLE PRECISION,
    dest_lat          DOUBLE PRECISION,
    dest_lng          DOUBLE PRECISION,
    origin_cell_500m  TEXT,
    origin_cell_2km   TEXT,
    origin_cell_10km  TEXT,
    dest_cell_500m    TEXT,
    dest_cell_2km     TEXT,
    dest_cell_10km    TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_drgc_origin_2km ON driver_run_geo_cache (origin_cell_2km);
CREATE INDEX IF NOT EXISTS ix_drgc_dest_2km   ON driver_run_geo_cache (dest_cell_2km);

CREATE OR REPLACE FUNCTION sync_driver_run_geo_cache() RETURNS TRIGGER AS $$
DECLARE
    olat DOUBLE PRECISION; olng DOUBLE PRECISION;
    dlat DOUBLE PRECISION; dlng DOUBLE PRECISION;
BEGIN
    IF NEW.origin_point IS NOT NULL THEN
        olat := ST_Y(NEW.origin_point::geometry);
        olng := ST_X(NEW.origin_point::geometry);
    END IF;
    IF NEW.dest_point IS NOT NULL THEN
        dlat := ST_Y(NEW.dest_point::geometry);
        dlng := ST_X(NEW.dest_point::geometry);
    END IF;

    INSERT INTO driver_run_geo_cache (
        driver_run_id, origin_lat, origin_lng, dest_lat, dest_lng,
        origin_cell_500m, origin_cell_2km, origin_cell_10km,
        dest_cell_500m,   dest_cell_2km,   dest_cell_10km,
        updated_at
    ) VALUES (
        NEW.id, olat, olng, dlat, dlng,
        admin_cell_key(olng, olat, 0.005),
        admin_cell_key(olng, olat, 0.020),
        admin_cell_key(olng, olat, 0.100),
        admin_cell_key(dlng, dlat, 0.005),
        admin_cell_key(dlng, dlat, 0.020),
        admin_cell_key(dlng, dlat, 0.100),
        now()
    )
    ON CONFLICT (driver_run_id) DO UPDATE SET
        origin_lat = EXCLUDED.origin_lat,
        origin_lng = EXCLUDED.origin_lng,
        dest_lat   = EXCLUDED.dest_lat,
        dest_lng   = EXCLUDED.dest_lng,
        origin_cell_500m = EXCLUDED.origin_cell_500m,
        origin_cell_2km  = EXCLUDED.origin_cell_2km,
        origin_cell_10km = EXCLUDED.origin_cell_10km,
        dest_cell_500m   = EXCLUDED.dest_cell_500m,
        dest_cell_2km    = EXCLUDED.dest_cell_2km,
        dest_cell_10km   = EXCLUDED.dest_cell_10km,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_driver_run_geo_cache ON driver_runs;
CREATE TRIGGER trg_sync_driver_run_geo_cache
    AFTER INSERT OR UPDATE OF origin_point, dest_point ON driver_runs
    FOR EACH ROW EXECUTE FUNCTION sync_driver_run_geo_cache();

-- --------------------------------------------------------------------------
-- Cell columns on driver_location_pings (we own that table — direct add).
-- --------------------------------------------------------------------------
ALTER TABLE driver_location_pings
    ADD COLUMN IF NOT EXISTS cell_500m TEXT,
    ADD COLUMN IF NOT EXISTS cell_2km  TEXT,
    ADD COLUMN IF NOT EXISTS cell_10km TEXT;

CREATE INDEX IF NOT EXISTS ix_pings_cell_2km  ON driver_location_pings (cell_2km);
CREATE INDEX IF NOT EXISTS ix_pings_cell_10km ON driver_location_pings (cell_10km);

CREATE OR REPLACE FUNCTION fill_ping_cells() RETURNS TRIGGER AS $$
BEGIN
    NEW.cell_500m := admin_cell_key(NEW.longitude, NEW.latitude, 0.005);
    NEW.cell_2km  := admin_cell_key(NEW.longitude, NEW.latitude, 0.020);
    NEW.cell_10km := admin_cell_key(NEW.longitude, NEW.latitude, 0.100);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fill_ping_cells ON driver_location_pings;
CREATE TRIGGER trg_fill_ping_cells
    BEFORE INSERT OR UPDATE OF latitude, longitude ON driver_location_pings
    FOR EACH ROW EXECUTE FUNCTION fill_ping_cells();

-- --------------------------------------------------------------------------
-- Backfill (idempotent — ON CONFLICT / WHERE NULL)
-- --------------------------------------------------------------------------
INSERT INTO ride_geo_cache (ride_id)
SELECT r.id FROM rides r
WHERE NOT EXISTS (SELECT 1 FROM ride_geo_cache c WHERE c.ride_id = r.id)
ON CONFLICT DO NOTHING;

UPDATE ride_geo_cache c
SET pickup_lat = ST_Y(r.pickup_point::geometry),
    pickup_lng = ST_X(r.pickup_point::geometry),
    drop_lat   = ST_Y(r.drop_point::geometry),
    drop_lng   = ST_X(r.drop_point::geometry),
    pickup_cell_500m  = admin_cell_key(ST_X(r.pickup_point::geometry), ST_Y(r.pickup_point::geometry), 0.005),
    pickup_cell_2km   = admin_cell_key(ST_X(r.pickup_point::geometry), ST_Y(r.pickup_point::geometry), 0.020),
    pickup_cell_10km  = admin_cell_key(ST_X(r.pickup_point::geometry), ST_Y(r.pickup_point::geometry), 0.100),
    drop_cell_500m    = admin_cell_key(ST_X(r.drop_point::geometry),   ST_Y(r.drop_point::geometry),   0.005),
    drop_cell_2km     = admin_cell_key(ST_X(r.drop_point::geometry),   ST_Y(r.drop_point::geometry),   0.020),
    drop_cell_10km    = admin_cell_key(ST_X(r.drop_point::geometry),   ST_Y(r.drop_point::geometry),   0.100),
    updated_at = now()
FROM rides r
WHERE c.ride_id = r.id
  AND (c.pickup_cell_2km IS NULL OR c.drop_cell_2km IS NULL);

INSERT INTO driver_run_geo_cache (driver_run_id)
SELECT dr.id FROM driver_runs dr
WHERE NOT EXISTS (SELECT 1 FROM driver_run_geo_cache c WHERE c.driver_run_id = dr.id)
ON CONFLICT DO NOTHING;

UPDATE driver_run_geo_cache c
SET origin_lat = ST_Y(dr.origin_point::geometry),
    origin_lng = ST_X(dr.origin_point::geometry),
    dest_lat   = ST_Y(dr.dest_point::geometry),
    dest_lng   = ST_X(dr.dest_point::geometry),
    origin_cell_500m  = admin_cell_key(ST_X(dr.origin_point::geometry), ST_Y(dr.origin_point::geometry), 0.005),
    origin_cell_2km   = admin_cell_key(ST_X(dr.origin_point::geometry), ST_Y(dr.origin_point::geometry), 0.020),
    origin_cell_10km  = admin_cell_key(ST_X(dr.origin_point::geometry), ST_Y(dr.origin_point::geometry), 0.100),
    dest_cell_500m    = admin_cell_key(ST_X(dr.dest_point::geometry),   ST_Y(dr.dest_point::geometry),   0.005),
    dest_cell_2km     = admin_cell_key(ST_X(dr.dest_point::geometry),   ST_Y(dr.dest_point::geometry),   0.020),
    dest_cell_10km    = admin_cell_key(ST_X(dr.dest_point::geometry),   ST_Y(dr.dest_point::geometry),   0.100),
    updated_at = now()
FROM driver_runs dr
WHERE c.driver_run_id = dr.id
  AND (c.origin_cell_2km IS NULL OR c.dest_cell_2km IS NULL);

UPDATE driver_location_pings
SET cell_500m = admin_cell_key(longitude, latitude, 0.005),
    cell_2km  = admin_cell_key(longitude, latitude, 0.020),
    cell_10km = admin_cell_key(longitude, latitude, 0.100)
WHERE cell_2km IS NULL;

COMMIT;
