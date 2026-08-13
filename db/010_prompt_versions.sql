-- 010: Prompt version history for base tutor prompt templates (Track A: track/diff/rollback).
-- Post-restore migration (auto-applied by run-dev.sh apply_post_restore_sql; idempotent).
--
-- Append-only snapshot of every change to
--   learning_system_schemas.descision_tree.prompt_registry[prompt_id].template
--
-- NOT read at runtime: prompt_registry remains the single live source the tutor renders.
-- This table is the history/diff/rollback ledger only — no effect on tutoring behavior.
--
-- content_hash is the SAME identity hash written into per-turn telemetry (011), so a logged
-- turn's template_hash joins directly to the exact version row that produced it.

CREATE TABLE IF NOT EXISTS prompt_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_id UUID NOT NULL,
    schema_name TEXT,
    prompt_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    author TEXT,
    source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'automated', 'rollback', 'import')),
    note TEXT,
    parent_version_id UUID REFERENCES prompt_versions(id),
    is_live BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_lookup
    ON prompt_versions (schema_id, prompt_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_hash
    ON prompt_versions (content_hash);

-- At most one live version per (schema_id, prompt_id). The writer demotes the prior
-- live row in the same transaction before inserting the new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_versions_live
    ON prompt_versions (schema_id, prompt_id) WHERE is_live = TRUE;
