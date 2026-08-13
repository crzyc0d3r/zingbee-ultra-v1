--
-- ZingBee Ultra -- base database schema (PostgreSQL 16+ / TimescaleDB)
--
-- Structure only: tables, columns, types, defaults, constraints, indexes,
-- views, functions, triggers and extensions. Contains NO application data.
--
-- Generated from a production structure dump with every COPY data block
-- removed. This is the base schema that the incremental migrations in this
-- directory build on -- apply this file FIRST, then the numbered migrations.
--
--   createdb zingbee-ultra
--   psql -d zingbee-ultra -v ON_ERROR_STOP=1 -f db/schema.sql
--   psql -d zingbee-ultra -v ON_ERROR_STOP=1 -f db/migrations/001_prompt_overrides.sql
--   ... then 002, 003, and the numbered files in db/
--
-- Requires these extensions: pg_trgm, pgcrypto, uuid-ossp.
--
-- The production image also installs timescaledb and timescaledb_toolkit, but
-- nothing uses them -- the source dump declares zero hypertables, zero chunks
-- and zero continuous aggregates. Their CREATE EXTENSION lines are therefore
-- commented out below so this file restores on vanilla PostgreSQL 16+.
-- Uncomment them if you are deploying onto a TimescaleDB image and want parity.
--

--
-- PostgreSQL database dump
--

-- Dumped from database version 18.4 (Ubuntu 18.4-1.pgdg22.04+1)
-- Dumped by pg_dump version 18.4 (Ubuntu 18.4-1.pgdg22.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it

ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';

--
-- Name: timescaledb; Type: EXTENSION; Schema: -; Owner: -
--

-- CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;  -- unused; see header

--
-- Name: EXTENSION timescaledb; Type: COMMENT; Schema: -; Owner: 
--

--
-- Name: timescaledb_toolkit; Type: EXTENSION; Schema: -; Owner: -
--

-- CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit WITH SCHEMA public;  -- unused; see header

--
-- Name: EXTENSION timescaledb_toolkit; Type: COMMENT; Schema: -; Owner: 
--

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_sessions (
    token text NOT NULL,
    user_id uuid NOT NULL,
    students jsonb DEFAULT '[]'::jsonb NOT NULL,
    display_name text,
    email text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.auth_sessions OWNER TO postgres;

--
-- Name: curriculum_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.curriculum_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    audit_date timestamp with time zone DEFAULT now() NOT NULL,
    content text,
    subjects_count integer DEFAULT 0,
    capsules_count integer DEFAULT 0,
    facts_count integer DEFAULT 0,
    issues_count integer DEFAULT 0,
    health_score integer DEFAULT 0,
    created_by uuid,
    created_date timestamp with time zone DEFAULT now(),
    data jsonb
);

ALTER TABLE public.curriculum_audit OWNER TO postgres;

--
-- Name: curriculum_capsules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.curriculum_capsules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    curriculum_theme_id uuid NOT NULL,
    capsule_order integer NOT NULL,
    name text NOT NULL,
    created_date timestamp with time zone DEFAULT now(),
    meta_data jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE public.curriculum_capsules OWNER TO postgres;

--
-- Name: curriculum_fact_distillations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.curriculum_fact_distillations (
    id uuid NOT NULL,
    curriculum_fact_id uuid NOT NULL,
    meta_data jsonb[]
);

ALTER TABLE public.curriculum_fact_distillations OWNER TO postgres;

--
-- Name: curriculum_fact_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.curriculum_fact_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    curriculum_fact_id uuid NOT NULL,
    meta_data jsonb[]
);

ALTER TABLE public.curriculum_fact_images OWNER TO postgres;

--
-- Name: curriculum_facts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.curriculum_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    curriculum_capsule_id uuid NOT NULL,
    "order" integer NOT NULL,
    meta_data jsonb NOT NULL,
    created_date timestamp with time zone DEFAULT now()
);

ALTER TABLE public.curriculum_facts OWNER TO postgres;

--
-- Name: curriculum_themes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.curriculum_themes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_curriculum_id uuid NOT NULL,
    theme_order integer NOT NULL,
    name text NOT NULL,
    created_date timestamp with time zone DEFAULT now(),
    learning_system_id uuid,
    -- No default: the original dump defaulted this to a specific production
    -- tutors row, which does not exist in a fresh install and would fail the
    -- curriculum_themes_tutor_id_fkey check. Assign a tutor explicitly.
    tutor_id uuid NOT NULL,
    description text DEFAULT ''::text
);

