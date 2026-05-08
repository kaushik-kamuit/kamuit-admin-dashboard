-- ============================================================================
-- 003_otp_attempts.sql
--
-- The app only maintains a counter (`rides.otp_attempts`). The individual
-- attempts (time of each increment, state of ride at that moment) are lost.
-- This file installs an append-only log that captures each increment.
--
-- We do NOT see what OTP the user entered or whether it was correct -- that
-- information never leaves the app. The best we can infer from the DB is
-- timing and outcome (the transition to IN_PROGRESS implies a successful
-- verification).
--
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS otp_attempt_events (
    id                 BIGSERIAL PRIMARY KEY,
    ride_id            UUID        NOT NULL,
    attempt_number     INTEGER     NOT NULL,  -- new value of otp_attempts
    ride_status_at     TEXT,                   -- status of the ride at the moment of this attempt
    generated_at       TIMESTAMPTZ,           -- otp_generated_at at that moment
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_otp_attempt_events_ride
    ON otp_attempt_events (ride_id, occurred_at);

CREATE OR REPLACE FUNCTION log_otp_attempt_event() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.otp_generated_at IS NOT NULL THEN
            INSERT INTO otp_attempt_events
                (ride_id, attempt_number, ride_status_at, generated_at, occurred_at)
            VALUES
                (NEW.id, 0, NEW.status::text, NEW.otp_generated_at, NEW.otp_generated_at);
        END IF;
        IF COALESCE(NEW.otp_attempts, 0) > 0 THEN
            INSERT INTO otp_attempt_events
                (ride_id, attempt_number, ride_status_at, generated_at, occurred_at)
            VALUES
                (NEW.id, NEW.otp_attempts, NEW.status::text, NEW.otp_generated_at,
                 COALESCE(NEW.otp_generated_at, NEW.updated_at, NEW.created_at));
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.otp_attempts IS DISTINCT FROM OLD.otp_attempts
       AND COALESCE(NEW.otp_attempts, 0) > COALESCE(OLD.otp_attempts, 0)
    THEN
        INSERT INTO otp_attempt_events
            (ride_id, attempt_number, ride_status_at, generated_at, occurred_at)
        VALUES
            (NEW.id, NEW.otp_attempts, NEW.status::text, NEW.otp_generated_at, now());
    END IF;

    IF NEW.otp_generated_at IS DISTINCT FROM OLD.otp_generated_at
       AND OLD.otp_generated_at IS NULL
    THEN
        INSERT INTO otp_attempt_events
            (ride_id, attempt_number, ride_status_at, generated_at, occurred_at)
        VALUES
            (NEW.id, 0, NEW.status::text, NEW.otp_generated_at, NEW.otp_generated_at);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_otp_attempt_event ON rides;
CREATE TRIGGER trg_otp_attempt_event
    AFTER INSERT OR UPDATE OF otp_attempts, otp_generated_at ON rides
    FOR EACH ROW EXECUTE FUNCTION log_otp_attempt_event();

-- Backfill so dashboards aren't empty on first run
INSERT INTO otp_attempt_events
    (ride_id, attempt_number, ride_status_at, generated_at, occurred_at)
SELECT r.id, COALESCE(r.otp_attempts, 0),
       r.status::text, r.otp_generated_at,
       COALESCE(r.otp_generated_at, r.updated_at, r.created_at)
FROM rides r
WHERE r.otp_generated_at IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM otp_attempt_events e WHERE e.ride_id = r.id
  );

COMMIT;
