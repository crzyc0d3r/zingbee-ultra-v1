# Plan — State machine load-bearing, Phase 3a (ADO-87)

**Date:** 2026-06-24
**Branch:** the contract-registry-guardrail branch
**Design:** `docs/design/2026-06-23-contract-registry-and-state-machine-guardrail.md` §4 Phase 3a
**Scope:** ADO-87 (Phase 3a only). ADO-87 Phase 3b (portal renders from contract) and
ADO-82 (Phase 3c data-driven transitions) are NOT in this change — 3c is gated on
3a/3b proving stable per the design.

## State Machine Impact Assessment (required by REGISTRY plan-time gate)

| Question | Answer |
|---|---|
| Which states/transitions/types change? | **None.** No phase, transition, condition, or interaction_type is added, removed, or re-pointed. |
| New contract version? | **No bump.** Behavior is byte-identical; the contract (`z-sm-v006.6`) is unchanged. This change adds a *runtime invariant over* the contract, not a change *to* it. |
| Why is this an improvement? | Converts the golden test's CI-time guarantee into a startup invariant: if the engine's dispatchable phase set and the canonical contract disagree, the engine **refuses to start a session** instead of silently running a stale graph (the ADO #26 pathology). |
| What is different for a student mid-session? | Nothing in the happy path. If (and only if) the engine and contract have drifted, sessions fail fast at init rather than mis-routing. |
| Will the canonical JSON + golden test + docs update in this PR? | JSON unchanged (no behavior change). New test `test_state_machine_startup_validation.py`. REGISTRY + state_machine README updated. |

## What 3a does

1. Make the engine's phase dispatch **data-driven** from a single `_PHASE_HANDLERS`
   map (phase → handler method), used by `process_assessor_result` for execution.
   The same map is the engine's authoritative phase set — no second copy to drift.
2. `SessionEngine.validate_against_contract()` loads `api/state_machine/zsm-v006.json`
   and asserts: engine phase set == contract phase set; every `valid_per_phase`
   itype is declared in `all_types`; every transition references a dispatchable
   `from`, a known `to`, and a declared itype.
3. `init_session` runs the check once per process, gated by `SM_CONTRACT_VALIDATION`
   (`true` default → drift is fatal, missing-file is warn-only; `strict` → both
   fatal; `false`/`off` → skip). On drift it raises `StateMachineContractError`.

## Acceptance

- A correct engine + contract validates clean and starts normally.
- A tampered contract (extra/missing phase, undeclared itype) makes init raise.
- `SM_CONTRACT_VALIDATION=false` disables the gate.
- Existing engine + contract test suites stay green.