ALTER TABLE public.curriculum_themes OWNER TO postgres;

--
-- Name: eval_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.eval_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text NOT NULL,
    targets text[] DEFAULT '{}'::text[] NOT NULL,
    config text DEFAULT 'baseline'::text NOT NULL,
    persona text DEFAULT 'engaged_beginner'::text NOT NULL,
    enable_grading boolean DEFAULT false NOT NULL,
    max_turns integer,
    status text DEFAULT 'running'::text NOT NULL,
    pid integer,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    exit_code integer,
    error text,
    log_text text DEFAULT ''::text NOT NULL,
    created_date timestamp with time zone DEFAULT now(),
    result jsonb,
    CONSTRAINT eval_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);

ALTER TABLE public.eval_runs OWNER TO postgres;

--
-- Name: eval_runs_locks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.eval_runs_locks (
    scope_key text NOT NULL,
    job_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.eval_runs_locks OWNER TO postgres;

--
-- Name: generated_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.generated_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gcs_url text NOT NULL,
    gcs_blob_name text NOT NULL,
    topic text,
    description text,
    style text,
    full_prompt text,
    capsule_name text,
    created_date timestamp with time zone DEFAULT now(),
    learning_session_message_id uuid
);

ALTER TABLE public.generated_images OWNER TO postgres;

--
-- Name: learning_session_feedback; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learning_session_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learning_session_id uuid,
    user_id uuid NOT NULL,
    student_id text NOT NULL,
    sentiment text NOT NULL,
    comment text,
    message_index integer NOT NULL,
    message_text text,
    context_messages jsonb,
    execution_snapshot jsonb,
    session_stats jsonb,
    created_date timestamp with time zone DEFAULT now(),
    CONSTRAINT session_feedback_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'negative'::text, 'idea'::text, 'question'::text])))
);

ALTER TABLE public.learning_session_feedback OWNER TO postgres;

--
-- Name: learning_session_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learning_session_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learning_session_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_date timestamp with time zone DEFAULT now(),
    prompt_id text,
    template_hash text,
    model text
);

ALTER TABLE public.learning_session_messages OWNER TO postgres;

--
-- Name: learning_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learning_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    student_id text NOT NULL,
    curriculum_capsule_id uuid,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    duration_seconds integer,
    questions_asked integer DEFAULT 0,
    correct_answers integer DEFAULT 0,
    total_tokens integer DEFAULT 0,
    facts_taught_count integer DEFAULT 0,
    accuracy numeric(5,2),
    execution_log jsonb DEFAULT '[]'::jsonb,
    fact_interactions jsonb DEFAULT '[]'::jsonb,
    system_log jsonb DEFAULT '[]'::jsonb,
    tutor_id uuid NOT NULL
);

ALTER TABLE public.learning_sessions OWNER TO postgres;

--
-- Name: learning_system_schemas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learning_system_schemas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    descision_tree jsonb,
    create_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.learning_system_schemas OWNER TO postgres;

--
-- Name: pedagogy_eval_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pedagogy_eval_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id text NOT NULL,
    session_id uuid,
    capsule_id uuid,
    fixture_set text,
    rubric_version integer NOT NULL,
    dimension text NOT NULL,
    judge_name text NOT NULL,
    judge_family text,
    judge_provider text,
    judge_model text,
    score integer,
    score_norm real,
    flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    fell_back boolean DEFAULT false NOT NULL,
    reasoning text,
    template_hash text,
    model_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.pedagogy_eval_runs OWNER TO postgres;

--
-- Name: pedagogy_eval_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pedagogy_eval_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id text NOT NULL,
    session_id uuid,
    capsule_id uuid,
    fixture_set text,
    rubric_version integer NOT NULL,
    pedagogy_quality real,
    consensus_variance real,
    p50_latency_ms integer,
    tokens_per_turn real,
    total_turns integer,
    session_completion text,
    forfeit_rate real,
    decision text,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    template_hash text,
    model_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.pedagogy_eval_sessions OWNER TO postgres;

