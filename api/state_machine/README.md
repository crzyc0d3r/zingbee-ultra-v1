# ZingBee State Machine Contract — zsm-v006.json

## What this is

`zsm-v006.json` is the **canonical, machine-readable contract** for the ZingBee
session engine (v6). It encodes the *intended* behavior of every phase handler in
`api/session_engine.py`: which interaction types are valid in each phase, and what
transition (action + destination phase) each one triggers under each condition.

This contract is the source of truth for:

- **Shape tests** (`api/tests/test_state_machine_contract.py`) — verifies the JSON
  is structurally valid on every CI run.
- **Behavioral golden tests** (Task 4) — drives the real engine against each row and
  asserts the engine produces the expected `action` and `new_phase`.
- **Engine startup validation** (Phase 3a / ADO-87, **live**) — `SessionEngine`
  validates against this file at session start via
  `validate_against_contract()` and refuses to start a session if its
  dispatchable phase set has drifted from the contract. Gated by
  `SM_CONTRACT_VALIDATION` (`true` default = drift fatal / missing-file warn;
  `strict` = both fatal; `false` = off). Tested by
  `api/tests/test_state_machine_startup_validation.py`.

---

## Row schema

Each object in `"transitions"` has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Phase the engine is in when the interaction arrives |
| `itype` | string | `interaction_type` string from the assessor |
| `condition` | string | Guard on engine state, e.g. `"try_attempts<2"`, `"any"` |
| `flags` | object | Feature flags that gate this row (empty `{}` = unconditional) |
| `to` | string | Phase the engine transitions to |
| `action` | string | Exact string in the `"action"` key of the returned dict |

`condition` strings are human-readable (not code). The behavioral test interprets
them to set up the engine fixture before exercising the row.

Optional annotation fields (`_comment`, `_note`) exist for readability only and are
ignored by all tools.

---

## Taxonomy

`"taxonomy"` declares:

- `"all_types"` — exhaustive list of every `interaction_type` string the engine can
  receive. Any itype used in a transition row must appear here.
- `"valid_per_phase"` — per-phase allow-list. The behavioral test uses this to
  enumerate which itypes to exercise.

---

## How to update the contract

Whenever a behavioral change is made to `session_engine.py`:

1. **Update the affected transition rows** in `zsm-v006.json`.
2. **Bump the version string** — use `z-sm-v006.<patch>` (e.g. `z-sm-v006.6`).
3. **Append a changelog entry** at the top of `"changelog"`:

```json
{
  "version": "z-sm-v006.6",
  "date": "YYYY-MM-DD",
  "change": "One-line summary of what changed",
  "before": "Old behavior description",
  "after": "New behavior description"
}
```

4. Run `pytest api/tests/test_state_machine_contract.py -v` to verify shape.
5. Run the full behavioral test suite (Task 4) to verify the engine still matches.

---

## Known intentional deviations

None active. Previously noted deviations have been resolved:

**CHECK and EVIDENCE — non-answer interaction types (resolved v006.5):**

The contract encodes `action: "wait"` for `student_question`, `confirmation`,
`teaching`, and `off_topic` arriving during CHECK or EVIDENCE phases. As of
engine v006.5 / contract v006.6, the engine explicitly guards these types in
`_process_check` and `_process_evidence` and returns a `wait` no-op instead of
falling through to the former `else` branch that incorrectly set
`check_result = "FAILED"` / `evidence_result = "FAILED"`. Contract and engine
are now in sync for these rows.

---

## Loader API

```python
from state_machine import loader

c = loader.load_contract()          # loads zsm-v006.json from this directory
c = loader.load_contract("/path")   # loads from explicit path

rows = loader.transitions(c)        # list[dict] — all transition rows
tax  = loader.taxonomy(c)           # {"all_types": [...], "valid_per_phase": {...}}
```
