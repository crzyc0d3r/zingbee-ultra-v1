-- Track B (ADO #58): storage for the session-level PEDAGOGY scorer.
--
-- Root post-restore migration (run-dev.sh apply_post_restore_sql globs db/0*.sql
-- AFTER restoring the latest backup), so it survives a DB restore the same way
-- 010/011/012 do. Idempotent: safe to re-run with ON_ERROR_STOP=1.
--
-- Two tables, both keyed by run_id (one scoring invocation):
--   pedagogy_eval_runs     — UNAGGREGATED, one row per (session, dimension, judge).
--                            This is the raw signal: every judge family's 1-5 score
--                            on every dimension, with its flags + fallback status.
--                            p50/p95 per dimension are computed at READ time
--                            (reporting_routes), not stored.
--   pedagogy_eval_sessions — one row per scored session: the multi-objective vector
--                            (D7) {pedagogy_quality, p50_latency_ms, tokens_per_turn}
--                            plus consensus variance and outcome columns for the
--                            later D6 retention join (kept nullable; B3 fills meaning).
--
-- template_hash is nullable and has NO FK to prompt_versions (Track A, unmerged):
-- it is the join key to prompt_versions.content_hash once #72 lands, harmless until.

-- gen_random_uuid() is core on PG16, but assert pgcrypto so a fresh post-restore apply
-- (after run-dev's DROP SCHEMA public CASCADE) can't fail under ON_ERROR_STOP=1 and abort
-- the whole db/0*.sql chain on a search_path/extension edge case.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pedagogy_eval_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          text NOT NULL,                 -- one scoring invocation (groups rows)
    session_id      uuid REFERENCES public.learning_sessions(id) ON DELETE CASCADE,
    capsule_id      uuid,
    fixture_set     text,                          -- batch tag, e.g. 'biology-2026-06-08'
    rubric_version  integer NOT NULL,              -- pedagogy_eval_policy.RUBRIC_VERSION
    dimension       text NOT NULL,                 -- one of the 8 principle dimensions
    judge_name      text NOT NULL,                 -- panel slot, e.g. 'qwen'
    judge_family    text,                          -- training family, e.g. 'qwen'/'llama'
    judge_provider  text,                          -- 'local_ollama' | 'xai' | ...
    judge_model     text,                          -- e.g. 'qwen2.5:14b'
    score           integer,                       -- raw 1-5 (NULL if judge errored)
    score_norm      real,                          -- normalized 0..1 (NULL if errored)
    flags           jsonb NOT NULL DEFAULT '[]'::jsonb,
    fell_back       boolean NOT NULL DEFAULT false, -- judge degraded off its local model
    reasoning       text,
    template_hash   text,                          -- -> prompt_versions.content_hash (Track A)
    model_version   text,                          -- tutor model that produced the session
    created_at      timestamptz NOT NULL DEFAULT NOW()
);

-- Read-time aggregation filters on (rubric_version [, fixture_set]) and GROUPs BY dimension
-- (aggregate_pedagogy_scores). Lead the index with those columns; judge_family is not a
-- query key today (it equals judge_name), so it isn't in the index.
CREATE INDEX IF NOT EXISTS idx_pedagogy_runs_dim
    ON public.pedagogy_eval_runs (rubric_version, fixture_set, dimension);
CREATE INDEX IF NOT EXISTS idx_pedagogy_runs_session
    ON public.pedagogy_eval_runs (session_id);
CREATE INDEX IF NOT EXISTS idx_pedagogy_runs_run
    ON public.pedagogy_eval_runs (run_id);
CREATE INDEX IF NOT EXISTS idx_pedagogy_runs_template
    ON public.pedagogy_eval_runs (template_hash);
CREATE INDEX IF NOT EXISTS idx_pedagogy_runs_fixture
    ON public.pedagogy_eval_runs (fixture_set);


CREATE TABLE IF NOT EXISTS public.pedagogy_eval_sessions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id             text NOT NULL,
    session_id         uuid REFERENCES public.learning_sessions(id) ON DELETE CASCADE,
    capsule_id         uuid,
    fixture_set        text,
    rubric_version     integer NOT NULL,
    -- multi-objective vector (D7): a 5pp-better/2x-slower prompt is dominated, not a win
    pedagogy_quality   real,        -- weighted composite of per-dimension consensus, 0..1
    consensus_variance real,        -- mean per-dimension max-min across judges (0..1)
    p50_latency_ms     integer,     -- median tutor-turn latency in the session
    tokens_per_turn    real,        -- completion tokens / assistant turn
    total_turns        integer,
    -- outcome columns for the later D6 retention join (NOT trusted yet — see policy header)
    session_completion text,        -- FULLY_MASTERED | COMPLETED_WITH_GAPS | ...
    forfeit_rate       real,
    -- advisory badge only (D2): never gates the tutoring hot path
    decision           text,        -- STRONG | WEAK | REVIEW
    reasons            jsonb NOT NULL DEFAULT '[]'::jsonb,
    template_hash      text,
    model_version      text,
    created_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedagogy_sessions_session
    ON public.pedagogy_eval_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_pedagogy_sessions_run
    ON public.pedagogy_eval_sessions (run_id);
CREATE INDEX IF NOT EXISTS idx_pedagogy_sessions_template
    ON public.pedagogy_eval_sessions (template_hash);
CREATE INDEX IF NOT EXISTS idx_pedagogy_sessions_fixture
    ON public.pedagogy_eval_sessions (fixture_set, rubric_version);