--
-- Name: placement_questions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.placement_questions (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT placement_questions_2_id_not_null NOT NULL,
    subject_id uuid CONSTRAINT placement_questions_2_subject_id_not_null NOT NULL,
    curriculum_theme_id uuid,
    phase integer CONSTRAINT placement_questions_2_phase_not_null NOT NULL,
    question_code character varying(50) CONSTRAINT placement_questions_2_question_code_not_null NOT NULL,
    display_order integer CONSTRAINT placement_questions_2_display_order_not_null NOT NULL,
    max_time_seconds integer DEFAULT 300 CONSTRAINT placement_questions_2_max_time_seconds_not_null NOT NULL,
    question_data jsonb CONSTRAINT placement_questions_2_question_data_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.placement_questions OWNER TO postgres;

--
-- Name: placement_questions_broken; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.placement_questions_broken (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT placement_questions_id_not_null NOT NULL,
    subject_id uuid CONSTRAINT placement_questions_subject_id_not_null NOT NULL,
    curriculum_theme_id uuid,
    phase integer CONSTRAINT placement_questions_phase_not_null NOT NULL,
    question_code character varying(50) CONSTRAINT placement_questions_question_code_not_null NOT NULL,
    display_order integer CONSTRAINT placement_questions_display_order_not_null NOT NULL,
    max_time_seconds integer DEFAULT 300 CONSTRAINT placement_questions_max_time_seconds_not_null NOT NULL,
    question_data jsonb CONSTRAINT placement_questions_question_data_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.placement_questions_broken OWNER TO postgres;

--
-- Name: prompt_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.prompt_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schema_id uuid NOT NULL,
    schema_name text,
    prompt_id text NOT NULL,
    content text NOT NULL,
    content_hash text NOT NULL,
    author text,
    source text DEFAULT 'manual'::text NOT NULL,
    note text,
    parent_version_id uuid,
    is_live boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT prompt_versions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'automated'::text, 'rollback'::text, 'import'::text])))
);

ALTER TABLE public.prompt_versions OWNER TO postgres;

--
-- Name: quest_prompts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quest_prompts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    quest_id uuid NOT NULL,
    prompt_text jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.quest_prompts OWNER TO postgres;

--
-- Name: quests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title jsonb NOT NULL,
    description jsonb NOT NULL,
    icon character varying(50) NOT NULL,
    color character varying(100) NOT NULL,
    bg_color character varying(100) NOT NULL,
    border_color character varying(100) NOT NULL,
    href character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    assistant_id character varying(255),
    voice_prompt text,
    voice character varying(50) DEFAULT 'eve'::character varying
);

ALTER TABLE public.quests OWNER TO postgres;

--
-- Name: scheduled_maintenance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.scheduled_maintenance (
    id integer NOT NULL,
    start_date time with time zone NOT NULL,
    end_date time with time zone NOT NULL
);

ALTER TABLE public.scheduled_maintenance OWNER TO postgres;

--
-- Name: student_assessments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id text NOT NULL,
    subject_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status character varying(20) DEFAULT 'in_progress'::character varying NOT NULL,
    assessment_data jsonb NOT NULL,
    assigned_phase integer,
    total_score integer,
    max_score integer,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.student_assessments OWNER TO postgres;

