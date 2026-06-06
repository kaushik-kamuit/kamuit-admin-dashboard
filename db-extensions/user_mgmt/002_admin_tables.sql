-- Admin-specific tables: users (RBAC), audit log, alerts, metrics snapshots, stripe events.
-- All prefixed with admin_ to avoid collisions with application tables.

-- ── RBAC: admin user accounts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
    id          SERIAL PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'operator', 'admin')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login  TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT true
);

-- ── Audit log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    username    TEXT NOT NULL,
    role        TEXT,
    action      TEXT NOT NULL,
    resource    TEXT,
    resource_id TEXT,
    detail      JSONB,
    ip_address  TEXT,
    user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_log_ts ON admin_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_user ON admin_audit_log (username);
CREATE INDEX IF NOT EXISTS ix_audit_log_action ON admin_audit_log (action);

-- ── Alerts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_alerts (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    severity    TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    detail      TEXT,
    entity_type TEXT,
    entity_id   TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    meta        JSONB
);
CREATE INDEX IF NOT EXISTS ix_alerts_ts ON admin_alerts (ts DESC);
CREATE INDEX IF NOT EXISTS ix_alerts_open ON admin_alerts (resolved_at) WHERE resolved_at IS NULL;

-- ── Metrics snapshots (time-series) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_metrics_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_drivers  INT,
    active_trips    INT,
    open_runs       INT,
    pending_verifications INT,
    failed_payments INT,
    held_capture_amount NUMERIC(12,2),
    online_drivers  INT,
    completed_rides_24h INT,
    cancelled_rides_24h INT,
    total_revenue_24h NUMERIC(12,2),
    avg_match_time_s NUMERIC(8,2),
    meta            JSONB
);
CREATE INDEX IF NOT EXISTS ix_metrics_ts ON admin_metrics_snapshots (ts DESC);

-- ── Stripe webhook event log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_stripe_events (
    id              BIGSERIAL PRIMARY KEY,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    stripe_event_id TEXT UNIQUE,
    event_type      TEXT NOT NULL,
    api_version     TEXT,
    livemode        BOOLEAN,
    payload         JSONB NOT NULL,
    processed       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_stripe_events_type ON admin_stripe_events (event_type);
CREATE INDEX IF NOT EXISTS ix_stripe_events_ts ON admin_stripe_events (received_at DESC);
