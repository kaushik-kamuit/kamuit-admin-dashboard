-- ============================================================================
-- 001_event_logs.sql
--
-- Append-only status-transition event logs for rides, driver_runs,
-- ride_preferences, and ride_assignments.
--
-- The existing apps overwrite `status` in-place, so history is lost. This
-- file installs AFTER UPDATE triggers that copy every transition into a
-- dedicated events table. Nothing in the existing schema is modified.
--
-- Idempotent.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ride_status_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride_status_events (
    id              BIGSERIAL PRIMARY KEY,
    ride_id         UUID        NOT NULL,
    from_status     TEXT,
    to_status       TEXT        NOT NULL,
    reason_code     TEXT        NOT NULL DEFAULT 'TRIGGER',
    actor_hint      TEXT,            -- best-effort; NULL unless app tells us
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- snapshot columns we can observe cheaply from NEW row:
    otp_attempts    INTEGER,
    seats_requested INTEGER
);

CREATE INDEX IF NOT EXISTS ix_ride_status_events_ride
    ON ride_status_events (ride_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_ride_status_events_to_status_time
    ON ride_status_events (to_status, occurred_at);

CREATE OR REPLACE FUNCTION log_ride_status_event() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO ride_status_events
            (ride_id, from_status, to_status, reason_code,
             otp_attempts, seats_requested, occurred_at)
        VALUES
            (NEW.id, NULL, NEW.status::text, 'CREATED',
             NEW.otp_attempts, NEW.seats_requested, NEW.created_at);
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO ride_status_events
            (ride_id, from_status, to_status, reason_code,
             otp_attempts, seats_requested, occurred_at)
        VALUES
            (NEW.id, OLD.status::text, NEW.status::text, 'TRIGGER',
             NEW.otp_attempts, NEW.seats_requested, now());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ride_status_event ON rides;
CREATE TRIGGER trg_ride_status_event
    AFTER INSERT OR UPDATE OF status ON rides
    FOR EACH ROW EXECUTE FUNCTION log_ride_status_event();

-- ---------------------------------------------------------------------------
-- driver_run_status_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_run_status_events (
    id              BIGSERIAL PRIMARY KEY,
    driver_run_id   UUID        NOT NULL,
    from_status     TEXT,
    to_status       TEXT        NOT NULL,
    reason_code     TEXT        NOT NULL DEFAULT 'TRIGGER',
    seats_left      INTEGER,
    seats_total     INTEGER,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_drs_events_run
    ON driver_run_status_events (driver_run_id, occurred_at);

CREATE OR REPLACE FUNCTION log_driver_run_status_event() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO driver_run_status_events
            (driver_run_id, from_status, to_status, reason_code,
             seats_left, seats_total, occurred_at)
        VALUES
            (NEW.id, NULL, NEW.status::text, 'CREATED',
             NEW.seats_left, NEW.seats_total, NEW.created_at);
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.seats_left IS DISTINCT FROM OLD.seats_left THEN
        INSERT INTO driver_run_status_events
            (driver_run_id, from_status, to_status, reason_code,
             seats_left, seats_total, occurred_at)
        VALUES
            (NEW.id, OLD.status::text, NEW.status::text,
             CASE
                WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'TRIGGER'
                ELSE 'SEATS_UPDATE'
             END,
             NEW.seats_left, NEW.seats_total, now());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_driver_run_status_event ON driver_runs;
CREATE TRIGGER trg_driver_run_status_event
    AFTER INSERT OR UPDATE OF status, seats_left ON driver_runs
    FOR EACH ROW EXECUTE FUNCTION log_driver_run_status_event();

-- ---------------------------------------------------------------------------
-- preference_status_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS preference_status_events (
    id              BIGSERIAL PRIMARY KEY,
    preference_id   UUID        NOT NULL,
    session_id      UUID,
    from_status     TEXT,
    to_status       TEXT        NOT NULL,
    reason_code     TEXT        NOT NULL DEFAULT 'TRIGGER',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pref_events_pref
    ON preference_status_events (preference_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_pref_events_session
    ON preference_status_events (session_id, occurred_at);

CREATE OR REPLACE FUNCTION log_preference_status_event() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO preference_status_events
            (preference_id, session_id, from_status, to_status, reason_code, occurred_at)
        VALUES
            (NEW.id, NEW.preference_session_id, NULL, NEW.status, 'CREATED',
             COALESCE(NEW.selected_at, NEW.created_at, now()));
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO preference_status_events
            (preference_id, session_id, from_status, to_status, reason_code, occurred_at)
        VALUES
            (NEW.id, NEW.preference_session_id, OLD.status, NEW.status, 'TRIGGER', now());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_preference_status_event ON ride_preferences;
CREATE TRIGGER trg_preference_status_event
    AFTER INSERT OR UPDATE OF status ON ride_preferences
    FOR EACH ROW EXECUTE FUNCTION log_preference_status_event();

-- ---------------------------------------------------------------------------
-- assignment_events  (every INSERT/UPDATE; assignments are the handshake)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignment_events (
    id               BIGSERIAL PRIMARY KEY,
    assignment_id    UUID        NOT NULL,
    ride_id          UUID,
    driver_run_id    UUID,
    schedule_id      UUID,
    event_type       TEXT        NOT NULL,   -- CREATED | UPDATED
    pickup_fraction  DOUBLE PRECISION,
    drop_fraction    DOUBLE PRECISION,
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_assign_events_ride
    ON assignment_events (ride_id, occurred_at);

CREATE OR REPLACE FUNCTION log_assignment_event() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO assignment_events
        (assignment_id, ride_id, driver_run_id, schedule_id,
         event_type, pickup_fraction, drop_fraction, occurred_at)
    VALUES
        (NEW.id, NEW.ride_id, NEW.driver_run_id, NEW.schedule_id,
         CASE TG_OP WHEN 'INSERT' THEN 'CREATED' ELSE 'UPDATED' END,
         NEW.pickup_fraction, NEW.drop_fraction,
         COALESCE(NEW.assigned_at, now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assignment_event ON ride_assignments;
CREATE TRIGGER trg_assignment_event
    AFTER INSERT OR UPDATE ON ride_assignments
    FOR EACH ROW EXECUTE FUNCTION log_assignment_event();

-- ---------------------------------------------------------------------------
-- One-time backfill: synthesize an initial event per existing entity so
-- funnels and timelines have a baseline even for rows that predate the
-- triggers. Clearly labeled so it can't be confused with real transitions.
-- ---------------------------------------------------------------------------
INSERT INTO ride_status_events
    (ride_id, from_status, to_status, reason_code,
     otp_attempts, seats_requested, occurred_at)
SELECT r.id, NULL, r.status::text, 'BACKFILL',
       r.otp_attempts, r.seats_requested, r.created_at
FROM rides r
WHERE NOT EXISTS (
    SELECT 1 FROM ride_status_events e WHERE e.ride_id = r.id
);

INSERT INTO driver_run_status_events
    (driver_run_id, from_status, to_status, reason_code,
     seats_left, seats_total, occurred_at)
SELECT dr.id, NULL, dr.status::text, 'BACKFILL',
       dr.seats_left, dr.seats_total, dr.created_at
FROM driver_runs dr
WHERE NOT EXISTS (
    SELECT 1 FROM driver_run_status_events e WHERE e.driver_run_id = dr.id
);

INSERT INTO preference_status_events
    (preference_id, session_id, from_status, to_status, reason_code, occurred_at)
SELECT rp.id, rp.preference_session_id, NULL, rp.status, 'BACKFILL',
       COALESCE(rp.selected_at, rp.created_at, now())
FROM ride_preferences rp
WHERE NOT EXISTS (
    SELECT 1 FROM preference_status_events e WHERE e.preference_id = rp.id
);

INSERT INTO assignment_events
    (assignment_id, ride_id, driver_run_id, schedule_id,
     event_type, pickup_fraction, drop_fraction, occurred_at)
SELECT ra.id, ra.ride_id, ra.driver_run_id, ra.schedule_id,
       'BACKFILL', ra.pickup_fraction, ra.drop_fraction,
       COALESCE(ra.assigned_at, ra.created_at, now())
FROM ride_assignments ra
WHERE NOT EXISTS (
    SELECT 1 FROM assignment_events e WHERE e.assignment_id = ra.id
);

COMMIT;