--
-- Name: students; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.students (
    student_id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id uuid NOT NULL,
    created_date timestamp with time zone DEFAULT now(),
    last_session timestamp with time zone,
    total_credits numeric(8,2) DEFAULT 0,
    report_card jsonb DEFAULT '{}'::jsonb,
    placement_data jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.students OWNER TO postgres;

--
-- Name: subject_curriculum; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subject_curriculum (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    phase integer NOT NULL,
    age_range text,
    created_date timestamp with time zone DEFAULT now()
);

ALTER TABLE public.subject_curriculum OWNER TO postgres;

--
-- Name: subjects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.subjects OWNER TO postgres;

--
-- Name: terms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    terms text,
    created_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.terms OWNER TO postgres;

--
-- Name: terms_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.terms_users (
    user_id uuid NOT NULL,
    term_id uuid NOT NULL,
    agreement_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE public.terms_users OWNER TO postgres;

--
-- Name: tutors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tutors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona jsonb,
    create_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.tutors OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    display_name text,
    role text DEFAULT 'tester'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone,
    first_name text,
    last_name text,
    dob date
);

ALTER TABLE public.users OWNER TO postgres;

--
-- Name: v_engagement_events; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_engagement_events AS
 WITH base AS (
         SELECT s.id AS session_id,
            s.student_id,
            s.start_time,
            COALESCE(NULLIF(TRIM(BOTH FROM concat_ws(' '::text, u.first_name, u.last_name)), ''::text), s.student_id) AS student_name,
            u.dob,
            sub.name AS subject,
            (t.persona ->> 'tutor_name'::text) AS tutor,
            s.execution_log,
            s.system_log
           FROM (((((((public.learning_sessions s
             LEFT JOIN public.students st ON ((st.student_id = s.student_id)))
             LEFT JOIN public.users u ON ((u.id = st.user_id)))
             LEFT JOIN public.curriculum_capsules cc ON ((cc.id = s.curriculum_capsule_id)))
             LEFT JOIN public.curriculum_themes ct ON ((ct.id = cc.curriculum_theme_id)))
             LEFT JOIN public.subject_curriculum sc ON ((sc.id = ct.subject_curriculum_id)))
             LEFT JOIN public.subjects sub ON ((sub.id = sc.subject_id)))
             LEFT JOIN public.tutors t ON ((t.id = s.tutor_id)))
        ), raw AS (
         SELECT b.session_id,
            b.student_id,
            b.student_name,
            b.dob,
            b.subject,
            b.tutor,
            b.start_time,
            e.elem AS d,
            e.ord,
            'exec'::text AS src
           FROM (base b
             CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                    WHEN (jsonb_typeof(b.execution_log) = 'array'::text) THEN b.execution_log
                    ELSE '[]'::jsonb
                END) WITH ORDINALITY e(elem, ord))
        UNION ALL
         SELECT b.session_id,
            b.student_id,
            b.student_name,
            b.dob,
            b.subject,
            b.tutor,
            b.start_time,
            e.elem AS d,
            e.ord,
            'sys'::text AS src
           FROM (base b
             CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                    WHEN (jsonb_typeof(b.system_log) = 'array'::text) THEN b.system_log
                    ELSE '[]'::jsonb
                END) WITH ORDINALITY e(elem, ord))
        )
 SELECT session_id,
    student_id,
    student_name,
    subject,
    tutor,
        CASE
            WHEN (dob IS NULL) THEN 'unknown'::text
            WHEN (EXTRACT(year FROM age((dob)::timestamp with time zone)) < (11)::numeric) THEN '8-10'::text
            WHEN (EXTRACT(year FROM age((dob)::timestamp with time zone)) < (14)::numeric) THEN '11-13'::text
            WHEN (EXTRACT(year FROM age((dob)::timestamp with time zone)) < (16)::numeric) THEN '14-15'::text
            ELSE '16-18'::text
        END AS age_band,
    src,
    ord,
    COALESCE((d ->> 'step'::text), (d ->> 'event'::text)) AS step,
    (COALESCE((d ->> 'timestamp'::text), (d ->> 'ts'::text)))::timestamp with time zone AS ts,
    ((d -> 'details'::text) ->> 'intent'::text) AS intent,
    (((d -> 'details'::text) ->> 'hit'::text))::boolean AS hit,
    COALESCE(((d -> 'details'::text) ->> 'fact'::text), (d ->> 'fact_discussed'::text)) AS fact,
    ((d -> 'details'::text) ->> 'subtype'::text) AS subtype,
    COALESCE(((d -> 'details'::text) ->> 'phase'::text), ((d -> 'details'::text) ->> 'from_phase'::text), (d ->> 'step_from'::text)) AS phase,
    ((d -> 'details'::text) ->> 'action'::text) AS action,
    ((d -> 'details'::text) ->> 'strikeout_fact'::text) AS strikeout_fact,
    COALESCE(((d -> 'details'::text) ->> 'interaction_type'::text), (d ->> 'interaction_type'::text)) AS interaction_type,
    (((d -> 'details'::text) ->> 'latency_ms'::text))::numeric AS latency_ms,
    start_time
   FROM raw;

ALTER VIEW public.v_engagement_events OWNER TO postgres;

--
-- Data for Name: hypertable; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: bgw_job; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: chunk; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: chunk_column_stats; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: compression_chunk_size; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: compression_settings; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: continuous_agg; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: continuous_aggs_bucket_function; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: continuous_aggs_hypertable_invalidation_log; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: continuous_aggs_invalidation_threshold; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: continuous_aggs_jobs_refresh_ranges; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: continuous_aggs_materialization_invalidation_log; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: continuous_aggs_materialization_ranges; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: continuous_aggs_watermark; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: dimension; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: dimension_slice; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: metadata; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: tablespace; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

