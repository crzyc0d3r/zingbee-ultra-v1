-- Bring prod public schema in line with local.
-- Safe to run multiple times: idempotent where possible.
-- Integrity probes on 2026-04-10 confirmed zero NULLs / zero dupes for all
-- tightened constraints before this was executed.

BEGIN;

-- 1. scheduled_maintenance table
CREATE TABLE IF NOT EXISTS public.scheduled_maintenance (
    id integer NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    CONSTRAINT pk_scheduled_maintenance PRIMARY KEY (id)
);

-- 2. Default for curriculum_fact_images.id
ALTER TABLE public.curriculum_fact_images
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 3. Unique on curriculum_fact_images.curriculum_fact_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'curriculum_fact_images_curriculum_fact_id_key'
    ) THEN
        ALTER TABLE public.curriculum_fact_images
            ADD CONSTRAINT curriculum_fact_images_curriculum_fact_id_key
            UNIQUE (curriculum_fact_id);
    END IF;
END$$;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_curriculum_fact_distillations_fact_id
    ON public.curriculum_fact_distillations USING btree (curriculum_fact_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_fact_images_fact_id
    ON public.curriculum_fact_images USING btree (curriculum_fact_id);

-- 5. NOT NULL tightenings
ALTER TABLE public.learning_session_feedback ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.learning_session_feedback ALTER COLUMN student_id SET NOT NULL;
ALTER TABLE public.learning_sessions ALTER COLUMN tutor_id SET NOT NULL;

COMMIT;
