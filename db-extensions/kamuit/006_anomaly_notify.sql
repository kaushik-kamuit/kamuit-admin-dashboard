-- Trigger NOTIFY on new driver_location_pings for live tracking via WebSocket.
-- Also: view for trip anomaly detection (speed, stale, duration).

-- ── NOTIFY on new pings (for WebSocket fan-out) ───────────────────────────
CREATE OR REPLACE FUNCTION notify_new_ping() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('live_pings', json_build_object(
        'driver_run_id', NEW.driver_run_id,
        'driver_id',     NEW.driver_id,
        'lat',           NEW.latitude,
        'lng',           NEW.longitude,
        'ts',            NEW.recorded_at
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_new_ping ON driver_location_pings;
CREATE TRIGGER trg_notify_new_ping
    AFTER INSERT ON driver_location_pings
    FOR EACH ROW EXECUTE FUNCTION notify_new_ping();

-- ── Trip anomaly detection view ────────────────────────────────────────────
-- Computes speed between consecutive pings and flags anomalies.
CREATE OR REPLACE VIEW v_trip_anomalies AS
WITH consecutive AS (
    SELECT
        p.id,
        p.driver_run_id,
        p.driver_id,
        p.latitude,
        p.longitude,
        p.recorded_at,
        LAG(p.latitude)    OVER w AS prev_lat,
        LAG(p.longitude)   OVER w AS prev_lng,
        LAG(p.recorded_at) OVER w AS prev_ts
    FROM driver_location_pings p
    WINDOW w AS (PARTITION BY p.driver_run_id ORDER BY p.recorded_at)
),
with_speed AS (
    SELECT
        c.*,
        EXTRACT(EPOCH FROM (c.recorded_at - c.prev_ts)) AS gap_s,
        -- Haversine distance in km (approximate)
        CASE WHEN c.prev_lat IS NOT NULL AND EXTRACT(EPOCH FROM (c.recorded_at - c.prev_ts)) > 0 THEN
            (6371 * acos(
                LEAST(1.0, GREATEST(-1.0,
                    cos(radians(c.prev_lat)) * cos(radians(c.latitude))
                    * cos(radians(c.longitude) - radians(c.prev_lng))
                    + sin(radians(c.prev_lat)) * sin(radians(c.latitude))
                ))
            )) / (EXTRACT(EPOCH FROM (c.recorded_at - c.prev_ts)) / 3600.0)
        END AS speed_kmh
    FROM consecutive c
)
SELECT
    s.id AS ping_id,
    s.driver_run_id,
    s.driver_id,
    s.latitude,
    s.longitude,
    s.recorded_at,
    s.gap_s,
    ROUND(s.speed_kmh::numeric, 1) AS speed_kmh,
    CASE
        WHEN s.speed_kmh > 200 THEN 'gps_spoof'
        WHEN s.speed_kmh > 160 THEN 'excessive_speed'
        WHEN s.gap_s > 600 THEN 'stale_gps'
        WHEN s.gap_s > 300 THEN 'ping_gap'
        ELSE NULL
    END AS anomaly_type
FROM with_speed s
WHERE s.prev_ts IS NOT NULL
  AND (s.speed_kmh > 160 OR s.gap_s > 300);

-- ── Route deviation view (straight-line distance from driver to run destination) ─
CREATE OR REPLACE VIEW v_route_deviations AS
SELECT
    dr.id AS driver_run_id,
    dr.driver_id,
    dr.status,
    ST_Y(dr.dest_point::geometry) AS dest_lat,
    ST_X(dr.dest_point::geometry) AS dest_lng,
    p.latitude AS current_lat,
    p.longitude AS current_lng,
    p.recorded_at,
    ROUND((6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
            cos(radians(p.latitude)) * cos(radians(ST_Y(dr.dest_point::geometry)))
            * cos(radians(ST_X(dr.dest_point::geometry)) - radians(p.longitude))
            + sin(radians(p.latitude)) * sin(radians(ST_Y(dr.dest_point::geometry)))
        ))
    ))::numeric, 2) AS distance_to_dest_km
FROM driver_runs dr
JOIN LATERAL (
    SELECT dlp.latitude, dlp.longitude, dlp.recorded_at
    FROM driver_location_pings dlp
    WHERE dlp.driver_run_id = dr.id
    ORDER BY dlp.recorded_at DESC
    LIMIT 1
) p ON true
WHERE dr.status = 'IN_PROGRESS';

-- ── Driver utilization view ────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_driver_utilization AS
SELECT
    dos.driver_id,
    COUNT(DISTINCT dos.id) AS session_count,
    COALESCE(SUM(EXTRACT(EPOCH FROM (dos.ended_at - dos.started_at)) / 3600.0), 0) AS online_hours,
    COALESCE(active.active_hours, 0) AS active_hours,
    CASE WHEN SUM(EXTRACT(EPOCH FROM (dos.ended_at - dos.started_at))) > 0
        THEN ROUND((COALESCE(active.active_hours, 0) /
              NULLIF(SUM(EXTRACT(EPOCH FROM (dos.ended_at - dos.started_at)) / 3600.0), 0) * 100)::numeric, 1)
        ELSE 0
    END AS utilization_pct
FROM driver_online_sessions dos
LEFT JOIN LATERAL (
    SELECT
        dr.driver_id,
        SUM(EXTRACT(EPOCH FROM (
            COALESCE(dr.updated_at, now()) - dr.created_at
        )) / 3600.0) AS active_hours
    FROM driver_runs dr
    WHERE dr.driver_id = dos.driver_id
      AND dr.status IN ('IN_PROGRESS', 'COMPLETED')
    GROUP BY dr.driver_id
) active ON true
GROUP BY dos.driver_id, active.active_hours;