--
-- Data for Name: auth_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: curriculum_audit; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: curriculum_capsules; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: curriculum_fact_distillations; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: curriculum_fact_images; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: curriculum_facts; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: curriculum_themes; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: eval_runs; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: eval_runs_locks; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: generated_images; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: learning_session_feedback; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: learning_session_messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: learning_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: learning_system_schemas; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: pedagogy_eval_runs; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: pedagogy_eval_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: placement_questions; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: placement_questions_broken; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: prompt_versions; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: quest_prompts; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: quests; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: scheduled_maintenance; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: student_assessments; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: students; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: subject_curriculum; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: subjects; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: terms; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: terms_users; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: tutors; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (token);

--
-- Name: curriculum_audit curriculum_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_audit
    ADD CONSTRAINT curriculum_audit_pkey PRIMARY KEY (id);

--
-- Name: curriculum_capsules curriculum_capsules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_capsules
    ADD CONSTRAINT curriculum_capsules_pkey PRIMARY KEY (id);

--
-- Name: curriculum_capsules curriculum_capsules_theme_id_capsule_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_capsules
    ADD CONSTRAINT curriculum_capsules_theme_id_capsule_order_key UNIQUE (curriculum_theme_id, capsule_order);

--
-- Name: curriculum_fact_images curriculum_fact_images_curriculum_fact_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_fact_images
    ADD CONSTRAINT curriculum_fact_images_curriculum_fact_id_key UNIQUE (curriculum_fact_id);

--
-- Name: curriculum_facts curriculum_facts_capsule_id_fact_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_facts
    ADD CONSTRAINT curriculum_facts_capsule_id_fact_order_key UNIQUE (curriculum_capsule_id, "order");

--
-- Name: curriculum_facts curriculum_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_facts
    ADD CONSTRAINT curriculum_facts_pkey PRIMARY KEY (id);

--
-- Name: curriculum_themes curriculum_themes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_themes
    ADD CONSTRAINT curriculum_themes_pkey PRIMARY KEY (id);

--
-- Name: curriculum_themes curriculum_themes_subject_curriculum_id_theme_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_themes
    ADD CONSTRAINT curriculum_themes_subject_curriculum_id_theme_order_key UNIQUE (subject_curriculum_id, theme_order);

--
-- Name: eval_runs eval_runs_job_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_job_id_key UNIQUE (job_id);

--
-- Name: eval_runs_locks eval_runs_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.eval_runs_locks
    ADD CONSTRAINT eval_runs_locks_pkey PRIMARY KEY (scope_key);

--
-- Name: eval_runs eval_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_pkey PRIMARY KEY (id);

--
-- Name: generated_images generated_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.generated_images
    ADD CONSTRAINT generated_images_pkey PRIMARY KEY (id);

--
-- Name: pedagogy_eval_runs pedagogy_eval_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedagogy_eval_runs
    ADD CONSTRAINT pedagogy_eval_runs_pkey PRIMARY KEY (id);

--
-- Name: pedagogy_eval_sessions pedagogy_eval_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedagogy_eval_sessions
    ADD CONSTRAINT pedagogy_eval_sessions_pkey PRIMARY KEY (id);

--
-- Name: learning_system_schemas pk_agent_system; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_system_schemas
    ADD CONSTRAINT pk_agent_system PRIMARY KEY (id);

--
-- Name: curriculum_fact_distillations pk_curriculum_fact_distillation; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_fact_distillations
    ADD CONSTRAINT pk_curriculum_fact_distillation PRIMARY KEY (id);

--
-- Name: curriculum_fact_images pk_curriculum_fact_image; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_fact_images
    ADD CONSTRAINT pk_curriculum_fact_image PRIMARY KEY (id);

--
-- Name: scheduled_maintenance pk_scheduled_maintenance; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_maintenance
    ADD CONSTRAINT pk_scheduled_maintenance PRIMARY KEY (id);

--
-- Name: terms pk_terms; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.terms
    ADD CONSTRAINT pk_terms PRIMARY KEY (id);

--
-- Name: terms_users pk_terms_users; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.terms_users
    ADD CONSTRAINT pk_terms_users PRIMARY KEY (user_id, term_id);

--
-- Name: tutors pk_tutor; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tutors
    ADD CONSTRAINT pk_tutor PRIMARY KEY (id);

--
-- Name: placement_questions placement_questions_2_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.placement_questions
    ADD CONSTRAINT placement_questions_2_pkey PRIMARY KEY (id);

