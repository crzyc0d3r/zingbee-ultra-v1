# Database Migrations

## Execution (M-9)

Migrations are plain SQL files. Run them manually against the production database before
deploying API changes that depend on them. There is no automated migration runner — Alembic
or a similar tool is on the long-term roadmap.

**Standard procedure:**

```bash
# 1. Take a DB backup first (use the daily snapshot)
# 2. Connect to the database
psql -h <host> -U postgres -d zingbee-ultra

# 3. Run the migration
\i db/migrations/002_prompt_overrides_unique.sql

# 4. Verify
\d prompt_overrides
```

**Required before deploying the image-eval-loop branch:**

| Migration | Required for |
|-----------|-------------|
| `001_prompt_overrides.sql` | `prompt_overrides` table (distillation prompt optimizer) |
| `002_prompt_overrides_unique.sql` | UNIQUE partial indexes on `prompt_overrides` (concurrent-safe upsert, H-7) |

Run them in order on any fresh environment. On existing installs that already ran `001`,
only `002` is needed.

**Required before deploying the Quests restore branch:**

| Migration | Required for |
|-----------|-------------|
| `003_quest_projects_schema.sql` | Isolated `quests` schema for the Quests demo — creates `quest_projects.projects`, `quest_projects.chat_sessions`, `quest_projects.chat_messages`, `quest_projects.project_files` (plus lookup indexes) |

Fully additive and isolated: every table lives in the dedicated `quests` schema, never
`public`. There are deliberately **no cross-schema foreign keys into `public`** — `student_id`,
`quest_id`, `subject_id`, and `theme_id` are stored as bare columns, so this migration adds zero
constraints onto the Tutors learning system. `DROP SCHEMA quest_projects CASCADE` leaves the tutor
tables in `public` byte-for-byte unaffected. All statements are `IF NOT EXISTS`, so re-running is
safe/idempotent. Apply with:

```bash
docker exec -i zingbee-ultra-db-1 psql -U postgres -d zingbee-ultra \
  -v ON_ERROR_STOP=1 -f - < db/migrations/003_quest_projects_schema.sql
```

---

## scope_key Naming Convention (M-10)

The `prompt_overrides` table uses a `(scope_type, scope_key)` pair to target overrides.
Valid scope types and their expected `scope_key` values:

| scope_type | scope_key | Example |
|---|---|---|
| `global` | literal string `"global"` | Applies to all 6,600 facts across all subjects |
| `subject` | Subject name (lowercase) | `"biology"`, `"chemistry"`, `"math"` |
| `phase` | `"<subject>:<phase_number>"` | `"chemistry:3"` |
| `theme` | Theme UUID | `"a1b2c3d4-..."` — use the UUID, NOT the human-readable name |
| `capsule` | Capsule UUID | `"e5f6a7b8-..."` |
| `strategy` | Strategy name | `"direct"`, `"analogy"`, `"story"`, `"visual_verbal"`, `"socratic"` |

**Critical:** Theme and capsule `scope_key` values must be UUIDs, never display names. Display
names change; UUIDs are stable. The API enforces UUID lookup at write time via
`apply_prompt_overrides()` in `explanation_gen_service.py`.

**Blast radius reference:**

| scope_type | Approximate facts affected |
|---|---|
| `global` | ~6,600 (all) — requires human approval gate (C-4) |
| `subject` | ~1,200–1,650 |
| `phase` | ~300–500 |
| `theme` | ~60–80 |
| `capsule` | ~10–15 |
| `strategy` | Varies by scope; filters to one generation strategy only |
