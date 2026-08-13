# Contract Registry

The index of system contracts: each has ONE canonical source, an executable
check, a CI gate, a plan-time declaration, and a ship-time verification.
A change that diverges from a contract must update the canonical source +
check in the same PR or CI fails.

| # | Contract | Canonical source | Check | CI-gated | Status | Tracking |
|---|---|---|---|---|---|---|
| 1 | State machine | `api/state_machine/zsm-v006.json` | `api/tests/test_state_machine_contract.py` + startup check | yes | guarded + load-bearing (3a) | this plan |
| 2 | interaction_type taxonomy | folded into #1 (`taxonomy` block) | same golden test + startup check | yes | guarded + load-bearing (3a) | this plan |
| 3 | Prompt registry | DB `descision_tree.prompt_registry` | `scripts/validate_prompt_contract.py` (todo) | no | unguarded | ADO-77 |
| 4 | Feature flags | flag registry module (todo) | `.env.example` parity (todo) | no | partial | ADO-78 |
| 5 | DB schema | migrations + backups | db.py-vs-restore smoke (todo) | no | unguarded | ADO-79, ADO-83 |
| 6 | Enrichment / report_card | the root architecture doc prose (todo: schema) | (todo) | no | unguarded | ADO-80 |
| 7 | API ⇄ frontend | none (todo: OpenAPI) | (todo) | no | unguarded | ADO-81 |

**Load-bearing (Phase 3a, ADO-87):** `SessionEngine.validate_against_contract()`
runs at session start (once per process, gated by `SM_CONTRACT_VALIDATION`) and
**refuses to start a session** if the engine's dispatchable phase set has drifted
from the canonical contract — a mismatch can't reach a student. Remaining: 3b
(portal renders from the contract) and ADO-82 (3c data-driven transitions).

**Plan-time gate:** engine-touching work must include a completed
[State Machine Impact Assessment](impact-assessment-template.md) in its plan.

Known live drift: ADO-84 (`guiding_question`), ADO-85 (`step_teach_confirm`), ADO-86 (`report_card` dual-writer).