--
-- Name: placement_questions_broken placement_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.placement_questions_broken
    ADD CONSTRAINT placement_questions_pkey PRIMARY KEY (id);

--
-- Name: placement_questions_broken placement_questions_question_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.placement_questions_broken
    ADD CONSTRAINT placement_questions_question_code_key UNIQUE (question_code);

--
-- Name: prompt_versions prompt_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_pkey PRIMARY KEY (id);

--
-- Name: quest_prompts quest_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quest_prompts
    ADD CONSTRAINT quest_prompts_pkey PRIMARY KEY (id);

--
-- Name: quests quests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quests
    ADD CONSTRAINT quests_pkey PRIMARY KEY (id);

--
-- Name: learning_session_feedback session_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_session_feedback
    ADD CONSTRAINT session_feedback_pkey PRIMARY KEY (id);

--
-- Name: learning_session_messages session_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_session_messages
    ADD CONSTRAINT session_messages_pkey PRIMARY KEY (id);

--
-- Name: learning_sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

--
-- Name: student_assessments student_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessments
    ADD CONSTRAINT student_assessments_pkey PRIMARY KEY (id);

--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (student_id);

--
-- Name: subject_curriculum subject_curriculum_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_curriculum
    ADD CONSTRAINT subject_curriculum_pkey PRIMARY KEY (id);

--
-- Name: subject_curriculum subject_curriculum_subject_id_phase_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_curriculum
    ADD CONSTRAINT subject_curriculum_subject_id_phase_key UNIQUE (subject_id, phase);

--
-- Name: subjects subjects_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_name_key UNIQUE (name);

--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);

--
-- Name: users users_new_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_new_email_key UNIQUE (email);

--
-- Name: users users_new_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_new_pkey PRIMARY KEY (id);

--
-- Name: idx_auth_sessions_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_auth_sessions_expires ON public.auth_sessions USING btree (expires_at);

--
-- Name: idx_capsules_has_metaphor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_capsules_has_metaphor ON public.curriculum_capsules USING btree (((meta_data ? 'metaphor'::text)));

--
-- Name: idx_capsules_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_capsules_name ON public.curriculum_capsules USING btree (name);

--
-- Name: idx_capsules_theme; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_capsules_theme ON public.curriculum_capsules USING btree (curriculum_theme_id);

--
-- Name: idx_curriculum_fact_distillations_fact_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_curriculum_fact_distillations_fact_id ON public.curriculum_fact_distillations USING btree (curriculum_fact_id);

--
-- Name: idx_curriculum_fact_images_fact_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_curriculum_fact_images_fact_id ON public.curriculum_fact_images USING btree (curriculum_fact_id);

--
-- Name: idx_eval_runs_locks_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_eval_runs_locks_created_at ON public.eval_runs_locks USING btree (created_at);

--
-- Name: idx_eval_runs_started; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_eval_runs_started ON public.eval_runs USING btree (started_at DESC);

--
-- Name: idx_eval_runs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_eval_runs_status ON public.eval_runs USING btree (status);

--
-- Name: idx_facts_capsule; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facts_capsule ON public.curriculum_facts USING btree (curriculum_capsule_id);

--
-- Name: idx_feedback_sentiment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_feedback_sentiment ON public.learning_session_feedback USING btree (sentiment);

--
-- Name: idx_feedback_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_feedback_session ON public.learning_session_feedback USING btree (learning_session_id);

--
-- Name: idx_feedback_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_feedback_user ON public.learning_session_feedback USING btree (user_id);

--
-- Name: idx_generated_images_capsule; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_generated_images_capsule ON public.generated_images USING btree (capsule_name);

--
-- Name: idx_generated_images_message_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_generated_images_message_id ON public.generated_images USING btree (learning_session_message_id);

--
-- Name: idx_lsm_template_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lsm_template_hash ON public.learning_session_messages USING btree (template_hash);

--
-- Name: idx_pedagogy_runs_dim; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_runs_dim ON public.pedagogy_eval_runs USING btree (rubric_version, fixture_set, dimension);

--
-- Name: idx_pedagogy_runs_fixture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_runs_fixture ON public.pedagogy_eval_runs USING btree (fixture_set);

--
-- Name: idx_pedagogy_runs_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_runs_run ON public.pedagogy_eval_runs USING btree (run_id);

