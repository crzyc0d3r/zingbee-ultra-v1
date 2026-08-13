# Contract Registry & State-Machine Guardrail — Design

**Date:** 2026-06-23
**Author:** Engineering
**Status:** Approved design — pending implementation plan
**Trigger:** ADO #26 engagement changes altered the tutoring engine and "conflicted with basic premises" of the state machine; the breakage reached a state nobody validated against. Root-cause investigation revealed the state machine is one of **seven** system contracts with the same pathology, and that **CI runs no tests at all**.

---

## 1. Problem

The system has multiple **contracts** — one logical truth (the tutoring state machine, the message taxonomy, the DB schema, …) represented in two or more places that are **hand-maintained and never checked against each other**. When code on one side changes, the other representations silently drift. ADO #26 was one instance: the engine's transition handlers changed, but the versioned `decision_tree.states` graph shown in the portal and the prose tables in the root architecture doc did not — and nothing forced them to.

The investigation (2026-06-23, parallel repo sweep) found this is systemic:

| # | Contract | Representations (none cross-checked) | Evidence of live drift |
|---|---|---|---|
| 🔑 | **CI test enforcement** | `pipelines/azure-pipelines.yml` builds Docker + deploys; **no test step**; `pytest` not in `api/requirements.txt` | ~1,600 lines of existing engine tests (`api/tests/`) never run on merge/deploy |
| 1 | **State machine** | engine handlers `api/session_engine.py` `_process_*`; DB JSONB `learning_system_schemas.descision_tree.states` (`z-sm-v006.4`); the root architecture doc prose tables | engine `__init__` only reads `prompt_registry`, **never `.states`** → portal graph is decorative |
| 2 | **`interaction_type` taxonomy** | `classifier.py`, `assessor.py` `VALID_TYPES`, `session_engine.py` `if itype==` branches, the root architecture doc "Valid Types Per Phase" | engine branches on `student_wants_example`/`recall_more`/`closure_end` etc. that the assessor never emits and docs don't list; CHECK/EVIDENCE silently treat unhandled types as **FAILED** (silent mis-grading) |
| 3 | **Prompt registry** | DB `descision_tree.prompt_registry`; 4 `scripts/apply_*_prompts.py` seeds; the root architecture doc; test fixtures | `step_teach_confirm` is rendered by the engine but **seeded by no script, in no doc** → restore-before-seed leaves the tutor silently blank on misconceptions; missing `$var` renders literal `$var` to students |
| 4 | **Feature flags** | scattered `os.environ` reads via `_flag()` in `session_engine.py`/`engagement.py`; `api/.env`; (absent from `.env.example`/docs) | `TEACH_SIGNAL_FIX`, `TRY_HINT`, `ENGAGEMENT_DETERMINISTIC_CHIPS` gate **state-machine transitions**, are undocumented, prod=ON vs fresh clone=OFF → divergent behavior; mid-session flips break the contract |
| 5 | **DB schema** | `db/0*.sql` migrations; dated backups; `api/db.py` queries; the root architecture doc schema section | **confirmed:** `db.py:321/352/360/1936` read `ct.guiding_question`; no migration creates it and the 2026-06-08 backup schema lacks it |
| 6 | **Enrichment `meta_data` / `report_card`** | the root architecture doc prose; dict-access by convention across engine, excel export, report_card_utils | singular DB keys (`process`) vs plural consumers (`processes`); `vocabulary` is semicolon-string OR list-of-dict OR list; `report_card` has **two writers** mutating the same capsule dict |
| 7 | **API ⇄ frontend** | Python route dicts (mostly raw, ~20% Pydantic); hand-written TS interfaces; no OpenAPI/codegen | `/assessment/start` returns 10 fields, the TS interface declares 5; ~80% of responses untyped |

**Keystone:** without #🔑, no guard is enforceable — a test CI never runs is documentation, not a gate.

---

## 2. Goal & non-goals

**Goal:** Every change is planned, built, and validated **against an explicit, versioned, machine-checkable contract**, and contract + code + docs move together or the merge fails. Provide one index (`REGISTRY.md`) that planning, execution, and validation all evaluate against — the "source of truth of sources of truth."

**Load-bearing is the end state (decision 2026-06-23).** The canonical state-machine contract must become the single artifact the system actually *runs on* — the engine drives transitions from it (or, at minimum, refuses to start if it disagrees with it) and the portal renders from it — so the three representations collapse into one functional source, not merely three that are tested for agreement. This is sequenced (verify-first, then load-bearing) but it is **in scope**, not deferred.

**Nothing gets dropped (decision 2026-06-23).** Every item this design surfaces is either (a) built in one of the phases below, or (b) entered as an ADO work item on the internal issue tracker. The Work Breakdown (§9) is the authoritative map; no item is left as an unowned "later."

