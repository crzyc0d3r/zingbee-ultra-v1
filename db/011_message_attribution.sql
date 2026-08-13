-- 011: Per-turn prompt + model attribution on chat messages (Track A3).
-- Post-restore migration (auto-applied by run-dev.sh apply_post_restore_sql; idempotent).
--
-- All nullable; existing rows stay NULL. The message-save path folds these into its existing
-- INSERT and falls back to the base insert if these columns aren't present yet.
--
-- template_hash joins to prompt_versions.content_hash (010), so every assistant turn is
-- attributable to the exact prompt version + model that produced it. `model` is the configured
-- tutor model; the drift signal (xAI build that actually served the turn) is in the
-- LLM_RESPONSE execution_log event as `served_fingerprint` (response.system_fingerprint).

ALTER TABLE learning_session_messages
    ADD COLUMN IF NOT EXISTS prompt_id TEXT,
    ADD COLUMN IF NOT EXISTS template_hash TEXT,
    ADD COLUMN IF NOT EXISTS model TEXT;

CREATE INDEX IF NOT EXISTS idx_lsm_template_hash
    ON learning_session_messages (template_hash);
