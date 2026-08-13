-- Activate curriculum_fact_distillations table for pre-generated explanations.
-- The table already exists (same shape as curriculum_fact_images).
-- Just needs an index for fast lookups by fact_id.

CREATE INDEX IF NOT EXISTS idx_curriculum_fact_distillations_fact_id
    ON curriculum_fact_distillations(curriculum_fact_id);
