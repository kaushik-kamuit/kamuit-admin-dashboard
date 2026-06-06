-- ============================================================================
-- 008_fraud_signals.sql
--
-- Views for fraud signal detection:
--   - GPS spoofing (impossible speed jumps between consecutive pings)
--   - Duplicate/overlapping rides per rider
--   - Ghost trips (completed but no pings recorded)
--   - Suspicious short trips (completed in < 60s)
--
-- Depends on: 002_location_pings.sql (driver_location_pings)
--             001_event_logs.sql  (ride_status_events)
-- Idempotent.
-- ============================================================================

BEGIN;

-- GPS spoofing: consecutive pings with implied speed > 200 km/h
CREATE OR REPLACE VIEW v_gps_spoofing_signals AS
WITH ordered_pings AS (
    SELECT
        driver_run_id,
        latitude,
        longitude,
        speed_mps,
        recorded_at,
        LAG(latitude)    OVER w AS prev_lat,
        LAG(longitude)   OVER w AS prev_lng,
        LAG(recorded_at) OVER w AS prev_recorded_at
    FROM driver_location_pings
    WHERE recorded_at >= now() - INTERVAL '7 days'
    WINDOW w AS (PARTITION BY driver_run_id ORDER BY recorded_at)
),
with_distance AS (
    SELECT *,
        EXTRACT(EPOCH FROM recorded_at - prev_recorded_at) AS dt_seconds,
        ST_DistanceSphere(
            ST_MakePoint(longitude, latitude),
            ST_MakePoint(prev_lng, prev_lat)
        ) AS distance_m
    FROM ordered_pings
    WHERE prev_lat IS NOT NULL
      AND EXTRACT(EPOCH FROM recorded_at - prev_recorded_at) > 0
)
SELECT
    driver_run_id,
    recorded_at,
    prev_recorded_at,
    latitude,
    longitude,
    prev_lat,
    prev_lng,
    distance_m,
    dt_seconds,
    ROUND((distance_m / dt_seconds * 3.6)::numeric, 1) AS implied_kmh
FROM with_distance
WHERE (distance_m / dt_seconds * 3.6) > 200;

-- Duplicate/overlapping rides: same rider with 2+ non-cancelled rides
-- whose created_at windows overlap within 5 minutes
CREATE OR REPLACE VIEW v_duplicate_rides AS
SELECT
    r1.id AS ride_a,
    r2.id AS ride_b,
    r1.rider_id,
    r1.status::text AS status_a,
    r2.status::text AS status_b,
    r1.created_at AS created_a,
    r2.created_at AS created_b,
    r1.pickup_address AS pickup_a,
    r2.pickup_address AS pickup_b
FROM rides r1
JOIN rides r2
    ON r1.rider_id = r2.rider_id
   AND r1.id < r2.id
   AND r2.created_at BETWEEN r1.created_at AND r1.created_at + INTERVAL '5 minutes'
WHERE r1.status::text NOT IN ('CANCELLED')
  AND r2.status::text NOT IN ('CANCELLED')
  AND r1.created_at >= now() - INTERVAL '30 days';

-- Ghost trips: completed rides with no location pings for the assigned driver run
CREATE OR REPLACE VIEW v_ghost_trips AS
SELECT
    r.id AS ride_id,
    r.rider_id,
    r.pickup_address,
    r.drop_address,
    ra.driver_run_id,
    dr.driver_id,
    r.created_at,
    r.updated_at AS completed_at
FROM rides r
JOIN ride_assignments ra ON ra.ride_id = r.id
JOIN driver_runs dr ON dr.id = ra.driver_run_id
LEFT JOIN driver_location_pings dlp ON dlp.driver_run_id = ra.driver_run_id
WHERE r.status::text = 'COMPLETED'
  AND r.created_at >= now() - INTERVAL '30 days'
  AND dlp.driver_run_id IS NULL;

-- Suspicious short trips: completed in under 60 seconds
CREATE OR REPLACE VIEW v_suspicious_short_trips AS
SELECT
    rse_complete.ride_id,
    r.rider_id,
    r.pickup_address,
    r.drop_address,
    rse_start.occurred_at AS started_at,
    rse_complete.occurred_at AS completed_at,
    EXTRACT(EPOCH FROM rse_complete.occurred_at - rse_start.occurred_at) AS duration_seconds
FROM ride_status_events rse_complete
JOIN ride_status_events rse_start
    ON rse_start.ride_id = rse_complete.ride_id
   AND rse_start.to_status = 'IN_PROGRESS'
JOIN rides r ON r.id = rse_complete.ride_id
WHERE rse_complete.to_status = 'COMPLETED'
  AND rse_complete.occurred_at >= now() - INTERVAL '30 days'
  AND EXTRACT(EPOCH FROM rse_complete.occurred_at - rse_start.occurred_at) < 60;

COMMIT;