--
-- Name: idx_pedagogy_runs_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_runs_session ON public.pedagogy_eval_runs USING btree (session_id);

--
-- Name: idx_pedagogy_runs_template; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_runs_template ON public.pedagogy_eval_runs USING btree (template_hash);

--
-- Name: idx_pedagogy_sessions_fixture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_sessions_fixture ON public.pedagogy_eval_sessions USING btree (fixture_set, rubric_version);

--
-- Name: idx_pedagogy_sessions_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_sessions_run ON public.pedagogy_eval_sessions USING btree (run_id);

--
-- Name: idx_pedagogy_sessions_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_sessions_session ON public.pedagogy_eval_sessions USING btree (session_id);

--
-- Name: idx_pedagogy_sessions_template; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedagogy_sessions_template ON public.pedagogy_eval_sessions USING btree (template_hash);

--
-- Name: idx_placement_questions_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_placement_questions_order ON public.placement_questions_broken USING btree (subject_id, display_order);

--
-- Name: idx_placement_questions_phase; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_placement_questions_phase ON public.placement_questions_broken USING btree (phase);

--
-- Name: idx_placement_questions_subject; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_placement_questions_subject ON public.placement_questions_broken USING btree (subject_id);

--
-- Name: idx_placement_questions_theme; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_placement_questions_theme ON public.placement_questions_broken USING btree (curriculum_theme_id);

--
-- Name: idx_prompt_versions_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prompt_versions_hash ON public.prompt_versions USING btree (content_hash);

--
-- Name: idx_prompt_versions_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prompt_versions_lookup ON public.prompt_versions USING btree (schema_id, prompt_id, created_at DESC);

--
-- Name: idx_quest_prompts_quest; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_quest_prompts_quest ON public.quest_prompts USING btree (quest_id);

--
-- Name: idx_session_messages_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_session_messages_session ON public.learning_session_messages USING btree (learning_session_id);

--
-- Name: idx_sessions_start; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_start ON public.learning_sessions USING btree (start_time);

--
-- Name: idx_sessions_student; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_student ON public.learning_sessions USING btree (student_id);

--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_user ON public.learning_sessions USING btree (user_id);

--
-- Name: idx_student_assessments_in_progress; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_student_assessments_in_progress ON public.student_assessments USING btree (student_id, subject_id) WHERE ((status)::text = 'in_progress'::text);

--
-- Name: idx_student_assessments_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_student_assessments_status ON public.student_assessments USING btree (student_id, subject_id, status);

--
-- Name: idx_student_assessments_student; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_student_assessments_student ON public.student_assessments USING btree (student_id);

--
-- Name: idx_student_assessments_student_subject; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_student_assessments_student_subject ON public.student_assessments USING btree (student_id, subject_id);

--
-- Name: idx_student_assessments_subject; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_student_assessments_subject ON public.student_assessments USING btree (subject_id);

--
-- Name: idx_students_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_students_user ON public.students USING btree (user_id);

--
-- Name: idx_themes_curriculum; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_themes_curriculum ON public.curriculum_themes USING btree (subject_curriculum_id);

--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_email ON public.users USING btree (email);

--
-- Name: uq_prompt_versions_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_prompt_versions_live ON public.prompt_versions USING btree (schema_id, prompt_id) WHERE (is_live = true);

--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

--
-- Name: placement_questions_broken update_placement_questions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_placement_questions_updated_at BEFORE UPDATE ON public.placement_questions_broken FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: auth_sessions auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: curriculum_audit curriculum_audit_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_audit
    ADD CONSTRAINT curriculum_audit_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

--
-- Name: curriculum_capsules curriculum_capsules_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_capsules
    ADD CONSTRAINT curriculum_capsules_theme_id_fkey FOREIGN KEY (curriculum_theme_id) REFERENCES public.curriculum_themes(id);

--
-- Name: curriculum_facts curriculum_facts_capsule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_facts
    ADD CONSTRAINT curriculum_facts_capsule_id_fkey FOREIGN KEY (curriculum_capsule_id) REFERENCES public.curriculum_capsules(id);

--
-- Name: curriculum_themes curriculum_themes_subject_curriculum_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_themes
    ADD CONSTRAINT curriculum_themes_subject_curriculum_id_fkey FOREIGN KEY (subject_curriculum_id) REFERENCES public.subject_curriculum(id);

