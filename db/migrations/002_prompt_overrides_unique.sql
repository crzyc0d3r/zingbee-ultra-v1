-- Add partial UNIQUE indexes to prevent concurrent duplicate inserts in prompt_overrides.
-- Fixes H-7: SELECT-then-INSERT race condition in upsert_prompt_override().
-- Run manually before deploying the distillation pipeline update.

-- Deduplicate any existing duplicates first (keep most recent by updated_at)
DELETE FROM prompt_overrides po
WHERE active = TRUE
  AND po.id NOT IN (
    SELECT DISTINCT ON (scope_type, scope_key, prompt_id, strategy)
        id
    FROM prompt_overrides
    WHERE active = TRUE
    ORDER BY scope_type, scope_key, prompt_id, strategy, updated_at DESC
  );

-- Partial unique index for rows where strategy IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_override_strategy
    ON prompt_overrides (scope_type, scope_key, prompt_id, strategy)
    WHERE strategy IS NOT NULL AND active = TRUE;

-- Partial unique index for rows where strategy IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_override_global
    ON prompt_overrides (scope_type, scope_key, prompt_id)
    WHERE strategy IS NULL AND active = TRUE;