**Non-goals (this effort):**
- Not introducing OpenAPI/codegen for the API contract now — registered (#7) and filed to ADO, scheduled later.
- Not 100% branch coverage of the engine — the golden test pins documented transitions + taxonomy + flag matrix, not every internal branch.
- Not rewriting the DB migration system — the schema smoke check (§4 Phase 2) catches the drift class without it; a migration-tracking table is a registered ADO item.

---

## 3. The Contract abstraction

A **Contract** is any logical truth with >1 representation. Each registered contract MUST define five parts:

| Part | Definition | Failure if absent |
|---|---|---|
| **Canonical source** | Exactly ONE machine-readable artifact, in git | drift has no referee |
| **Executable check** | A test/script proving every other representation agrees with the canonical source | agreement is assumed, not proven |
| **CI gate** | The check runs in CI and **blocks merge** on failure | guard is advisory only |
| **Plan-time declaration** | Before building: which contracts change, new version, improve-vs-regress, what's different for the end user | bad premises caught only after code exists |
| **Ship-time verification** | the pre-ship review gate emits a change-changelog + verdict and blocks SHIP if the check is red or the contract wasn't bumped | last-line gate missing |

### `docs/contracts/REGISTRY.md`

The index. One row per contract: name, canonical-source path, check path/command, CI-gated (Y/N), status (`guarded` / `partial` / `unguarded`), owner, known-drift notes (links to bug tickets). This file is required reading at plan time and is itself reviewed in `pre-ship review`.

---

## 3.1 Documentation & artifact layout (information architecture)

Today `docs/` is an unstructured grab-bag (a feature doc, icon assets, legal docs, and a stray specs folder). This effort establishes a deliberate layout, recorded in a new `docs/README.md` so it is discoverable and enforced going forward.

**Guiding rule:** *Load-bearing, machine-readable contract data lives with the code that consumes it (`api/…`). Human prose — designs, the registry, architecture — lives in `docs/`.* A file the engine reads at runtime is **code**, not documentation.

```
zingbee-ultra/
├── api/state_machine/
│   ├── zsm-v00X.json          # canonical state-machine contract DATA (engine + portal read it)
│   └── README.md              # how to regenerate/version it
├── docs/
│   ├── README.md              # NEW — defines this layout; the map for "where does X go?"
│   ├── design/                # design specs, date-stamped (YYYY-MM-DD-topic.md)  ← this file
│   ├── plans/                 # implementation plans, date-stamped (task-by-task execution)
│   ├── contracts/
│   │   └── REGISTRY.md        # the index of all contracts (source · check · CI · status)
│   ├── architecture/          # living architecture references (state-machine overview points to api/state_machine)
│   ├── legal/                 # unchanged
│   └── icons/                 # unchanged (asset, arguably belongs in clients/ — noted, not moved)
```

the root architecture doc's large "State Machine (Session Engine v6)" section is reduced to a pointer at `api/state_machine/` + `docs/contracts/REGISTRY.md`, eliminating it as a third hand-maintained copy.

---

## 4. Architecture — phased

### Phase 0 — CI keystone (unblocks everything, smallest change)

- Add `pytest` to `api/requirements.txt`.
- Add a **test stage** to `pipelines/azure-pipelines.yml` that runs `pytest api/tests/` and **fails the pipeline on any failure**, gating the build/deploy stages.
- Effect: the ~1,600 lines of existing engine tests immediately become merge gates, and every check built below is enforceable.
- Acceptance: a deliberately-broken engine transition turns the pipeline red.

### Phase 1 — State machine as Contract instance #1 (the worked example)

**4.1 Canonical source — export `states` to git.**
The versioned `decision_tree.states` definition (currently only in Postgres + `.sql` backups) is exported to a git-tracked file, e.g. `api/state_machine/zsm-v006.json`, carrying:
- `version` (e.g. `z-sm-v006.5`) + changelog (dated entries: what/why/before→after).
- States and transitions in a machine-parseable shape: `from_phase`, `interaction_type`, `condition`, `flags` (required flag-state), `→ to_phase`, `action`.
- The **`interaction_type` taxonomy** (contract #2 folded in here — it *is* the alphabet of the state machine): the authoritative set of types, and which are valid per phase.

**4.2 Executable check — behavioral golden test** `api/tests/test_state_machine_contract.py`:
- Parse the canonical JSON into fixtures.
- For each row: build a real engine (match the existing `make_engine()` unittest pattern in `api/tests/`), force `from_phase` + `condition` + the row's `flags` state, call `process_assessor_result(itype, msg)`, assert returned `new_phase` and `action` match.
- **Flag matrix:** every flag-gated transition is its own row per flag state — pins `(transition × flag)`.
- **Taxonomy guard:** assert no engine phase has a silent catch-all — every `interaction_type` valid for a phase has an explicit, asserted outcome; types not in the taxonomy are rejected loudly.
- Change a handler → a row fails → the dev must fix the code OR update the canonical JSON + changelog + version in the same PR.

**4.3 Ship-time — the State Machine contract check.**
Runs only when `api/session_engine.py` or the canonical JSON is in the diff. It: diffs engine changes vs the canonical contract; emits a **transition changelog** (every added/removed/changed transition, before→after); judges improve-vs-regress against documented premises (forfeit limits, attempt caps, batch rules, taxonomy completeness); **blocks SHIP** if the golden test is red or the contract/version wasn't bumped in the same PR.

**4.4 Plan-time — State Machine Impact Assessment.**
A short template required in the planning step (brainstorming / plan-writing) for any engine-touching work, answering: *Which states/transitions/types change? New version? Why is each an improvement? What is different for a student mid-session? Will the canonical JSON + golden test + docs be updated in this PR?* the root architecture doc's state-machine section collapses to a pointer at the canonical JSON + `REGISTRY.md`.

### Phase 2 — Register the siblings (checks built by ROI)

Each becomes a `REGISTRY.md` entry; checks land incrementally:
- **#3 Prompt registry:** `scripts/validate_prompt_contract.py` — every prompt ID the engine requests exists & is non-empty in the seed; every `$var` a template references is supplied by the engine. CI-gated. (Registers `step_teach_confirm` as known drift.)
- **#4 Feature flags:** a single flag registry module + `.env.example` parity check (CI fails if a `_flag()` name is missing from `.env.example`/docs). Flags relevant to the state machine are already pinned by 4.2's flag matrix.
- **#5 DB schema:** a smoke check that executes each `db.py` query against a restored backup in CI and fails on `undefined column` — catches the `guiding_question` class.
- **#6 enrichment/report_card, #7 API⇄frontend:** registered now with known-drift notes; checks scheduled later.

### Phase 3 — Make the state-machine contract load-bearing

Phase 1 *proves* the engine agrees with the canonical JSON; Phase 3 makes that JSON the thing the system actually runs on, so the representations can no longer diverge by construction:

- **3a — Engine reads the canonical contract.** On `SessionEngine` init, load `api/state_machine/zsm-v00X.json` and the active feature-flag set; **fail fast** (raise, refuse to start the session) if the engine's compiled transition set disagrees with the canonical contract for the current flag state. This converts the golden test's guarantee into a runtime invariant — a mismatch can't even start a session, let alone reach a student. (Chosen as the minimal load-bearing step: validate-at-startup before the larger move of *driving* transitions from data.)
- **3b — Portal renders from the same file.** Repoint `clients/red-team/app/learning-system/` to read the canonical contract (via an API endpoint serving `zsm-v00X.json`) instead of the DB `descision_tree.states` blob, so the visualization is guaranteed to match runtime. Retire/!reconcile the now-redundant DB `.states` field.
- **3c — (stretch, separate decision) Data-driven transitions.** Evaluate moving the imperative `_process_*` logic to be *driven* by the contract data rather than merely *checked* against it. Larger refactor; gated on 3a/3b proving stable. Filed as its own ADO item, not committed here.

Sequencing: Phase 0 → 1 land first (stop the bleeding, make it enforceable); Phase 3a/3b follow once the golden test is trusted; 2 proceeds in parallel by ROI.

---

## 5. Lifecycle data flow

```
PLAN      Impact Assessment: which contracts change? version? improve/regress?
            │  (REGISTRY.md is required reading)
            ▼
EXECUTE   code change ──► CI runs contract checks (Phase 0 makes this real)
            │                     │
            │            row/shape mismatch ──► CI RED
            │                     │
            │   dev fixes code  OR  bumps canonical source + changelog + version
            ▼                     ▼
VALIDATE  pre-ship review: changelog + improve/regress verdict; blocks SHIP
            ▼
          contract + code + docs merge together — drift cannot ship silently
```

---

## 6. Testing strategy

- Golden contract test added under `api/tests/` using the existing `unittest` + `make_engine()` convention (no new framework).
- Phase 0 proven by a deliberately-broken transition reddening the pipeline.
- Phase 2 checks each ship with a self-test (e.g., a known-missing prompt ID makes `validate_prompt_contract.py` exit non-zero).

---

## 7. Risks & open questions

- **Canonical export staleness:** the exported JSON must be regenerated when the DB schema changes intentionally; the version-bump discipline + pre-ship gate cover this, but the export script's provenance (which `learning_system_schemas` row is canonical) must be pinned. **Open:** which schema row/name is the canonical one to export.
- **Prod vs backup divergence:** prod DB is managed ad-hoc over SSH and may carry undocumented columns (e.g. possibly `guiding_question`). The schema smoke check should run against a *prod-representative* restore, not only the newest committed backup. **Open:** confirm whether prod actually has `guiding_question`.
- **Flag matrix explosion:** pin only flag combinations that are real (current prod set + legacy-off), not the full cartesian product.
- **CI runtime cost:** `api/tests/` is pure unit (no DB/LLM), ~30–60s; the #5 restore-and-query check is heavier and may run in a separate, non-blocking-at-first stage until trusted.

---

## 8. Definition of done (this effort)

- `pytest` gates merges in CI (Phase 0).
- `api/state_machine/zsm-v00X.json` exists, versioned, with taxonomy + flag annotations.
- `test_state_machine_contract.py` passes and fails loudly on transition drift.
- Engine validates against the canonical contract at startup and refuses to start on mismatch (Phase 3a).
- Portal renders from the canonical contract (Phase 3b).
- pre-ship contract check added; plan-time Impact Assessment template added.
- `docs/contracts/REGISTRY.md` exists listing all 7 contracts with status + known-drift notes.
- `docs/README.md` records the documentation layout (§3.1).
- Every §9 row is either ✅ done in this effort or has an ADO id.

---

## 9. Work Breakdown — nothing dropped

Authoritative map. **Status legend:** `EFFORT` = built in this effort's phases; `ADO` = filed as a work item on the internal issue tracker (id filled in once created). No row may be `—`.

### 9.1 Guardrail build (this effort)

| Item | Phase | Status |
|---|---|---|
| Add `pytest` to `requirements.txt`; CI test stage gates merges | 0 | EFFORT |
| Export canonical `zsm-v00X.json` (states + taxonomy + flag annotations) | 1 | EFFORT |
| `test_state_machine_contract.py` behavioral golden test (incl. flag matrix + taxonomy guard) | 1 | EFFORT |
| pre-ship State Machine contract check + transition changelog | 1 | EFFORT |
| Plan-time State Machine Impact Assessment template | 1 | EFFORT |
| `docs/contracts/REGISTRY.md` + `docs/README.md` (layout) | 1 | EFFORT |
| Collapse the root architecture doc state-machine section to a pointer | 1 | EFFORT |
| Engine validates vs canonical contract at startup, fails fast | 3a | EFFORT (ADO-87, follow-on plan after Phase 1 trusted) |
| Portal renders from canonical contract; retire DB `.states` | 3b | EFFORT (ADO-87, follow-on plan after Phase 1 trusted) |

### 9.2 Sibling contract checks (registered → ADO unless pulled into effort)

| Item | Contract | Status |
|---|---|---|
| `validate_prompt_contract.py` (prompt IDs + `$vars`), CI-gated | #3 | ADO-77 |
| Flag registry module + `.env.example`/docs parity check | #4 | ADO-78 |
| `db.py`-queries-vs-restored-backup smoke check | #5 | ADO-79 |
| Enrichment `meta_data` + `report_card` shape validation | #6 | ADO-80 |
| API⇄frontend contract (OpenAPI/codegen or runtime schema) | #7 | ADO-81 |
| Data-driven transitions (drive `_process_*` from contract data) | SM 3c | ADO-82 |
| DB migration-tracking table (`schema_migrations`) | #5 | ADO-83 |

### 9.3 Live bugs the sweep found (decide per row: fix-in-effort or ADO)

| Bug | Evidence | Default disposition |
|---|---|---|
| `db.py` reads `ct.guiding_question` (no migration creates it; absent from latest backup) | `db.py:321/352/360/1936` | ADO-84 (verify prod first) |
| `step_teach_confirm` rendered but seeded by no script / in no doc | engine renders it; no `apply_*` seed | ADO-85 |
| CHECK/EVIDENCE silently treat unhandled `interaction_type` as FAILED (silent mis-grading) | `session_engine.py` phase handlers | **fix in Phase 1** (taxonomy guard forces explicit handling) |
| Engine transition flags absent from `.env.example`/docs (prod=ON vs clone=OFF) | `.env` vs `.env.example` | **ADO-88** — flag code is unmerged on the engagement-quality branch; documented when that branch rebases onto the guardrail (was planned in-effort, but `main` has no flag code) |
| `report_card` two writers mutate the same capsule dict | `db.py` vs `report_card_utils.py` | ADO-86 |

> ADO items **77–86 created 2026-06-23** on the internal issue tracker (type Task, tag `Contract Guardrail`), each linking back to this design doc. The two live bugs marked **fix in Phase 1** are handled inside this effort and intentionally have no separate ticket.
- the root architecture doc state-machine section points to the canonical JSON + registry.