--
-- Name: curriculum_fact_distillations fk_curriculum_fact_distillation_curriculum_facts; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_fact_distillations
    ADD CONSTRAINT fk_curriculum_fact_distillation_curriculum_facts FOREIGN KEY (curriculum_fact_id) REFERENCES public.curriculum_facts(id);

--
-- Name: curriculum_fact_images fk_curriculum_fact_image_curriculum_facts; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_fact_images
    ADD CONSTRAINT fk_curriculum_fact_image_curriculum_facts FOREIGN KEY (curriculum_fact_id) REFERENCES public.curriculum_facts(id);

--
-- Name: curriculum_themes fk_curriculum_themes_learning_system_schemas; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_themes
    ADD CONSTRAINT fk_curriculum_themes_learning_system_schemas FOREIGN KEY (learning_system_id) REFERENCES public.learning_system_schemas(id);

--
-- Name: curriculum_themes fk_curriculum_themes_tutor; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curriculum_themes
    ADD CONSTRAINT fk_curriculum_themes_tutor FOREIGN KEY (tutor_id) REFERENCES public.tutors(id);

--
-- Name: terms_users fk_terms_users_terms; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.terms_users
    ADD CONSTRAINT fk_terms_users_terms FOREIGN KEY (term_id) REFERENCES public.terms(id);

--
-- Name: terms_users fk_terms_users_users; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.terms_users
    ADD CONSTRAINT fk_terms_users_users FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: generated_images generated_images_learning_session_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.generated_images
    ADD CONSTRAINT generated_images_learning_session_message_id_fkey FOREIGN KEY (learning_session_message_id) REFERENCES public.learning_session_messages(id) ON DELETE SET NULL;

--
-- Name: learning_sessions learning_sessions_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_sessions
    ADD CONSTRAINT learning_sessions_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES public.tutors(id);

--
-- Name: pedagogy_eval_runs pedagogy_eval_runs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedagogy_eval_runs
    ADD CONSTRAINT pedagogy_eval_runs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.learning_sessions(id) ON DELETE CASCADE;

--
-- Name: pedagogy_eval_sessions pedagogy_eval_sessions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedagogy_eval_sessions
    ADD CONSTRAINT pedagogy_eval_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.learning_sessions(id) ON DELETE CASCADE;

--
-- Name: placement_questions_broken placement_questions_curriculum_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.placement_questions_broken
    ADD CONSTRAINT placement_questions_curriculum_theme_id_fkey FOREIGN KEY (curriculum_theme_id) REFERENCES public.curriculum_themes(id) ON DELETE SET NULL;

--
-- Name: placement_questions_broken placement_questions_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.placement_questions_broken
    ADD CONSTRAINT placement_questions_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;

--
-- Name: prompt_versions prompt_versions_parent_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_parent_version_id_fkey FOREIGN KEY (parent_version_id) REFERENCES public.prompt_versions(id);

--
-- Name: quest_prompts quest_prompts_quest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quest_prompts
    ADD CONSTRAINT quest_prompts_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.quests(id) ON DELETE CASCADE;

--
-- Name: learning_session_feedback session_feedback_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_session_feedback
    ADD CONSTRAINT session_feedback_session_id_fkey FOREIGN KEY (learning_session_id) REFERENCES public.learning_sessions(id) ON DELETE SET NULL;

--
-- Name: learning_session_feedback session_feedback_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_session_feedback
    ADD CONSTRAINT session_feedback_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);

--
-- Name: learning_session_feedback session_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_session_feedback
    ADD CONSTRAINT session_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: learning_session_messages session_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_session_messages
    ADD CONSTRAINT session_messages_session_id_fkey FOREIGN KEY (learning_session_id) REFERENCES public.learning_sessions(id);

--
-- Name: learning_sessions sessions_capsule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_sessions
    ADD CONSTRAINT sessions_capsule_id_fkey FOREIGN KEY (curriculum_capsule_id) REFERENCES public.curriculum_capsules(id);

--
-- Name: learning_sessions sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_sessions
    ADD CONSTRAINT sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);

--
-- Name: learning_sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: student_assessments student_assessments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessments
    ADD CONSTRAINT student_assessments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE;

--
-- Name: student_assessments student_assessments_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessments
    ADD CONSTRAINT student_assessments_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;

--
-- Name: students students_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: subject_curriculum subject_curriculum_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_curriculum
    ADD CONSTRAINT subject_curriculum_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id);

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;

--
-- PostgreSQL database dump complete
--

