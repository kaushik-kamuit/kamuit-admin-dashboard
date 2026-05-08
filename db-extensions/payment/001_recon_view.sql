-- ============================================================================
-- payment/001_recon_view.sql
--
-- Settlement / reconciliation rollups in the payment DB. Read-only views;
-- no schema changes. Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW v_driver_settlement AS
SELECT
    wt.driver_id,
    COUNT(*) FILTER (WHERE wt.ledger = 'earnings' AND wt.tx_type = 'credit')   AS earning_credits,
    COUNT(*) FILTER (WHERE wt.ledger = 'earnings' AND wt.tx_type = 'debit')    AS earning_debits,
    COALESCE(SUM(wt.amount_cents) FILTER (WHERE wt.ledger = 'earnings' AND wt.tx_type = 'credit'), 0) AS earnings_in_cents,
    COALESCE(SUM(wt.amount_cents) FILTER (WHERE wt.ledger = 'earnings' AND wt.tx_type = 'debit'),  0) AS earnings_out_cents,
    COALESCE(SUM(wt.amount_cents) FILTER (WHERE wt.ledger = 'credits'),  0) AS credits_cents,
    COUNT(DISTINCT wt.source_id) FILTER (WHERE wt.source_type = 'ride')        AS rides_paid,
    SUM(wt.rider_count) FILTER (WHERE wt.source_type = 'ride')                AS riders_served,
    MIN(wt.created_at)   AS first_tx_at,
    MAX(wt.created_at)   AS last_tx_at
FROM wallet_transactions wt
GROUP BY wt.driver_id;

CREATE OR REPLACE VIEW v_payment_intent_daily AS
SELECT
    date_trunc('day', pi.created_at) AS day,
    pi.status,
    COUNT(*)                         AS intents,
    SUM(pi.amount_cents)             AS total_cents
FROM payment_intents pi
GROUP BY 1, 2;

COMMIT;
