-- ============================================================================
-- 009_churn_signals.sql
--
-- Driver churn prediction signals:
--   - Activity decline (comparing recent 7d vs prior 7d)
--   - Earnings trend per driver (from payment intents)
--   - Online session frequency decline
--   - Composite churn risk score
--
-- Depends on: 002_location_pings.sql (driver_online_sessions)
--             001_event_logs.sql  (driver_run_status_events)
-- Idempotent.
-- ============================================================================

BEGIN;

-- Driver activity: runs in recent 7d vs prior 7d
CREATE OR REPLACE VIEW v_driver_activity_trend AS
SELECT
    dr.driver_id,
    COUNT(*) FILTER (WHERE dr.created_at >= now() - INTERVAL '7 days')  AS runs_recent_7d,
    COUNT(*) FILTER (WHERE dr.created_at >= now() - INTERVAL '14 days'
                       AND dr.created_at <  now() - INTERVAL '7 days')  AS runs_prior_7d,
    COUNT(*) FILTER (WHERE dr.status::text = 'COMPLETED'
                       AND dr.created_at >= now() - INTERVAL '7 days')  AS completed_recent,
    COUNT(*) FILTER (WHERE dr.status::text = 'CANCELLED'
                       AND dr.created_at >= now() - INTERVAL '7 days')  AS cancelled_recent,
    MAX(dr.created_at)                                                  AS last_run_at
FROM driver_runs dr
WHERE dr.created_at >= now() - INTERVAL '14 days'
GROUP BY dr.driver_id;

-- Driver online session trend
CREATE OR REPLACE VIEW v_driver_session_trend AS
SELECT
    dos.driver_id,
    COUNT(*) FILTER (WHERE dos.started_at >= now() - INTERVAL '7 days')  AS sessions_recent_7d,
    COUNT(*) FILTER (WHERE dos.started_at >= now() - INTERVAL '14 days'
                       AND dos.started_at <  now() - INTERVAL '7 days') AS sessions_prior_7d,
    COALESCE(SUM(dos.total_seconds) FILTER (WHERE dos.started_at >= now() - INTERVAL '7 days'), 0)
        / 3600.0                                                         AS hours_recent_7d,
    COALESCE(SUM(dos.total_seconds) FILTER (WHERE dos.started_at >= now() - INTERVAL '14 days'
                       AND dos.started_at <  now() - INTERVAL '7 days'), 0)
        / 3600.0                                                         AS hours_prior_7d,
    MAX(dos.started_at)                                                  AS last_session_at
FROM driver_online_sessions dos
WHERE dos.started_at >= now() - INTERVAL '14 days'
GROUP BY dos.driver_id;

-- Composite churn risk score (0-100, higher = more at risk)
-- Factors: activity decline, session decline, days since last run, cancel rate
CREATE OR REPLACE VIEW v_driver_churn_risk AS
WITH activity AS (
    SELECT
        dr.driver_id,
        COUNT(*) FILTER (WHERE dr.created_at >= now() - INTERVAL '7 days')  AS recent_runs,
        COUNT(*) FILTER (WHERE dr.created_at >= now() - INTERVAL '14 days'
                           AND dr.created_at <  now() - INTERVAL '7 days')  AS prior_runs,
        COUNT(*) FILTER (WHERE dr.status::text = 'CANCELLED'
                           AND dr.created_at >= now() - INTERVAL '30 days') AS cancels_30d,
        COUNT(*) FILTER (WHERE dr.created_at >= now() - INTERVAL '30 days') AS total_30d,
        MAX(dr.created_at) AS last_run_at
    FROM driver_runs dr
    WHERE dr.created_at >= now() - INTERVAL '30 days'
    GROUP BY dr.driver_id
),
sessions AS (
    SELECT
        dos.driver_id,
        COUNT(*) FILTER (WHERE dos.started_at >= now() - INTERVAL '7 days')  AS recent_sessions,
        COUNT(*) FILTER (WHERE dos.started_at >= now() - INTERVAL '14 days'
                           AND dos.started_at <  now() - INTERVAL '7 days') AS prior_sessions
    FROM driver_online_sessions dos
    WHERE dos.started_at >= now() - INTERVAL '14 days'
    GROUP BY dos.driver_id
)
SELECT
    a.driver_id,
    a.recent_runs,
    a.prior_runs,
    COALESCE(s.recent_sessions, 0) AS recent_sessions,
    COALESCE(s.prior_sessions, 0)  AS prior_sessions,
    a.cancels_30d,
    a.total_30d,
    EXTRACT(DAY FROM now() - a.last_run_at) AS days_since_last_run,
    a.last_run_at,
    -- Score components (each 0-25, sum to max 100)
    LEAST(25, CASE
        WHEN a.prior_runs = 0 THEN 0
        ELSE ROUND(GREATEST(0, (1.0 - a.recent_runs::numeric / GREATEST(a.prior_runs, 1))) * 25)
    END) AS activity_decline_score,
    LEAST(25, CASE
        WHEN COALESCE(s.prior_sessions, 0) = 0 THEN 0
        ELSE ROUND(GREATEST(0, (1.0 - COALESCE(s.recent_sessions, 0)::numeric / GREATEST(COALESCE(s.prior_sessions, 1), 1))) * 25)
    END) AS session_decline_score,
    LEAST(25, ROUND(GREATEST(0, EXTRACT(DAY FROM now() - a.last_run_at) - 1) * 3.5)) AS inactivity_score,
    LEAST(25, CASE
        WHEN a.total_30d = 0 THEN 0
        ELSE ROUND(a.cancels_30d::numeric / GREATEST(a.total_30d, 1) * 25)
    END) AS cancel_rate_score,
    -- Total risk (0-100)
    LEAST(100,
        LEAST(25, CASE WHEN a.prior_runs = 0 THEN 0
            ELSE ROUND(GREATEST(0, (1.0 - a.recent_runs::numeric / GREATEST(a.prior_runs, 1))) * 25) END)
      + LEAST(25, CASE WHEN COALESCE(s.prior_sessions, 0) = 0 THEN 0
            ELSE ROUND(GREATEST(0, (1.0 - COALESCE(s.recent_sessions, 0)::numeric / GREATEST(COALESCE(s.prior_sessions, 1), 1))) * 25) END)
      + LEAST(25, ROUND(GREATEST(0, EXTRACT(DAY FROM now() - a.last_run_at) - 1) * 3.5))
      + LEAST(25, CASE WHEN a.total_30d = 0 THEN 0
            ELSE ROUND(a.cancels_30d::numeric / GREATEST(a.total_30d, 1) * 25) END)
    ) AS churn_risk_score
FROM activity a
LEFT JOIN sessions s ON s.driver_id = a.driver_id
ORDER BY churn_risk_score DESC;

COMMIT;
