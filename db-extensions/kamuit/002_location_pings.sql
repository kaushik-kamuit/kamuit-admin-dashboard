-- ============================================================================
-- 002_location_pings.sql
--
-- `driver_locations` is defined as single-row-per-(run,schedule) with an
-- upsert pattern that destroys breadcrumb history. This file installs an
-- append-only parallel table plus trigger that copies every INSERT/UPDATE
-- into it, preserving the full trail.
--
-- Also creates the `driver_online_sessions` table (populated by a worker
-- that does gap analysis on the pings).
--
-- The existing `driver_locations` upsert pattern keeps working unchanged.
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS driver_location_pings (
    id                       BIGSERIAL PRIMARY KEY,
    driver_run_id            UUID                      NOT NULL,
    schedule_id              UUID                      NOT NULL,
    driver_id                TEXT                      NOT NULL,
    latitude                 DOUBLE PRECISION          NOT NULL,
    longitude                DOUBLE PRECISION          NOT NULL,
    location_point           GEOGRAPHY(POINT, 4326)    NOT NULL,
    accuracy_meters          DOUBLE PRECISION,
    heading                  DOUBLE PRECISION,
    speed_mps                DOUBLE PRECISION,
    route_fraction           DOUBLE PRECISION,
    distance_to_next_stop_m  DOUBLE PRECISION,
    source                   TEXT                      NOT NULL DEFAULT 'TRIGGER',
    recorded_at              TIMESTAMPTZ               NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pings_run_time
    ON driver_location_pings (driver_run_id, recorded_at);
CREATE INDEX IF NOT EXISTS ix_pings_driver_time
    ON driver_location_pings (driver_id, recorded_at);
CREATE INDEX IF NOT EXISTS ix_pings_point_gix
    ON driver_location_pings USING GIST (location_point);

CREATE OR REPLACE FUNCTION capture_driver_location_ping() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO driver_location_pings (
        driver_run_id, schedule_id, driver_id,
        latitude, longitude, location_point,
        accuracy_meters, heading, speed_mps,
        route_fraction, distance_to_next_stop_m,
        source, recorded_at
    ) VALUES (
        NEW.driver_run_id, NEW.schedule_id, NEW.driver_id,
        NEW.latitude, NEW.longitude, NEW.location_point,
        NEW.accuracy_meters, NEW.heading, NEW.speed_mps,
        NEW.route_fraction, NEW.distance_to_next_stop_m,
        CASE TG_OP WHEN 'INSERT' THEN 'INSERT' ELSE 'UPDATE' END,
        COALESCE(NEW.updated_at, now())
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_capture_driver_location_ping ON driver_locations;
CREATE TRIGGER trg_capture_driver_location_ping
    AFTER INSERT OR UPDATE ON driver_locations
    FOR EACH ROW EXECUTE FUNCTION capture_driver_location_ping();

-- Seed pings from whatever is currently in driver_locations so the admin
-- sees non-empty data on first run. Clearly flagged.
INSERT INTO driver_location_pings (
    driver_run_id, schedule_id, driver_id,
    latitude, longitude, location_point,
    accuracy_meters, heading, speed_mps,
    route_fraction, distance_to_next_stop_m,
    source, recorded_at
)
SELECT dl.driver_run_id, dl.schedule_id, dl.driver_id,
       dl.latitude, dl.longitude, dl.location_point,
       dl.accuracy_meters, dl.heading, dl.speed_mps,
       dl.route_fraction, dl.distance_to_next_stop_m,
       'BACKFILL',
       COALESCE(dl.updated_at, dl.created_at, now())
FROM driver_locations dl
WHERE NOT EXISTS (
    SELECT 1 FROM driver_location_pings p
    WHERE p.driver_run_id = dl.driver_run_id
      AND p.schedule_id   = dl.schedule_id
      AND p.source        = 'BACKFILL'
);

-- ---------------------------------------------------------------------------
-- driver_online_sessions — derived by the `derive_sessions.py` worker.
-- Empty on first apply. Defined here so its schema is versioned with the
-- rest of the admin extensions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_online_sessions (
    id                 BIGSERIAL PRIMARY KEY,
    driver_id          TEXT        NOT NULL,
    started_at         TIMESTAMPTZ NOT NULL,
    ended_at           TIMESTAMPTZ NOT NULL,
    total_seconds      INTEGER     NOT NULL,
    assigned_seconds   INTEGER     NOT NULL DEFAULT 0,
    idle_seconds       INTEGER     NOT NULL DEFAULT 0,
    pings_count        INTEGER     NOT NULL DEFAULT 0,
    start_lat          DOUBLE PRECISION,
    start_lng          DOUBLE PRECISION,
    end_lat            DOUBLE PRECISION,
    end_lng            DOUBLE PRECISION,
    computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_online_sessions_driver_time
    ON driver_online_sessions (driver_id, started_at);

COMMIT;
