-- Add capsule-level meta_data JSONB column.
-- Home for the authored sustained metaphor (capsule.meta_data.metaphor) and
-- future capsule-level fields foreshadowed in foundations/designing-for-learning-pedagogy
-- (building_text_id, building_text_excerpt, building_text_license_status, etc.).
-- Mirrors the existing curriculum_facts.meta_data JSONB pattern.
--
-- Pure additive: NOT NULL DEFAULT '{}'::jsonb covers all existing rows without backfill.

ALTER TABLE public.curriculum_capsules
    ADD COLUMN IF NOT EXISTS meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Boolean-expression index on "is metaphor authored?" — splits the table cleanly
-- so the metaphor-eval pipeline can scan unauthored capsules cheaply, and the
-- engine's init_session can confirm an authored value exists in O(1).
-- Indexing meta_data->>'metaphor' as text gives near-zero selectivity (every
-- authored row has a near-unique value) so Postgres seqscans anyway.
CREATE INDEX IF NOT EXISTS idx_capsules_has_metaphor
    ON public.curriculum_capsules ((meta_data ? 'metaphor'));
