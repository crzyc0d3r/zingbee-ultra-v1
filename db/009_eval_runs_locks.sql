-- Cross-worker in-flight dedup for metaphor-eval (and future eval pipelines).
-- The in-memory dedup in metaphor_eval_routes only works for a single uvicorn
-- worker; production runs multiple workers, so two operators on different
-- workers can both pass the dedup check and double-spend.
--
-- This table acts as an atomic in-flight marker via INSERT ... ON CONFLICT.
-- The zombie reaper (db.reset_metaphor_eval_zombies + reap_stale_scope_dedup)
-- cleans up rows from crashed workers.

CREATE TABLE IF NOT EXISTS public.eval_runs_locks (
    scope_key   text PRIMARY KEY,
    job_id      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT NOW()
);

-- Cleanup-by-age uses created_at; index it for the reaper's range scan.
CREATE INDEX IF NOT EXISTS idx_eval_runs_locks_created_at
    ON public.eval_runs_locks (created_at);
