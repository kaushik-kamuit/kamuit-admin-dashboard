-- Payment failure waterfall and daily aggregation views.

-- ── Payment failure waterfall ──────────────────────────────────────────────
CREATE OR REPLACE VIEW v_payment_waterfall AS
SELECT
    pi.status,
    COUNT(*) AS cnt,
    COALESCE(SUM(pi.amount_cents), 0) AS total_cents,
    ROUND(AVG(pi.amount_cents)::numeric / 100.0, 2) AS avg_amount,
    MIN(pi.created_at) AS earliest,
    MAX(pi.created_at) AS latest
FROM payment_intents pi
GROUP BY pi.status
ORDER BY cnt DESC;

-- ── Daily payment summary ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_payment_daily AS
SELECT
    DATE(pi.created_at) AS day,
    COUNT(*) FILTER (WHERE pi.status = 'succeeded') AS succeeded,
    COUNT(*) FILTER (WHERE pi.status = 'failed') AS failed,
    COUNT(*) FILTER (WHERE pi.status = 'requires_capture') AS requires_capture,
    COUNT(*) FILTER (WHERE pi.status = 'requires_payment_method') AS requires_payment_method,
    COUNT(*) AS total,
    COALESCE(SUM(pi.amount_cents) FILTER (WHERE pi.status = 'succeeded'), 0) AS succeeded_cents,
    COALESCE(SUM(pi.amount_cents) FILTER (WHERE pi.status = 'failed'), 0) AS failed_cents,
    COALESCE(SUM(pi.amount_cents), 0) AS total_cents
FROM payment_intents pi
GROUP BY DATE(pi.created_at)
ORDER BY day DESC;
