# ZingBee Ultra

An AI-powered tutoring platform with adaptive learning, multi-subject curriculum delivery,
voice integration, and student progress tracking. Built with FastAPI, Next.js,
PostgreSQL/TimescaleDB, and LiveKit.

---

## About this package

This is a **sanitized source distribution** prepared for external review. It contains the
application source code, configuration templates, and documentation — but no credentials,
no production data, and no deployment infrastructure.

**Removed before packaging:**

| Removed | Why |
|---|---|
| All `.env` files (except `api/.env.example`) | Live API keys and database passwords |
| TLS certificates and private keys | Credentials |
| Database backups (`db/*backup*.sql`) | Contained real student records, transcripts, and password hashes |
| Production data extracts and investigation reports | Personally identifiable information |
| CI/CD pipelines, cloud deploy scripts, production compose/proxy configs | Internal infrastructure |
| AI coding-assistant tooling (agent/skill definitions, editor config) | Development tooling, not part of the application |
| Internal engineering reports, issue-tracker exports, and working drafts | Internal business material |
| Git history (`.git`) | Would reintroduce all of the above |
| The `zingbee-home` marketing client | Out of scope for this distribution |

Every credential-shaped value that remains in a config file is a **placeholder**. Search for
`REPLACE_WITH_` to find the ones that must be filled in.

