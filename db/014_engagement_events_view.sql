-- v_engagement_events — flat, queryable surface over the per-turn telemetry that
-- powers the engagement-monitoring dashboard (ADO #26) and ad-hoc analyst queries.
--
-- One row per relevant event, unioned from BOTH logs because clicks and outcomes
-- live in different places:
--   * execution_log (nested {timestamp, step, agent, details:{...}}):
--       CHIP_MATCH, SUGGESTIONS_FALLBACK, COMPLIANCE_VIOLATION, V6_TRANSITION,
--       LLM_RESPONSE, ASSESSMENT_LLM_RESPONSE
--   * system_log (flat {ts, event, fact_discussed, interaction_type, step_from,...}):
--       ASSESSMENT  (the authoritative student-answer outcome, fact-aligned)
--
-- Decouples analysis from the dashboard: an analyst can slice by age_band / subject
-- / tutor / phase / intent directly in psql or a BI tool. The /api/reporting/engagement
-- endpoint's cheap aggregates also GROUP BY over this view instead of re-expanding JSONB.
--
-- Idempotent (DROP + CREATE — DROP because column types/order may change across
-- revisions, which CREATE OR REPLACE forbids). Applied by run-dev's
-- apply_post_restore_sql (db/0*.sql) and the prod runbook.

DROP VIEW IF EXISTS v_engagement_events;
CREATE VIEW v_engagement_events AS
WITH base AS (
    SELECT
        s.id            AS session_id,
        s.student_id,
        s.start_time,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                 s.student_id)              AS student_name,
        u.dob,
        sub.name                            AS subject,
        t.persona->>'tutor_name'            AS tutor,
        s.execution_log,
        s.system_log
    FROM learning_sessions s
    LEFT JOIN students st            ON st.student_id = s.student_id
    LEFT JOIN users u                ON u.id = st.user_id
    LEFT JOIN curriculum_capsules cc ON cc.id = s.curriculum_capsule_id
    LEFT JOIN curriculum_themes ct   ON ct.id = cc.curriculum_theme_id
    LEFT JOIN subject_curriculum sc  ON sc.id = ct.subject_curriculum_id
    LEFT JOIN subjects sub           ON sub.id = sc.subject_id
    LEFT JOIN tutors t               ON t.id = s.tutor_id
),
raw AS (
    -- execution_log: nested details
    SELECT b.session_id, b.student_id, b.student_name, b.dob, b.subject, b.tutor,
           b.start_time, e.elem AS d, e.ord AS ord, 'exec'::text AS src
    FROM base b
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(b.execution_log) = 'array' THEN b.execution_log ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(elem, ord)
    UNION ALL
    -- system_log: flat fields (ASSESSMENT outcomes)
    SELECT b.session_id, b.student_id, b.student_name, b.dob, b.subject, b.tutor,
           b.start_time, e.elem AS d, e.ord AS ord, 'sys'::text AS src
    FROM base b
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(b.system_log) = 'array' THEN b.system_log ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(elem, ord)
)
SELECT
    session_id,
    student_id,
    student_name,
    subject,
    tutor,
    CASE
        WHEN dob IS NULL THEN 'unknown'
        WHEN EXTRACT(YEAR FROM age(dob)) < 11 THEN '8-10'
        WHEN EXTRACT(YEAR FROM age(dob)) < 14 THEN '11-13'
        WHEN EXTRACT(YEAR FROM age(dob)) < 16 THEN '14-15'
        ELSE '16-18'
    END                                                          AS age_band,
    src,
    ord,
    COALESCE(d->>'step', d->>'event')                            AS step,
    -- timestamptz (not text): execution_log logs tz-aware ISO, system_log logs
    -- naive ISO — a lexical text sort would interleave them wrongly. Casting
    -- normalizes both to real instants so the outcome walk orders correctly
    -- (naive strings resolve against the server TZ, which is UTC in deploy).
    COALESCE(d->>'timestamp', d->>'ts')::timestamptz             AS ts,
    d->'details'->>'intent'                                      AS intent,
    (d->'details'->>'hit')::boolean                              AS hit,
    -- fact: CHIP_MATCH/V6_TRANSITION carry it in details.fact; ASSESSMENT in fact_discussed
    COALESCE(d->'details'->>'fact', d->>'fact_discussed')        AS fact,
    d->'details'->>'subtype'                                     AS subtype,
    -- phase: chip/fallback details.phase; V6_TRANSITION from_phase; ASSESSMENT step_from
    COALESCE(d->'details'->>'phase',
             d->'details'->>'from_phase',
             d->>'step_from')                                    AS phase,
    d->'details'->>'action'                                      AS action,
    -- ADO #74: on an evidence-guard strike-out the V6_TRANSITION row carries the
    -- graded fact here (the engine already advanced `fact` to the next one), so the
    -- outcome walk can count the strike-out as a hollow gate-fail, not a "solid".
    d->'details'->>'strikeout_fact'                              AS strikeout_fact,
    COALESCE(d->'details'->>'interaction_type', d->>'interaction_type') AS interaction_type,
    (d->'details'->>'latency_ms')::numeric                       AS latency_ms,
    start_time
FROM raw;
