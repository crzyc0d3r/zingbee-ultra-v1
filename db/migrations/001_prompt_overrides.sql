-- Prompt overrides table for per-scope prompt tuning.
-- Supports layered overrides: global < subject < phase < theme < capsule.
-- Used by both manual tuning and the automated prompt optimizer.

CREATE TABLE IF NOT EXISTS prompt_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'subject', 'phase', 'theme', 'capsule')),
    scope_key TEXT NOT NULL,
    prompt_id TEXT NOT NULL,
    strategy TEXT,
    override_type TEXT NOT NULL CHECK (override_type IN ('replace', 'prepend', 'append')),
    content TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'manual',
    performance_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_prompt_overrides_scope
    ON prompt_overrides (scope_type, scope_key, active);
CREATE INDEX IF NOT EXISTS idx_prompt_overrides_prompt
    ON prompt_overrides (prompt_id, strategy);
