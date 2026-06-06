-- ============================================================================
-- 007_cancellation_analytics.sql
--
-- Views over ride_status_events and driver_run_status_events for cancellation
-- analysis: rates by hour/day, time-to-cancel, repeat cancellers, and
-- cancellation stage breakdown.
--
-- Depends on: 001_event_logs.sql (ride_status_events, driver_run_status_events)
-- Idempotent.
-- ============================================================================

BEGIN;

-- Ride cancellations with time-to-cancel from creation
CREATE OR REPLACE VIEW v_ride_cancellations AS
SELECT
    rse.ride_id,
    rse.occurred_at                              AS cancelled_at,
    rse.from_status                              AS cancelled_from,
    rse.actor_hint,
    r.rider_id,
    r.pickup_address,
    r.drop_address,
    r.seats_requested,
    EXTRACT(EPOCH FROM rse.occurred_at - r.created_at) AS seconds_to_cancel,
    r.created_at                                 AS ride_created_at
FROM ride_status_events rse
JOIN rides r ON r.id = rse.ride_id
WHERE rse.to_status = 'CANCELLED';

-- Hourly cancellation rate (rides cancelled / rides created per hour)
CREATE OR REPLACE VIEW v_cancel_rate_hourly AS
SELECT
    date_trunc('hour', r.created_at)             AS hour,
    COUNT(*)                                     AS total_created,
    COUNT(*) FILTER (WHERE r.status::text = 'CANCELLED') AS total_cancelled,
    ROUND(
        COUNT(*) FILTER (WHERE r.status::text = 'CANCELLED')::numeric
        / GREATEST(COUNT(*), 1) * 100, 2
    )                                            AS cancel_pct
FROM rides r
WHERE r.created_at >= now() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;

-- Daily cancellation rate
CREATE OR REPLACE VIEW v_cancel_rate_daily AS
SELECT
    date_trunc('day', r.created_at)::date        AS day,
    COUNT(*)                                     AS total_created,
    COUNT(*) FILTER (WHERE r.status::text = 'CANCELLED') AS total_cancelled,
    ROUND(
        COUNT(*) FILTER (WHERE r.status::text = 'CANCELLED')::numeric
        / GREATEST(COUNT(*), 1) * 100, 2
    )                                            AS cancel_pct
FROM rides r
WHERE r.created_at >= now() - INTERVAL '90 days'
GROUP BY 1
ORDER BY 1;

-- Cancellation by stage: which status was the ride in when cancelled?
CREATE OR REPLACE VIEW v_cancel_by_stage AS
SELECT
    rse.from_status                              AS stage,
    COUNT(*)                                     AS cnt,
    ROUND(AVG(EXTRACT(EPOCH FROM rse.occurred_at - r.created_at)), 1) AS avg_seconds_to_cancel
FROM ride_status_events rse
JOIN rides r ON r.id = rse.ride_id
WHERE rse.to_status = 'CANCELLED'
  AND rse.occurred_at >= now() - INTERVAL '30 days'
GROUP BY 1
ORDER BY cnt DESC;

-- Repeat cancellers: riders who cancelled 3+ times in the last 30 days
CREATE OR REPLACE VIEW v_repeat_cancellers AS
SELECT
    r.rider_id,
    COUNT(*)                                     AS cancel_count,
    COUNT(*) FILTER (WHERE rse.from_status IN ('ACCEPTED', 'PICKUP_ARRIVING', 'IN_PROGRESS'))
                                                 AS late_cancel_count,
    MIN(rse.occurred_at)                         AS first_cancel,
    MAX(rse.occurred_at)                         AS last_cancel
FROM ride_status_events rse
JOIN rides r ON r.id = rse.ride_id
WHERE rse.to_status = 'CANCELLED'
  AND rse.occurred_at >= now() - INTERVAL '30 days'
GROUP BY r.rider_id
HAVING COUNT(*) >= 3
ORDER BY cancel_count DESC;

-- Driver run cancellations
CREATE OR REPLACE VIEW v_driver_run_cancellations AS
SELECT
    dse.driver_run_id,
    dse.occurred_at                              AS cancelled_at,
    dse.from_status                              AS cancelled_from,
    dr.driver_id,
    dr.origin_address,
    dr.dest_address,
    dr.seats_total,
    dse.seats_left                               AS seats_left_at_cancel,
    EXTRACT(EPOCH FROM dse.occurred_at - dr.created_at) AS seconds_to_cancel,
    dr.created_at                                AS run_created_at
FROM driver_run_status_events dse
JOIN driver_runs dr ON dr.id = dse.driver_run_id
WHERE dse.to_status = 'CANCELLED';

COMMIT;
