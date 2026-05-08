-- ============================================================================
-- user_mgmt/001_indexes.sql
--
-- Additional indexes used by the admin dashboard. No schema shape change.
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS ix_users_created_at        ON users (created_at);
CREATE INDEX IF NOT EXISTS ix_users_usertype          ON users (usertype_id);
CREATE INDEX IF NOT EXISTS ix_users_auth_provider     ON users (auth_provider);
CREATE INDEX IF NOT EXISTS ix_preferred_loc_user      ON preferred_locations (user_id);

COMMIT;