**Database:** `db/schema.sql` is the complete base schema — every table, column, constraint,
index, view and trigger — as a structure-only dump carrying **no application data**. The
diagram and a full table-by-table reference are in
[`docs/database-schema.md`](docs/database-schema.md). The nightly `pg_dump` backups that used
to carry both structure and data are *not* included, so a fresh install starts with an empty
but fully-formed database. See [Database setup](#4-database-setup).

---

## Table of Contents

- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Frontend clients](#frontend-clients)
- [API layer](#api-layer)
- [Database schema](#database-schema)
- [Curriculum system](#curriculum-system)
- [Session Engine v6](#session-engine-v6)
- [Classification and assessment](#classification-and-assessment)
- [Prompt engine](#prompt-engine)
- [Voice integration](#voice-integration)

---

## Architecture

```
ZingBee Ultra
|
|-- Frontend Tier (Next.js 16 + Radix UI + Tailwind CSS)
|   |-- Academy Tutor     (port 3001) -- Student learning platform
|   |-- Red Team Studio   (port 3000) -- Safety evaluation & curriculum tools
|   |-- Admin Dashboard   (port 3002) -- Monitoring & management
|
|-- API Layer (FastAPI @ port 9000)
|   |-- Route modules (students, assessments, curriculum, quests, eval, ...)
|   |-- Session Engine v6 (state machine for tutoring sessions)
|   |-- Classifier + Assessor (two-stage student response analysis)
|   |-- Prompt Engine (template rendering per state/phase)
|   |-- Auth system (bcrypt + 30-day session tokens)
|   |-- LiveKit voice agent (Realtime API bridge)
|
|-- Data Tier
|   |-- PostgreSQL 16+ / TimescaleDB (database: zingbee-ultra)
|   |-- Generated media (image-generation API output)
|
|-- Local orchestration (pipelines/)
    |-- docker-compose.yml -- PostgreSQL + API + 3 clients + Caddy
    |-- Caddyfile          -- local subdomain routing
    |-- livekit.yaml       -- LiveKit voice server config
```

**Request flow:** Browser → Caddy (subdomain routing) → Next.js client *or* FastAPI API → PostgreSQL

---

## Project structure

```
zingbee-ultra/
|
|-- api/                          # FastAPI backend
|   |-- web_ui.py                 # Entry point, FastAPI app, uvicorn server
|   |-- db.py                     # Central database access layer
|   |-- auth.py                   # get_auth_user(), session management
|   |-- llm.py                    # LLM integration
|   |-- session_engine.py         # v6 tutoring state machine
|   |-- classifier.py             # Pre-LLM student message classification
|   |-- assessor.py               # Post-interaction assessment
|   |-- prompt_engine.py          # Prompt template rendering
|   |-- state_machine/            # zsm-v006.json — the canonical state contract
|   |-- *_routes.py               # Route modules (see API layer below)
|   |-- livekit/                  # Voice agent + voice endpoints
|   |-- tests/                    # pytest suite (incl. state machine contract test)
|   |-- requirements.txt
|   |-- Dockerfile
|   |-- .env.example              # Copy to .env and fill in
|
|-- clients/                      # Frontend applications
|   |-- academy/                  # Student platform (port 3001)
|   |-- red-team/                 # Red Team Studio (port 3000)
|   |-- admin/                    # Admin Dashboard (port 3002)
|   |-- shared/                   # Shared components/utilities
|
|-- db/                           # Database schema and migrations
|   |-- schema.sql                # Base schema — structure only, no data
|   |-- 0XX_*.sql                 # Incremental schema changes
|   |-- migrations/               # Numbered migrations + conventions README
|
|-- docs/                         # Design docs, contracts, plans, legal
|   |-- database-schema.md        # ER diagrams + full table reference
|   |-- contracts/REGISTRY.md     # Index of system contracts
|
|-- tools/                        # Python utility modules
|-- scripts/                      # Maintenance and data-fix scripts
|-- pipelines/                    # Local dev orchestration (Docker, Caddy, LiveKit)
|-- run-dev.sh                    # Dev environment launcher
```

---

## Getting started

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- Python 3.12+
- PostgreSQL 16+ (or use the bundled Docker service)

### 1. Configure environment variables

```bash
cp api/.env.example api/.env
```

Then fill in `api/.env`. At minimum you need a database password and at least one LLM provider
key. `.env.example` documents every supported variable, including feature flags. Nothing in the
repository ships with a working key — all values must be supplied by you.

Key groups:

| Group | Variables |
|---|---|
| AI / LLM | `XAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` |
| Local models (optional) | `LOCAL_MODEL_ENABLED`, `VLLM_*` |
| Database | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Voice | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Security | `TURNSTILE_SECRET_KEY` (leave unset to disable bot verification locally) |

The frontend clients read `NEXT_PUBLIC_API_URL`. For local development create
`clients/<client>/.env.local` containing:

```
NEXT_PUBLIC_API_URL=http://localhost:9000
```

Several Quests components read `process.env.NEXT_PUBLIC_API_URL` directly with no fallback,
so omitting this produces `undefined/...` request URLs.

### 2. Configure LiveKit (only if you want voice)

`pipelines/livekit.yaml` ships with placeholder credentials:

```yaml
keys:
  REPLACE_WITH_LIVEKIT_API_KEY: REPLACE_WITH_LIVEKIT_API_SECRET
```

Generate your own key/secret pair, substitute both, and mirror them into `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET` in `api/.env`. The rest of the platform runs fine without this.

### 3. Start the stack

```bash
./run-dev.sh              # PostgreSQL + API + LiveKit agent + all 3 clients
./run-dev.sh api          # API only
./run-dev.sh academy # One client only
./run-dev.sh stop         # Stop everything
```

Or with Docker Compose directly:

```bash
docker compose -f pipelines/docker-compose.yml up
```

### 4. Database setup

Create the database and apply the schema, then the migrations:

```bash
createdb zingbee-ultra

# 1. Base schema — 35 tables, 33 foreign keys, 1 view. No data.
psql -d zingbee-ultra -v ON_ERROR_STOP=1 -f db/schema.sql

# 2. Migrations — all idempotent, safe to re-run in any order
for f in db/migrations/00*.sql db/0*.sql db/migrate-*.sql; do
  psql -d zingbee-ultra -v ON_ERROR_STOP=1 -f "$f"
done
```

`db/schema.sql` already contains everything the numbered `db/0XX_*.sql` migrations create, so
those are no-ops on a fresh install. `db/migrations/001`–`003` do add new objects: the
`prompt_overrides` table and the isolated `quests` schema. Required extensions are
`pg_trgm`, `pgcrypto` and `uuid-ossp`.

The schema and every diagram are documented in
[`docs/database-schema.md`](docs/database-schema.md).

The database now has structure but no content — no curriculum, no prompt templates, no tutor
personas. The tutoring engine renders its prompts from a `prompt_registry` stored in
`learning_system_schemas`, so it needs seeding before a session will run; the
`scripts/apply_*_prompts.py` helpers show the expected shape.

`run-dev.sh` also looks for a `db/*backup*.sql` file to restore. None is included here — the
script detects that, prints a notice, and applies the migrations only. If you supply your own
dump, restore behaviour is controlled by `RESTORE_DB`:

| Value | Behaviour |
|---|---|
| `auto` (default) | Restore only if the database is empty; keep existing data |
| `force` | Drop the schema and reload from the newest `db/` backup |
| `skip` | Never drop/restore; only apply idempotent migrations |

Migration conventions and the `prompt_overrides` scoping rules are documented in
`db/migrations/README.md`.

### Local URLs

| Service | URL |
|---|---|
| Red Team Studio | http://localhost:3000 or http://redteam.localhost/ |
| Academy Tutor | http://localhost:3001 or http://academy.localhost/ |
| Admin Dashboard | http://localhost:3002 or http://admin.localhost/ |
| API | http://localhost:9000 or http://api.localhost/ |

The `.localhost` subdomains require the Caddy service from `pipelines/docker-compose.yml`.

---

## Frontend clients

All clients use **Next.js 16**, **Radix UI**, **Tailwind CSS**, and **TypeScript**.

### Academy Tutor (`clients/academy/` — port 3001)

Student-facing learning platform with tutoring, assessment, and quest systems.
Features multi-language i18n, the Vercel AI SDK, and React Hook Form.

| Route | Purpose |
|---|---|
| `/tutors/dashboard` | Student overview |
| `/tutors/assessment` | Placement assessment interface |
| `/tutors/learning` | Active learning modules |
| `/tutors/practice` | Practice problems |
| `/tutors/study-session` | Active study sessions |
| `/tutors/subject-room` | Subject-specific pages |
| `/tutors/themes` | Curriculum theme browser |
| `/quests/my-projects` | Student quest projects |
| `/quests/[id]/chat` | Project chat |
| `/quests/achievements` | Achievement tracking |
| `/login` | Authentication |

### Red Team Studio (`clients/red-team/` — port 3000)

Internal tool for AI safety testing, curriculum management, and model evaluation.
Uses Monaco editor, D3, Dagre, ElkJS, html2canvas, KaTeX, marked, and LiveKit React.

| Route | Purpose |
|---|---|
| `/curriculum-builder` | Curriculum creation and editing |
| `/prompt-playground` | Prompt engineering interface |
| `/evals` | Model evaluation dashboard |
| `/image-eval` | Image generation evaluation |
| `/audits` | Audit logs and analysis |
| `/learning-system` | Learning system configuration |
| `/sessions` | Session management and replay |
| `/admin` | Admin controls |

### Admin Dashboard (`clients/admin/` — port 3002)

Management console for students, sessions, models, and analytics. Includes knowledge-graph
visualization, a pipeline canvas, A/B test configuration panels, and conversation
effectiveness tracking.

| Route | Purpose |
|---|---|
| `/students` · `/users` · `/schools` | Entity management |
| `/sessions` · `/chats` | Session analytics and chat logs |
| `/models` · `/pipelines` | Model management and ML pipeline config |
| `/problems` · `/reports` · `/insights` | Problem tracking, reporting, analytics |

---

## API layer

FastAPI backend on port 9000. Entry point:

```bash
python api/web_ui.py --port 9000 --host 0.0.0.0
```

### Route modules

| Module | Prefix | Purpose |
|---|---|---|
| `student_routes.py` | `/api/students` | Sessions, status, report cards, feedback, greetings |
| `session_routes.py` | `/api/sessions` | Session list, detail, delete |
| `assessment_routes.py` | `/api/assessment` | Placement assessments: start, resume, submit, progress |
| `curriculum_routes.py` | `/api/curriculum` | Curriculum building, audits, exports, capsule facts |
| `academy_routes.py` | `/api/academy` | Subject/theme/capsule browsing for students |
| `quest_routes.py` | `/api/quests` | Quest CRUD with i18n support |
| `playground_routes.py` | `/api/playground` | Prompt testing, model selection, learning system config |
| `eval_routes.py` | `/api/eval` | Model evaluation job/run management |
| `image_eval_routes.py` | `/api/image-eval` | Image evaluation: variants, regeneration, reviews |
| `admin_routes.py` | `/api/admin` | Table CRUD, hierarchy inspection, dashboard stats |

### Core modules

| Module | Purpose |
|---|---|
| `db.py` | Central PostgreSQL access (psycopg2, `RealDictCursor`) |
| `auth.py` | `get_auth_user()`, `verify_student_ownership()`, 30-day session expiry |
| `session_engine.py` | v6 state machine for tutoring sessions |
| `classifier.py` | Two-stage student message classification (skip rules + LLM) |
| `assessor.py` | Post-interaction assessment and compliance checking |
| `prompt_engine.py` | Template rendering with `$variable` interpolation |
| `llm.py` | LLM provider integration |
| `report_card_utils.py` | Student performance aggregation and reporting |

---

## Database schema

PostgreSQL 16+. IDs are UUIDs (`gen_random_uuid`); timestamps are UTC with timezone.

> **Full reference:** [`docs/database-schema.md`](docs/database-schema.md) has entity-relationship
> diagrams (whole-system and per-domain) plus every column, type, default, key and index for all
> 35 tables. The executable schema is [`db/schema.sql`](db/schema.sql). What follows is a summary
> of the tables you will touch most.

### Users and students

| Table | Key columns |
|---|---|
| `users` | `id` (uuid), `email`, `password_hash`, `display_name`, `role`, `is_active`, `created_at`, `last_login`, `first_name`, `last_name`, `dob` |
| `students` | **`student_id` (text PK)**, `user_id` (uuid FK), `created_date`, `last_session`, `total_credits`, `report_card` (JSONB), `placement_data` (JSONB) |

`students` uses a **text** primary key named `student_id`, not a uuid `id`.
`learning_sessions.student_id` and `student_assessments.student_id` are also text and join
against it.

### Sessions and assessments

| Table | Key columns |
|---|---|
| `learning_sessions` | `id`, `user_id`, `student_id`, `curriculum_capsule_id`, `tutor_id`, `start_time`, `end_time`, `duration_seconds`, `questions_asked`, `correct_answers`, `accuracy`, `facts_taught_count`, `total_tokens`, `execution_log` (JSONB), `fact_interactions` (JSONB), `system_log` (JSONB) |
| `learning_session_messages` | `id`, `learning_session_id`, `role`, `content`, `created_date`, `prompt_id`, `template_hash`, `model` |
| `student_assessments` | `id`, `student_id`, `subject_id`, `started_at`, `completed_at`, `status`, `assessment_data` (JSONB), `assigned_phase`, `total_score`, `max_score` |

### Curriculum

| Table | Key columns |
|---|---|
| `subjects` | `id`, `name`, `description` |
| `subject_curriculum` | `id`, `subject_id`, `phase` (1–5), `age_range` |
| `curriculum_themes` | `id`, `subject_curriculum_id`, `theme_order`, **`name`** (the guiding question), `description`, `tutor_id`, `learning_system_id` |
| `curriculum_capsules` | `id`, `curriculum_theme_id`, `capsule_order`, `name`, `meta_data` (JSONB) |
| `curriculum_facts` | `id`, `curriculum_capsule_id`, `"order"` (reserved word — must be quoted), `meta_data` (JSONB) |
| `curriculum_fact_distillations` | `id`, `curriculum_fact_id`, `meta_data` (`jsonb[]`) |
| `curriculum_fact_images` | `id`, `curriculum_fact_id`, `meta_data` (`jsonb[]`) |
| `curriculum_audit` | `id`, `title`, `description`, `audit_date`, `content`, counts, `health_score`, `data` (JSONB) |
| `tutors` | `id`, `persona` (JSONB), `create_date` |

Tutor identity lives entirely inside the `persona` JSONB column — there is no top-level
`tutor_name` column. Query it with `persona ->> 'tutor_name'`.

### Report card structure (JSONB on `students`)

```
{
  <subject_id>: {
    <phase>: {
      <theme_id>: {
        <capsule_id>: {
          status, completed_at, mastery_level, credits,
          facts: {
            <fact_id>: {
              is_taught, is_assessed, is_mastered,
              exposure_count, correct_count, incorrect_count
            }
          }
        }
      }
    }
  }
}
```

---

## Curriculum system

### Hierarchy

```
Subject
  |-- Phase (1-5, with age ranges)
       |-- Theme (name acts as the guiding question; has a tutor assignment)
            |-- Capsule (ordered learning unit)
                 |-- Fact (ordered knowledge item)
                      |-- Vocabulary        (term/definition pairs)
                      |-- Processes         (learning/cognitive processes)
                      |-- Applications      (real-world uses)
                      |-- Micro-Checks      (formative assessment questions)
                      |-- Misconceptions    (common errors + corrections)
                      |-- Evidence          (observable mastery indicators)
                      |-- Stretch Questions (extension/challenge content)
```

### Subjects and tutors

| Subject | Tutor | Phases | Age range |
|---|---|---|---|
| Biology | Aris | 1–4 | 10–18 |
| Chemistry | Mendi | 1–5 | 8–18 |
| English | Lexi | 1–4 | 10–18 |
| Math | Archi | 1–4 | 10–18 |
| Physics | Newton | 1–5 | 8–18 |

Each tutor has a distinct persona in `tutors.persona` (JSONB with `tutor_name`,
`persona_traits`, `persona_description`, `creator_name`) that shapes tone and style.

### Content volume

A fully populated instance holds roughly 5 subjects, 94 themes, 500+ capsules, and 6,600+ facts,
each fact carrying all 7 enrichment types.

### Fact enrichment (`meta_data` JSONB)

```json
{
  "core_fact": "All living things are called organisms",
  "difficulty_weight": 0.3,
  "scaffold": ["TEACH", "TRY"],
  "vocabulary": [{ "term": "organism", "definition": "A living thing" }],
  "processes": ["classification", "identification"],
  "applications": ["Identifying living vs non-living in nature"],
  "micro_checks": [{ "type": "recall", "question": "What do we call all living things?" }],
  "misconceptions": [
    {
      "misconception": "Fire is alive because it grows",
      "correct_understanding": "Fire lacks cellular structure and reproduction"
    }
  ],
  "evidence": ["Can define organism and give examples"],
  "stretch_questions": ["How would you classify a virus?"]
}
```

### Curriculum endpoints

**Student-facing (`/api/academy/`)**

| Endpoint | Description |
|---|---|
| `GET /subjects` | All subjects with phases and tutors |
| `GET /subjects/{id}/phases` | Phases for a subject |
| `GET /themes?subject_id=X&phase=Y` | Themes with capsule counts |
| `GET /themes/{id}/capsules` | Capsules in a theme |
| `GET /capsules/{id}` | Full capsule with all facts |

**Admin (`/api/curriculum/`)**

| Endpoint | Description |
|---|---|
| `GET /curriculum-audits` | List quality audits |
| `GET /curriculum-audits/{id}` | Audit details with insights |
| `POST /curriculum-audits/generate` | Run a new audit |
| `GET /curriculum-export/excel` | Download the 9-sheet curriculum workbook |

The Excel export produces one sheet each for Facts, Vocabulary, Processes, Applications,
Micro Checks, Misconceptions, Capsules, Evidence, and Stretch questions.

---

## Session Engine v6

The tutoring state machine is a **versioned contract**. The canonical source is
`api/state_machine/zsm-v006.json` — states, transitions, the `interaction_type` taxonomy, and
feature-flag annotations. It is enforced by `api/tests/test_state_machine_contract.py`.

Transitions are deliberately **not** documented in prose: the contract file and its test are the
single source of truth, and both must change together. See `docs/contracts/REGISTRY.md` and
`docs/contracts/impact-assessment-template.md`.

Session-start contract validation is controlled by `SM_CONTRACT_VALIDATION` in `api/.env`
(`true` — drift is fatal, missing file warns; `strict` — both fatal; `false` — disabled).

### High-level flow

```
Session Start
  |
  v
[RECALL] (optional, returning students only)
  |
  v
For each BATCH (max 5 facts per batch):
  |   For each FACT in batch:
  |     [TEACH] --> [TRY]
  |        ^           |
  |        |- reteach -|   (on confusion / incorrect)
  v
[CHECK] (all facts in batch)
  |-- all passed --> next batch or EVIDENCE
  |-- failures  --> [CHECK_REMEDIATION] --> re-CHECK failed facts
  v
[EVIDENCE COLLECT] (all facts)
  |-- all passed --> CAPSULE_COMPLETE
  |-- failures  --> [EVIDENCE REMEDIATION] --> [EVIDENCE RETRY]
  v
[CAPSULE_COMPLETE]
```

### Phases

| Phase | Purpose |
|---|---|
| `RECALL` | Optional opening for returning students; quick recall of prior knowledge |
| `TEACH` | Initial instruction on a fact |
| `TRY` | Student applies the taught fact; tutor gives feedback and hints |
| `CHECK` | Micro-assessment of all facts in the current batch |
| `CHECK_REMEDIATION` | Targeted reteaching of facts that failed CHECK |
| `EVIDENCE` | Final comprehensive assessment across all facts in the capsule |
| `CAPSULE_COMPLETE` | Terminal state; session ends |

---

## Classification and assessment

Student messages pass through a two-stage pipeline.

### Stage 1 — Classifier (`classifier.py`, pre-LLM)

Determines student intent before the tutor LLM call. Deterministic skip rules run first:

| Pattern | Classification |
|---|---|
| Empty / whitespace / punctuation only / < 3 chars | `uninterpretable` |
| Emoji only, or yes/ok/sure/yeah | `confirmation` |
| no/nope/idk/don't know | `confusion` |
| skip/next/know already | `move_on` |

Anything else falls through to an LLM classifier (temperature 0.0, max 100 tokens) returning
`{"type": str, "reason": str}`.

### Stage 2 — Assessor (`assessor.py`, post-LLM)

Runs after the tutor response and is **authoritative over the classifier**. Stateless,
temperature 0.1, max 200 tokens.

```python
{
    "fact_discussed": str,
    "interaction_type": str,
    "student_is_confused": bool,
    "fell_into_misconception": bool,
    "used_vocabulary": "applicable" | "not_applicable",
    "tutor_compliance": {
        "tutor_is_looping": bool,
        "tutor_is_summarizing": bool,
        "tutor_asked_question_during_teach": bool,
        "tutor_missing_image": bool,
        "tutor_missing_suggestions": bool,
        "tutor_missing_acknowledgment": bool,
        "tutor_incorrect_redirect": bool,
    },
    "reason": str,
}
```

### Interaction types

`student_correct`, `student_partially_correct`, `student_incorrect`, `student_understands`,
`student_confused`, `student_move_on`, `student_question`, `teaching`, `confirmation`,
`move_on`, `off_topic`.

Which types are valid in which phase is part of the state-machine contract
(`api/state_machine/zsm-v006.json`), not free-form.

### Mismatch detection

`detect_mismatch()` flags classifier/assessor disagreement — for example, the assessor reporting
`student_question` while the tutor used redirect phrasing. This triggers a `question_correction`
or `compliance_correction` follow-up prompt.

---

## Prompt engine

`prompt_engine.py` renders prompts from a `decision_tree.prompt_registry` using `$variable`
interpolation (`string.Template.safe_substitute`). **Prompt templates live in the database, not
in this repository** — a fresh install starts with an empty registry.

| Template | Context |
|---|---|
| `system_prompt` | Full system context |
| `step_teach`, `step_teach_reteach`, `step_teach_confused`, `step_teach_confirm`, `step_teach_continue` | TEACH variants |
| `step_try`, `step_try_retry` | TRY |
| `step_check`, `step_check_remediation` | CHECK |
| `step_evidence`, `step_evidence_retry` | EVIDENCE |
| `compliance_correction`, `question_correction` | Corrections after a detected mismatch |

---

## Voice integration

LiveKit-based voice tutoring lives in `api/livekit/`.

| File | Purpose |
|---|---|
| `livekit_agent.py` | Bridge: student browser ↔ LiveKit ↔ Realtime speech API |
| `voice_routes.py` | Session tokens, room tokens, turn processing, image generation from voice |

Server configuration is in `pipelines/livekit.yaml` (WebSocket port 7880, RTC port 7881, RTC
port range 50000–60000). You must supply your own API key and secret — see
[step 2 of Getting started](#2-configure-livekit-only-if-you-want-voice).

---

## Testing

```bash
python -m pytest api/tests
```

The suite includes `test_state_machine_contract.py`, which fails if `session_engine.py` drifts
from `api/state_machine/zsm-v006.json`. Frontend type checking runs per client with
`npx tsc --noEmit`.
