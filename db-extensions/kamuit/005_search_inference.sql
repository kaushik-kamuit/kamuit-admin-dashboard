-- ============================================================================
-- 005_search_inference.sql
--
-- The matching service does not persist any record of rider searches, so we
-- cannot build a true search-to-book funnel or an "unmet demand" heatmap
-- (searches that returned zero results). What we CAN do from the DB alone
-- is treat each distinct `ride_preferences.preference_session_id` as a
-- best-effort proxy for a successful search (one where the rider at least
-- selected a primary preference).
--
-- This view is clearly labeled so the dashboard can warn users about the
-- gap.
--
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW inferred_searches AS
SELECT
    rp.preference_session_id                              AS session_id,
    rp.passenger_id                                       AS passenger_id,
    MIN(rp.selected_at)                                   AS searched_at,
    COUNT(*)                                              AS candidates_shown,
    SUM(CASE WHEN rp.status = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted_count,
    SUM(CASE WHEN rp.status = 'DECLINED' THEN 1 ELSE 0 END) AS declined_count,
    SUM(CASE WHEN rp.status = 'EXPIRED'  THEN 1 ELSE 0 END) AS expired_count,
    SUM(CASE WHEN rp.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_count,
    MAX(rp.is_primary::int)                               AS has_primary,
    BOOL_OR(rp.status = 'ACCEPTED')                       AS converted,
    MIN(rp.estimated_price)                               AS min_price,
    MAX(rp.estimated_price)                               AS max_price,
    MIN(rp.pickup_time)                                   AS min_pickup_time,
    MAX(rp.pickup_time)                                   AS max_pickup_time
FROM ride_preferences rp
WHERE rp.preference_session_id IS NOT NULL
GROUP BY rp.preference_session_id, rp.passenger_id;

COMMENT ON VIEW inferred_searches IS
    'Best-effort proxy for rider searches, derived from ride_preferences. '
    'Searches that produced zero matches are NOT captured here because the '
    'matching service does not persist search telemetry.';

-- Summary of the funnel per session for the dashboard
CREATE OR REPLACE VIEW preference_funnel_v2 AS
SELECT
    date_trunc('hour', e.occurred_at)   AS bucket_hour,
    e.to_status                         AS status,
    COUNT(*)                            AS transitions
FROM preference_status_events e
GROUP BY bucket_hour, e.to_status;

COMMIT;
