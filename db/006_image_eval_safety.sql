-- Image-eval safety migration:
-- 1) enforce one curriculum_fact_images row per fact
-- 2) add lookup indexes for frequent variant workflows

-- Deduplicate by keeping the lowest UUID text value for each curriculum_fact_id.
WITH ranked AS (
    SELECT
        id,
        curriculum_fact_id,
        ROW_NUMBER() OVER (PARTITION BY curriculum_fact_id ORDER BY id::text) AS rn
    FROM curriculum_fact_images
)
DELETE FROM curriculum_fact_images cfi
USING ranked r
WHERE cfi.id = r.id
  AND r.rn > 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'curriculum_fact_images_curriculum_fact_id_key'
          AND conrelid = 'public.curriculum_fact_images'::regclass
    ) THEN
        ALTER TABLE public.curriculum_fact_images
            ADD CONSTRAINT curriculum_fact_images_curriculum_fact_id_key
            UNIQUE (curriculum_fact_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_curriculum_fact_images_fact_id
    ON public.curriculum_fact_images (curriculum_fact_id);
