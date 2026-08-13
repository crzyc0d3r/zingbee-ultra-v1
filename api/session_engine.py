"""v6 Session Engine — Complete replacement for SessionState._process_fact_interaction.

This module manages the scaffold progression using the v6 session_state dict natively.
No dual state machines, no syncing. The v6 session_state IS the source of truth.

Usage:
    engine = SessionEngine(decision_tree, persona, curriculum)
    engine.init_session(facts, session_id=..., student_id=..., capsule_id=...)  # once at session start

    # On each chat turn:
    transition = engine.process_assessor_result(interaction_type)
    # transition contains: state, prompt_id, prompt_text, fact_meta

    # Get current state for prompts:
    engine.current_fact_text  # "All living things are called organisms"
    engine.current_fact_meta  # {core_fact, process, vocabulary, ...}
    engine.current_phase      # "TEACH", "TRY", "EVIDENCE"
"""

import logging
import os
import uuid
from math import ceil
from datetime import datetime, timezone
from string import Template
from typing import Optional

from classifier import is_substantive_response  # ADO #28 evidence substance guard

log = logging.getLogger(__name__)


class StateMachineContractError(RuntimeError):
    """Raised at session start when the engine's dispatchable phase set disagrees
    with the canonical state-machine contract (api/state_machine/zsm-v006.json).

    Phase 3a of the contract-registry guardrail (ADO-87): a drifted contract must
    not be able to start a session — it fails fast here instead of silently
    running a stale graph.
    """


# Process-wide one-time guard so the contract is validated once per process at the
# first session start, not re-read on every init. Tests reset this to re-exercise.
_CONTRACT_VALIDATED = False


def _flag(name: str, default: bool = False) -> bool:
    """Read a boolean feature flag from the environment at call time.

    Read lazily (not at import) so a deploy can ship code with flags OFF and
    enable them later without a redeploy, and so tests can toggle per-case.
    ADO #26 quality follow-up gates every behavior change this way.
    """
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _maybe_validate_contract(engine: "SessionEngine") -> None:
    """Run the load-bearing startup check once per process, honoring
    SM_CONTRACT_VALIDATION:
      - "true" (default): contract DRIFT is fatal; an unreadable/missing contract
        file is warn-only (a packaging error shouldn't take down all tutoring).
      - "strict": both drift and load failure are fatal.
      - "false"/"off"/"0"/"no": skip entirely.
    """
    global _CONTRACT_VALIDATED
    if _CONTRACT_VALIDATED:
        return
    from state_machine import loader
    mode = os.environ.get("SM_CONTRACT_VALIDATION", "true").strip().lower()
    if mode in ("0", "false", "off", "no"):
        log.warning("state-machine contract validation DISABLED "
                    "(SM_CONTRACT_VALIDATION=%s)", mode)
        _CONTRACT_VALIDATED = True
        return
    # Loading the contract file is a SEPARATE concern from validating against it.
    # A missing/unreadable/malformed file is a packaging error — warn-only in the
    # default mode, fatal in "strict". Crucially, on a load failure we return
    # WITHOUT latching _CONTRACT_VALIDATED, so the next session retries the load
    # (a restored/late-mounted file then gets validated rather than being skipped
    # for the life of the process).
    try:
        contract = loader.load_contract()
    except Exception as e:
        if mode == "strict":
            raise
        # Rate-limit noisy errors that happen once-per-session by default.
        try:
            from log_rate_limiter import should_log_for_session
        except Exception:
            # If the helper isn't available for any reason, fall back to
            # unconditional logging to avoid hiding problems in test/dev.
            should_log_for_session = lambda *args, **kwargs: True
        # Safely extract session_id even if engine.state exists but is falsy
        # (for example, an empty dict). getattr works on any object (including
        # None) so this never raises; the or {} ensures we can call .get().
        state_obj = getattr(engine, "state", {}) or {}
        session_id = state_obj.get("session_id")
        if should_log_for_session(session_id, "state-machine-contract-load-fail", ttl_seconds=60):
            log.error("state-machine contract could not be loaded — guardrail is OFF "
                      "for this session, will retry next session: %s", e)
        return
    # A loadable contract that disagrees with the engine is real DRIFT — always
    # fatal regardless of mode: refuse to start so it can't reach a student.
    engine.validate_against_contract(contract=contract, strict=True)
    _CONTRACT_VALIDATED = True


class SessionEngine:
    """v6 state machine that manages scaffold progression natively.

    This replaces the old _process_fact_interaction + knowledge_points system.
    All state lives in self.state (the v6 session_state dict).
    """

    # Phase -> handler method name. SINGLE SOURCE OF TRUTH for which phases the
    # engine dispatches. Used by process_assessor_result (execution) AND by
    # validate_against_contract (the load-bearing startup check). Adding or
    # removing a phase here without updating the canonical contract
    # (api/state_machine/zsm-v006.json) makes the engine refuse to start a
    # session — see validate_against_contract / _maybe_validate_contract.
    _PHASE_HANDLERS = {
        "TEACH": "_process_teach",
        "TRY": "_process_try",
        "EVIDENCE": "_process_evidence",
        "RECALL": "_process_recall",
        "CAPSULE_COMPLETE": "_process_closure",
    }

    def __init__(self, decision_tree: dict, persona: dict, curriculum: dict):
        self.dt = decision_tree
        self.persona = persona
        self.curriculum = curriculum
        self.prompts = decision_tree.get("prompt_registry", {})
        self.last_rendered_prompt_id = None  # step prompt driving the latest turn (A3 attribution)
        self.state = None
        self._facts = []  # [{id, text, meta, scaffold}, ...]
        self._batches = []  # [[fact_id, ...], ...]
        self._fact_map = {}  # fact_id -> {text, meta, scaffold}

        # Persona traits for template rendering
        traits = persona.get("persona_traits", "")
        if isinstance(traits, list):
            traits = "\n".join(f"- {t}" for t in traits)
        self._render_base = {
            "tutor_name": persona.get("tutor_name", "Tutor"),
            "creator_name": persona.get("creator_name", "ZingBee and Academy"),
            "persona_description": persona.get("persona_description", "a helpful"),
            "persona_traits": traits,
            "subject": curriculum.get("subject", ""),
            "subject_lower": curriculum.get("subject_lower", ""),
            "age_range": curriculum.get("age_range", "10-12"),
            "phase": str(curriculum.get("phase", 1)),
            "capsule_name": curriculum.get("capsule_name", ""),
        }

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def init_session(self, facts: list, session_id: str = None,
                     student_id: str = "", capsule_id: str = ""):
        """Initialize a fresh session with facts from curriculum_facts table.

        Args:
            facts: list of DB rows with id, order, meta_data
        """
        import os
        import random
        use_pregen = os.environ.get("USE_PRE_GENERATED", "false").lower() == "true"

        self._facts = []
        self._fact_map = {}
        for f in facts:
            meta = f.get("meta_data", {})
            fid = str(f["id"])
            text = meta.get("core_fact", "")
            scaffold = meta.get("scaffold", ["TEACH", "TRY"])
            if isinstance(scaffold, str):
                scaffold = [scaffold]
            entry = {"id": fid, "text": text, "meta": meta, "scaffold": scaffold,
                     "pre_gen_explanation": None, "pre_gen_image_url": None,
                     "pre_gen_suggestions": None}

            # Load pre-generated content when feature flag is enabled
            if use_pregen:
                try:
                    import hashlib, json, db as _db
                    current_hash = hashlib.sha256(
                        json.dumps(meta, sort_keys=True, default=str).encode()
                    ).hexdigest()[:16]

                    approved = _db.get_approved_distillations(fid)
                    # Filter out stale variants
                    valid = [v for v in approved if v.get("fact_hash") == current_hash]
                    if valid:
                        chosen = random.choice(valid)
                        entry["pre_gen_explanation"] = chosen.get("text")
                        entry["pre_gen_suggestions"] = chosen.get("suggestions")
                        entry["pre_gen_explanation_id"] = chosen.get("id")

                    # Load approved images independently
                    img_row = _db.get_curriculum_fact_images_row(fid)
                    if img_row and img_row.get("meta_data"):
                        approved_imgs = [
                            v for v in img_row["meta_data"]
                            if (v.get("evaluation") or {}).get("decision") == "SHIP"
                            or (v.get("human_review") or {}).get("status") in ("approve", "approved")
                        ]
                        if approved_imgs:
                            chosen_img = random.choice(approved_imgs)
                            entry["pre_gen_image_url"] = chosen_img.get("image_url")
                            entry["pre_gen_image_id"] = chosen_img.get("id")
                except Exception:
                    pass  # Graceful fallback to runtime generation

            self._facts.append(entry)
            self._fact_map[fid] = entry

        self._batches = self._compute_batches()

        self.state = {
            "session_id": session_id or str(uuid.uuid4()),
            "student_id": student_id,
            "capsule_id": capsule_id,
            "current_batch_index": 0,
            "current_fact_index": 0,
            "scaffold_position": 0,
            "current_phase": "TEACH",
            "message_count": 0,
            "batches": self._batches,
            "fact_statuses": {},
            "forfeit_count": 0,
            "forfeit_limit": ceil(len(self._facts) * 0.3) if self._facts else 1,
            "pending_correction": None,
            "evidence_queue": [],
            "evidence_passed": [],
            "evidence_failed": [],
            "evidence_phase": None,
            "teach_context": None,  # "reteach", "confused", "confirm", "continue", "example", "explore", or None
            "last_suggestions": [],  # [{"text", "intent"}] emitted last turn (ADO #26 chip routing)
            "last_offered_intents": [],  # ADO #26 C*: intents shown last turn (no-repeat rotation)
            "chip_rotation_index": 0,    # ADO #26 C*: advances each chip render
            "recall_turns": 0,
            "closure_state": None,  # None | "offered" | "recap_done"
            "closure_ended": False,
            "practice_complete_end": False,  # v006.10 end-after-practice flag
        }

        # Init per-fact status
        for f in self._facts:
            self.state["fact_statuses"][f["id"]] = self._new_fact_status()

        # Phase 3a (ADO-87): refuse to start if the engine has drifted from the
        # canonical state-machine contract. One-time per process; flag-gated.
        _maybe_validate_contract(self)

    @staticmethod
    def _new_fact_status() -> dict:
        """Fresh per-fact status record. Single source of truth so init_session
        and the self-healing fact_status() (and restore back-fill) never drift."""
        return {
            "teach_attempts": 0,
            "try_attempts": 0,
            "check_result": None,
            "evidence_result": None,
            "evidence_attempts": 0,
            "evidence_followup": False,
            "evidence_probe_count": 0,      # ADO #28: probes spent on this fact
            "evidence_probe_pending": False,  # awaiting a probe answer
            "evidence_responses": [],       # audit trail of produced evidence
            "final_status": None,
            "scaffold_position": 0,
            "teach_complete": False,
            "try_complete": False,
            "scaffold_complete": False,  # v006.11: whole TEACH->TRY finished (or skipped)
            "engagement_detours": 0,
            "teach_wait_turns": 0,        # ADO #26 A*: consecutive non-advancing TEACH turns
            "teach_checkpoint_done": False,  # ADO #26 A*: diagnostic check-question offered
            "hints_given": 0,             # ADO #26 D: TRY hints consumed on this fact
        }

    def validate_against_contract(self, contract: dict = None, strict: bool = True) -> list:
        """Load-bearing startup check (contract guardrail Phase 3a).

        Asserts the engine's dispatchable phase set agrees with the canonical
        contract (api/state_machine/zsm-v006.json), and that the contract is
        internally consistent:
          - engine phase set == contract `valid_per_phase` phase set,
          - every `valid_per_phase` itype is declared in `all_types`,
          - every transition references a dispatchable `from`, a known `to`, and
            a declared itype.

        Returns the list of problems found. When `strict` and problems exist,
        raises StateMachineContractError so a drifted contract cannot start a
        session. Pass `contract` to validate an in-memory contract (tests).
        """
        from state_machine import loader
        c = contract if contract is not None else loader.load_contract()
        tax = loader.taxonomy(c)
        contract_phases = set(tax.get("valid_per_phase", {}).keys())
        engine_phases = set(self._PHASE_HANDLERS)
        all_types = set(tax.get("all_types", []))
        problems = []

        only_engine = engine_phases - contract_phases
        only_contract = contract_phases - engine_phases
        if only_engine:
            problems.append(
                f"engine dispatches phases absent from contract: {sorted(only_engine)}")
        if only_contract:
            problems.append(
                f"contract declares phases the engine cannot dispatch: {sorted(only_contract)}")

        # Every _PHASE_HANDLERS entry must resolve to a real callable. Catches a
        # handler rename/refactor that leaves the map stale — otherwise the phase
        # set still matches the contract, validation passes, and the engine then
        # AttributeErrors on the first turn of that phase (whole tutor down).
        for ph, handler_name in self._PHASE_HANDLERS.items():
            if not callable(getattr(self, handler_name, None)):
                problems.append(
                    f"phase {ph!r} handler {handler_name!r} is not a callable on the engine")

        for ph, types in tax.get("valid_per_phase", {}).items():
            for it in types:
                if it not in all_types:
                    problems.append(
                        f"valid_per_phase[{ph}] itype {it!r} not declared in all_types")

        for t in loader.transitions(c):
            if "from" not in t:  # comment-only separator rows
                continue
            if t["from"] not in engine_phases:
                problems.append(
                    f"transition from-phase {t['from']!r} not dispatchable by engine")
            if t.get("to") not in contract_phases:
                problems.append(
                    f"transition to-phase {t.get('to')!r} is not a known phase")
            if t.get("itype") not in all_types:
                problems.append(
                    f"transition itype {t.get('itype')!r} not in taxonomy all_types")

        if problems and strict:
            raise StateMachineContractError(
                "state-machine contract drift — engine refuses to start:\n  - "
                + "\n  - ".join(problems))
        return problems

    def _compute_batches(self, max_batch=5) -> list:
        n = len(self._facts)
        if n == 0:
            return []
        if n <= max_batch:
            return [[f["id"] for f in self._facts]]
        num_batches = ceil(n / max_batch)
        base, extra = divmod(n, num_batches)
        batches, start = [], 0
        for i in range(num_batches):
            size = base + (1 if i < extra else 0)
            batches.append([self._facts[j]["id"] for j in range(start, start + size)])
            start += size
        return batches

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------

    @property
    def current_phase(self) -> str:
        return self.state.get("current_phase", "TEACH") if self.state else "TEACH"

    @property
    def current_batch(self) -> list:
        bi = self.state["current_batch_index"]
        return self._batches[bi] if bi < len(self._batches) else []

    @property
    def current_fact_id(self) -> Optional[str]:
        batch = self.current_batch
        fi = self.state["current_fact_index"]
        return batch[fi] if fi < len(batch) else None

    @property
    def current_fact_entry(self) -> dict:
        fid = self.current_fact_id
        return self._fact_map.get(fid, {}) if fid else {}

    @property
    def current_fact_text(self) -> str:
        return self.current_fact_entry.get("text", "")

    @property
    def current_fact_meta(self) -> dict:
        meta = dict(self.current_fact_entry.get("meta", {}))
        meta["core_fact"] = self.current_fact_text
        return meta

    @property
    def current_scaffold(self) -> list:
        return self.current_fact_entry.get("scaffold", ["TEACH", "TRY"])

    @property
    def total_facts(self) -> int:
        return len(self._facts)

    @property
    def facts_introduced(self) -> list:
        """Facts where student has had at least one exposure (TEACH started but scaffold not complete)."""
        return [self._fact_map[fid]["text"]
                for fid, fs in self.state.get("fact_statuses", {}).items()
                if fs.get("teach_attempts", 0) > 0 and not fs.get("teach_complete") and fid in self._fact_map]

    @property
    def facts_taught(self) -> list:
        """Facts whose TEACH/TRY scaffold is complete but not yet assessed at
        the final EVIDENCE step (CHECK removed — the scaffold is the whole
        per-fact flow now)."""
        return [self._fact_map[fid]["text"]
                for fid, fs in self.state.get("fact_statuses", {}).items()
                if fs.get("teach_complete") and not fs.get("evidence_result")
                and fs.get("final_status") != "MASTERED" and fid in self._fact_map]

    @property
    def facts_assessed(self) -> list:
        """Facts assessed at EVIDENCE (have an evidence_result) but not mastered."""
        return [self._fact_map[fid]["text"]
                for fid, fs in self.state.get("fact_statuses", {}).items()
                if fs.get("evidence_result") and fs.get("final_status") != "MASTERED"
                and fid in self._fact_map]

    @property
    def facts_mastered(self) -> list:
        return [self._fact_map[fid]["text"]
                for fid, fs in self.state.get("fact_statuses", {}).items()
                if fs.get("final_status") == "MASTERED" and fid in self._fact_map]

    def fact_status(self, fact_id: str = None) -> dict:
        fid = fact_id or self.current_fact_id
        if fid is None:
            return {}  # no current fact (e.g. CAPSULE_COMPLETE) — caller tolerates
        fs = self.state["fact_statuses"].get(fid)
        if fs is None:
            # Self-heal: a restored/legacy session can point at a fact the saved
            # blob never registered. Returning a throwaway {} silently dropped
            # every counter write (camp guard, hint cap); create + persist it.
            fs = self._new_fact_status()
            self.state["fact_statuses"][fid] = fs
        return fs

    # ------------------------------------------------------------------
    # Vocabulary Bank (ADO #25)
    # ------------------------------------------------------------------

    @staticmethod
    def _vocab_entries(meta: dict) -> list:
        """[{term, definition}] from a fact's meta_data. Prefers the enriched
        vocabulary_bank key (written by scripts/generate_vocab_definitions.py);
        falls back to the legacy semicolon-string vocabulary field, which
        carries terms only."""
        # str() coercion guards against non-string terms/definitions in JSONB
        # (a bad import or hand-edit) that would otherwise raise AttributeError
        # and kill the panel for the whole session.
        enriched = meta.get("vocabulary_bank")
        if isinstance(enriched, list):
            out = []
            for v in enriched:
                if not isinstance(v, dict):
                    continue
                term = str(v.get("term") or "").strip()
                if term:
                    out.append({"term": term,
                                "definition": str(v.get("definition") or "").strip()})
            if out:
                return out
        raw = meta.get("vocabulary")
        if isinstance(raw, str):
            return [{"term": t.strip(), "definition": ""}
                    for t in raw.split(";") if t.strip()]
        if isinstance(raw, list):
            out = []
            for v in raw:
                if isinstance(v, dict):
                    term = str(v.get("term") or "").strip()
                    if term:
                        out.append({"term": term,
                                    "definition": str(v.get("definition") or "").strip()})
                elif isinstance(v, str) and v.strip():
                    out.append({"term": v.strip(), "definition": ""})
            return out
        return []

    def definitions_masked(self) -> bool:
        """True while the student is being assessed at the phase that RECORDS a
        mastery grade — EVIDENCE (COLLECT/RETRY). There, a visible definition
        could be the verbatim answer, corrupting the recorded signal. Masking
        happens server-side, so definitions never leave the API during those
        turns. TEACH/TRY are never masked — they re-teach and let the student
        practise; the authoritative grade happens later at the masked EVIDENCE."""
        phase = self.current_phase
        if phase == "EVIDENCE":
            return self.state.get("evidence_phase") in ("COLLECT", "RETRY")
        return False

    def vocab_bank(self) -> list:
        """Vocabulary for every fact whose TEACH has started, current fact's
        terms first. Pure derivation from state + _fact_map — nothing new to
        serialize, so resume works on old blobs. Status enum is open-ended
        (a future "used" status slots in without breaking clients)."""
        if not self.state:
            return []
        current = self.current_fact_id
        statuses = self.state.get("fact_statuses", {})
        masked = self.definitions_masked()

        def teach_started(fid: str, fs: dict) -> bool:
            # teach_attempts only increments on confusion, so the current-fact
            # clause is what surfaces a fact the moment it becomes active.
            return bool(fid == current or fs.get("teach_complete")
                        or fs.get("try_complete")
                        or fs.get("teach_attempts", 0) > 0
                        or fs.get("try_attempts", 0) > 0
                        or fs.get("check_result") or fs.get("evidence_result")
                        or fs.get("final_status"))

        bank, seen = [], set()
        ordered = sorted(self._facts, key=lambda f: f["id"] != current)
        for f in ordered:
            fid = f["id"]
            fs = statuses.get(fid, {})
            if not teach_started(fid, fs):
                continue
            status = ("current" if fid == current
                      else "mastered" if fs.get("final_status") == "MASTERED"
                      else "taught")
            for v in self._vocab_entries(f.get("meta", {})):
                key = v["term"].lower()
                if key in seen:
                    continue
                seen.add(key)
                bank.append({
                    "term": v["term"],
                    "definition": "" if masked else v["definition"],
                    "fact_id": fid,
                    "status": status,
                })
        return bank

    # ------------------------------------------------------------------
    # Template rendering
    # ------------------------------------------------------------------

    def render_prompt(self, prompt_id: str, extra_vars: dict = None) -> str:
        """Render a prompt template with all variables."""
        entry = self.prompts.get(prompt_id, {})
        tmpl = entry.get("template", "")
        if not tmpl:
            # Loud: a missing template means a deploy/script-ordering gap and
            # the tutor gets NO instruction for this transition.
            log.warning("render_prompt: template %r missing/empty in registry — "
                        "rendering nothing for this transition", prompt_id)
            return ""
        # A3 attribution: record the prompt driving this turn. render_prompt is the
        # chokepoint every step/phase render flows through (TEACH/TRY/CHECK/EVIDENCE +
        # all reteach/confused/continue variants), so this captures far more than just
        # render_step_transition did. Persists across stay-in-phase turns until the next
        # render. (Session-start opening renders via web_ui's database.render_prompt path,
        # which is not yet attributed — turn-1 prompt_id may still be NULL.)
        self.last_rendered_prompt_id = prompt_id
        all_vars = {**self._render_base, **self.current_fact_meta}
        # Lists from fact meta would render as Python reprs through
        # safe_substitute — always provide the formatted form (extra_vars
        # can still override)
        all_vars["stretch_questions"] = self._format_stretch_questions()
        all_vars["introduced_count"] = str(len(self.facts_introduced))
        all_vars["taught_count"] = str(len(self.facts_taught))
        all_vars["assessed_count"] = str(len(self.facts_assessed))
        all_vars["mastered_count"] = str(len(self.facts_mastered))
        all_vars["total_facts"] = str(self.total_facts)
        if extra_vars:
            all_vars.update(extra_vars)
        return Template(tmpl).safe_substitute(all_vars)

    def render_step_transition(self) -> Optional[str]:
        """Render the appropriate step transition prompt for the current state."""
        phase = self.current_phase
        ctx = self.state.get("teach_context")

        prompt_map = {
            "TEACH": "step_teach",
            "TRY": "step_try",
            "EVIDENCE": "step_evidence",
        }

        if phase == "TEACH":
            if ctx == "reteach":
                pid = "step_teach_reteach"
            elif ctx == "confused":
                pid = "step_teach_confused"
            elif ctx == "confirm":
                pid = "step_teach_continue"
            elif ctx == "continue":
                pid = "step_teach_continue"
            elif ctx == "example":
                pid = "step_teach_example"
            elif ctx == "explore":
                pid = "step_teach_explore"
            else:
                pid = "step_teach"
        elif phase == "TRY" and ctx == "retry":
            pid = "step_try_retry"
        elif phase == "EVIDENCE" and self.state.get("evidence_phase") == "RETRY":
            pid = "step_evidence_retry"
        else:
            pid = prompt_map.get(phase)

        if not pid:
            return None

        text = self.render_prompt(pid)  # render_prompt records last_rendered_prompt_id (A3)
        self.state["teach_context"] = None  # Clear after rendering
        return text

    # ------------------------------------------------------------------
    # Core state machine — process assessor result
    # ------------------------------------------------------------------

    def process_assessor_result(self, interaction_type: str,
                                student_message: Optional[str] = None) -> dict:
        """Process an assessor interaction_type through the state machine.

        student_message (ADO #28): the learner's raw text/transcript for this
        turn. Only consulted by the EVIDENCE substance guard. When None (legacy
        callers, tests) the guard is bypassed — every production path passes it.

        Returns dict with:
            state_changed: bool
            new_phase: str
            prompt_text: Optional[str] — step transition to inject
            action: str — what happened
        """
        self.state["message_count"] += 1
        phase = self.current_phase
        result = {"state_changed": False, "new_phase": phase,
                  "prompt_text": None, "action": "wait"}

        # Data-driven dispatch from _PHASE_HANDLERS (the same map the load-bearing
        # startup check validates against). Unknown phase -> keep the wait default.
        handler_name = self._PHASE_HANDLERS.get(phase)
        if handler_name:
            handler = getattr(self, handler_name)
            if phase == "EVIDENCE":
                if student_message is None:
                    log.warning("evidence guard bypassed: no student_message for "
                                "interaction_type=%s — caller must pass it in production",
                                interaction_type)
                result = handler(interaction_type, student_message)
            else:
                result = handler(interaction_type)

        # Render transition prompt if state changed
        if result.get("state_changed") and not result.get("prompt_text"):
            result["prompt_text"] = self.render_step_transition()

        # Add display position and reason for timeline logging (1-indexed for display)
        new_phase = result.get("new_phase", phase)
        if new_phase == "EVIDENCE":
            queue = self.state.get("evidence_queue", [])
            total_ev = len(self._facts)
            result["step_display_position"] = total_ev - len(queue) + 1
            result["step_display_total"] = total_ev
        else:
            result["step_display_position"] = self.state.get("scaffold_position", 0) + 1
            result["step_display_total"] = len(self.current_scaffold) if self.current_scaffold else 0
        result["reason"] = f"{interaction_type} during {phase} -> {result['action']}"

        try:
            from trace_logging import event as _ev
            fid = self.current_fact_id
            _ev("engine.transition",
                interaction_type=interaction_type,
                from_phase=phase, to_phase=result.get("new_phase"),
                action=result.get("action"),
                state_changed=result.get("state_changed", False),
                fact_id=fid, fact_text=self.current_fact_text,
                scaffold_position=self.state.get("scaffold_position"),
                step_display_position=result.get("step_display_position"),
                step_display_total=result.get("step_display_total"))
        except Exception:
            pass

        return result

    # ------------------------------------------------------------------
    # TEACH
    # ------------------------------------------------------------------

    def _process_teach(self, itype: str) -> dict:
        fid = self.current_fact_id
        fs = self.fact_status(fid)
        signal_fix = _flag("TEACH_SIGNAL_FIX")

        if itype == "student_understands":
            fs["teach_complete"] = True
            return self._advance_scaffold()

        if itype == "confirmation":
            fs["teach_complete"] = True
            return self._advance_scaffold()

        # ADO #26 A*: a substantive correct (or partially-correct) answer during
        # TEACH is a genuine understanding signal. Before this, such answers were
        # classified "teaching" -> "wait", so a kid who answered correctly never
        # advanced and the session camped in TEACH (0 facts mastered). The real
        # gate remains downstream at EVIDENCE.
        # Guard: EVIDENCE remediation reuses the TEACH phase but follows tiered
        # rules and a stale scaffold_position; a generic _advance_scaffold here
        # would fast-track a previously-FAILED fact toward MASTERED. During
        # remediation, let the tier logic own advancement (correct answers fall
        # through to "wait", the pre-A* behavior).
        if (signal_fix and itype in ("student_correct", "student_partially_correct")
                and self.state.get("evidence_phase") != "REMEDIATION"):
            fs["teach_complete"] = True
            return self._advance_scaffold()

        if itype == "student_confused":
            fs["teach_wait_turns"] = 0
            fs["teach_attempts"] += 1
            if fs["teach_attempts"] >= 3:
                return self._force_advance_scaffold()
            self.state["teach_context"] = "confused"
            return {"state_changed": True, "new_phase": "TEACH",
                    "prompt_text": self.render_prompt("step_teach_confused"),
                    "action": "reteach_confused"}

        if itype == "student_incorrect":
            fs["teach_wait_turns"] = 0
            self.state["teach_context"] = "confirm"
            return {"state_changed": True, "new_phase": "TEACH",
                    "prompt_text": self.render_prompt("step_teach_confirm"),
                    "action": "misconception_correction"}

        if itype == "student_move_on":
            return self._move_on_teach()

        if itype in ("student_wants_example", "student_wants_explore"):
            # Evidence remediation reuses TEACH but follows tiered rules
            # (LIGHT skips TRY) — detours would bypass the tier logic.
            if self.state.get("evidence_phase") == "REMEDIATION":
                return {"state_changed": False, "new_phase": "TEACH",
                        "prompt_text": None, "action": "wait"}
            if itype == "student_wants_example":
                return self._engagement_detour(fs, "example", "step_teach_example",
                                               "teach_example")
            return self._engagement_detour(fs, "explore", "step_teach_explore",
                                           "teach_explore")

        # teaching, student_question, off_topic — no transition. A lingering
        # example/explore context has served its turn; clear it so later
        # re-renders can't claim the student asked for a detour they didn't.
        if self.state.get("teach_context") in ("example", "explore"):
            self.state["teach_context"] = None

        # Genuine questions and off-topic turns are NOT camping — answer them
        # freely and never accrue them toward the diagnostic checkpoint. Only a
        # substantive non-advancing answer ("teaching") should count, so a
        # curious learner who keeps asking isn't shoved into a checkpoint.
        if itype in ("student_question", "off_topic"):
            return {"state_changed": False, "new_phase": "TEACH",
                    "prompt_text": None, "action": "wait"}

        # ADO #26 A*: bounded diagnostic guard against camping in TEACH. After
        # two consecutive non-advancing substantive turns, end ONE reply with a
        # single check-question (the only question TEACH allows) and route the
        # answer through the now-fixed gate. If a checkpoint already ran and we're
        # STILL not advancing, hand off to a guided TRY rather than re-teaching
        # forever — never a silent skip. Never fires during evidence remediation.
        if signal_fix and self.state.get("evidence_phase") != "REMEDIATION":
            if fs.get("teach_checkpoint_done"):
                fs["advance_reason"] = "camp_guided_try"  # audit: timed-out, not earned
                return self._guided_try()
            fs["teach_wait_turns"] = fs.get("teach_wait_turns", 0) + 1
            if fs["teach_wait_turns"] >= 2:
                fs["teach_checkpoint_done"] = True
                fs["teach_wait_turns"] = 0
                prompt = self.render_prompt("step_teach")
                prompt += (
                    "\n<CHECKPOINT>\n"
                    "You've explained this fact a couple of times now. End your reply with ONE "
                    "short, friendly check-question asking the student to apply or restate this "
                    "fact in their own words. This is the only question allowed during TEACH. "
                    "Keep it light and encouraging, not a quiz.\n"
                    "</CHECKPOINT>")
                return {"state_changed": True, "new_phase": "TEACH",
                        "prompt_text": prompt, "action": "teach_checkpoint"}

        return {"state_changed": False, "new_phase": "TEACH",
                "prompt_text": None, "action": "wait"}

    def _engagement_detour(self, fs: dict, context: str, prompt_id: str,
                           action: str) -> dict:
        """Engagement-chip detour within TEACH (ADO #26): worked example or
        stretch exploration. Capped at 2 combined detours per fact, after which
        the fact hands off to a guided TRY — never a silent advance."""
        fs["engagement_detours"] = fs.get("engagement_detours", 0) + 1
        if fs["engagement_detours"] > 2:
            return self._guided_try()
        self.state["teach_context"] = context
        extra = None
        if context == "explore":
            extra = {"stretch_questions": self._format_stretch_questions()}
        return {"state_changed": True, "new_phase": "TEACH",
                "prompt_text": self.render_prompt(prompt_id, extra),
                "action": action}

    def _guided_try(self) -> dict:
        """Detour cap reached: advance to TRY framed as doing one TOGETHER.
        Honors the student's request for another example instead of silently
        moving on (bot-enhancement spec: never silently move on)."""
        fs = self.fact_status()
        fs["teach_complete"] = True
        scaffold = self.current_scaffold
        pos = self.state["scaffold_position"]
        if "TRY" in scaffold[pos:]:
            self.state["scaffold_position"] = scaffold.index("TRY", pos)
            self.state["current_phase"] = "TRY"
            self.state["teach_context"] = None
            prompt = self.render_prompt("step_try")
            prompt += (
                "\n<GUIDED_TRY>\n"
                "The student asked to see more examples, and we've already explored a few. "
                "Acknowledge their curiosity warmly — it is a strength, not a problem. "
                "Then do this one TOGETHER: begin working the task yourself, showing the "
                "first step, and hand the final step to the student to complete. "
                "Never imply they did something wrong by asking for more examples.\n"
                "</GUIDED_TRY>")
            return {"state_changed": True, "new_phase": "TRY",
                    "prompt_text": prompt, "action": "engagement_guided_try"}
        return self._advance_fact()

    def _format_stretch_questions(self) -> str:
        """Bullet-format meta_data.stretch_questions for template injection.
        Raw lists would render as a Python repr through safe_substitute."""
        qs = self.current_fact_meta.get("stretch_questions") or []
        if isinstance(qs, str):
            qs = [qs]
        if not qs:
            return ("(none provided — invent one stretch question grounded in "
                    "this fact and the capsule theme)")
        return "\n".join(f"- {q}" for q in qs)

    # ------------------------------------------------------------------
    # TRY
    # ------------------------------------------------------------------

    def _process_try(self, itype: str) -> dict:
        fid = self.current_fact_id
        fs = self.fact_status(fid)

        # ADO #26 D: on-demand hint chip. Routes here as the student_wants_hint
        # pseudo-type. A hint scaffolds productive struggle: it does NOT count as
        # a try attempt and does NOT advance the fact, so the mastery signal stays
        # honest. Capped per fact (the chip is also withheld past the cap upstream).
        if itype == "student_wants_hint":
            if not _flag("TRY_HINT"):
                return {"state_changed": False, "new_phase": "TRY",
                        "prompt_text": None, "action": "wait"}
            if fs.get("hints_given", 0) >= 2:
                return {"state_changed": False, "new_phase": "TRY",
                        "prompt_text": None, "action": "hint_cap_reached"}
            # Render BEFORE consuming a hint: if step_try_hint isn't seeded yet
            # (code deployed ahead of the prompt script), never burn a hint on a
            # dead route — emit nothing and let the chip be withheld upstream too.
            extra = {"hint_number": str(fs.get("hints_given", 0) + 1)}
            prompt = self.render_prompt("step_try_hint", extra)
            if not prompt:
                return {"state_changed": False, "new_phase": "TRY",
                        "prompt_text": None, "action": "hint_unavailable"}
            fs["hints_given"] = fs.get("hints_given", 0) + 1
            return {"state_changed": True, "new_phase": "TRY",
                    "prompt_text": prompt, "action": "try_hint"}

        # Only count actual answer attempts, not questions/teaching/confirmation
        if itype in ("student_correct", "student_partially_correct", "student_incorrect"):
            fs["try_attempts"] += 1

        if itype == "student_correct":
            fs["try_complete"] = True
            return self._advance_fact()

        if itype == "student_partially_correct":
            if fs["try_attempts"] >= 2:
                # 2 partial attempts = close enough, accept and advance
                fs["try_complete"] = True
                return self._advance_fact()
            meta = self.current_fact_meta
            feedback_prompt = (
                f"<TRY_FEEDBACK>\n"
                f"  The student's answer was PARTIALLY correct.\n"
                f"  <FACT>{meta.get('core_fact', '')}</FACT>\n"
                f"  <WHAT_TO_DO>Acknowledge what they got right. Point out what's missing or incomplete. "
                f"Let them try again with a hint. Do NOT give the full answer.</WHAT_TO_DO>\n"
                f"</TRY_FEEDBACK>"
            )
            return {"state_changed": True, "new_phase": "TRY",
                    "prompt_text": feedback_prompt, "action": "feedback_reassess"}

        if itype == "student_incorrect":
            if fs["try_attempts"] >= 3:
                return self._force_advance_fact()
            if fs["try_attempts"] >= 2:
                # Reteach then retry
                self.state["current_phase"] = "TEACH"
                self.state["teach_context"] = "reteach"
                return {"state_changed": True, "new_phase": "TEACH",
                        "prompt_text": self.render_prompt("step_teach_reteach"),
                        "action": "try_reteach"}
            return {"state_changed": False, "new_phase": "TRY",
                    "prompt_text": None, "action": "hint_reassess"}

        if itype == "student_confused":
            self.state["current_phase"] = "TEACH"
            self.state["teach_context"] = "confused"
            return {"state_changed": True, "new_phase": "TEACH",
                    "prompt_text": self.render_prompt("step_teach_confused"),
                    "action": "try_confused_reteach"}

        if itype == "student_move_on":
            return self._move_on_try()

        # confirmation, student_question, off_topic — no transition, tutor handles in conversation
        return {"state_changed": False, "new_phase": "TRY",
                "prompt_text": None, "action": "wait"}

    # ------------------------------------------------------------------
    # EVIDENCE
    # ------------------------------------------------------------------

    # Pass-capable interaction types (can earn MASTERED) the substance guard
    # must screen. partially_correct in the NORMAL branch only sets up a
    # follow-up (grants nothing) so it is deliberately excluded there.
    _EVIDENCE_ANSWER_TYPES = ("student_correct", "student_partially_correct",
                              "student_incorrect", "student_confused")
    _PROBE_CLARIFY_TYPES = ("student_question", "confirmation",
                            "teaching", "off_topic")

    def _process_evidence(self, itype: str, student_message=None) -> dict:
        queue = self.state["evidence_queue"]
        if not queue:
            return self._complete_capsule()

        fid = queue[0]
        fs = self.fact_status(fid)
        ev_phase = self.state.get("evidence_phase") or "COLLECT"

        substantive = (student_message is None or is_substantive_response(
            student_message,
            [s.get("text", "") for s in self.state.get("last_suggestions", [])]))

        # A pending probe invites the student to elaborate. A clarifying
        # question / "huh?" back must NOT burn the fact to FAILED (the EVIDENCE
        # else-branch would) — re-issue the probe, no budget spent (ADO #28).
        if fs.get("evidence_probe_pending"):
            if itype in self._PROBE_CLARIFY_TYPES:
                return {"state_changed": True, "new_phase": "EVIDENCE",
                        "prompt_text": self.render_prompt("step_evidence_probe"),
                        "action": "evidence_probe_clarify"}
            # Any other reply resolves the probe; fall through to normal handling
            fs["evidence_probe_pending"] = False

        # Capture every answer-shaped turn as evidence audit trail
        if itype in self._EVIDENCE_ANSWER_TYPES:
            self._capture_evidence(fs, student_message, itype, substantive, ev_phase)

        # Follow-up pending: student got partially_correct last turn, this is their second chance
        if fs.get("evidence_followup"):
            if itype in ("student_correct", "student_partially_correct"):
                guard = self._evidence_substance_guard(fs, substantive)
                if guard is not None:
                    return guard  # probe/strikeout — evidence_followup preserved on probe
                fs["evidence_followup"] = False
                fs["evidence_result"] = "PASSED"
                fs["final_status"] = "MASTERED"
                self._mark_last_evidence_verified(fs, True)
                self.state["evidence_passed"].append(fid)
            elif itype == "student_move_on":
                # Forfeit stays an honest exit even mid-followup (was FAILED).
                fs["evidence_followup"] = False
                fs["final_status"] = "FORFEITED"
                self.state["forfeit_count"] += 1
            elif itype in self._PROBE_CLARIFY_TYPES:
                # Non-answer (question/confirmation/teaching/off_topic) during the
                # second-chance window: the tutor handles it in conversation. Do
                # NOT burn the fact or consume the follow-up — stay on it (ADO-89).
                # Mirrors the COLLECT/CHECK non-answer wait-guard.
                return {"state_changed": False, "new_phase": "EVIDENCE",
                        "prompt_text": None, "action": "wait"}
            else:
                fs["evidence_followup"] = False
                fs["evidence_result"] = "FAILED"
                self.state["evidence_failed"].append(fid)
            return self._evidence_advance_queue()

        # Normal evidence processing
        if itype == "student_correct":
            guard = self._evidence_substance_guard(fs, substantive)
            if guard is not None:
                return guard
            fs["evidence_result"] = "PASSED"
            fs["final_status"] = "MASTERED"
            self._mark_last_evidence_verified(fs, True)
            self.state["evidence_passed"].append(fid)
            return self._evidence_advance_queue()

        if itype == "student_move_on":
            fs["final_status"] = "FORFEITED"
            self.state["forfeit_count"] += 1
            return self._evidence_advance_queue()

        if itype == "student_partially_correct":
            # Spec 6.6: ONE follow-up. Stay on same fact, don't pop queue.
            fs["evidence_attempts"] = fs.get("evidence_attempts", 0) + 1
            fs["evidence_followup"] = True
            return {"state_changed": True, "new_phase": "EVIDENCE",
                    "prompt_text": self.render_prompt("step_evidence"),
                    "action": "evidence_followup"}

        if itype in ("student_incorrect", "student_confused"):
            fs["evidence_result"] = "FAILED"
            self.state["evidence_failed"].append(fid)
            return self._evidence_advance_queue()

        # Non-answer (question/confirmation/teaching/off_topic): the tutor
        # handles it in conversation; do NOT grade the fact or burn it to FAILED.
        # Stay on the same fact (no queue pop).
        return {"state_changed": False, "new_phase": "EVIDENCE",
                "prompt_text": None, "action": "wait"}

    def _capture_evidence(self, fs, student_message, itype, substantive, ev_phase):
        """Record the learner's produced evidence (ADO #28 audit trail). Capped
        at 10 entries/fact — the containing v6_engine_state blob is never pruned."""
        responses = fs.setdefault("evidence_responses", [])
        responses.append({
            "text": (student_message or "")[:500],
            "interaction_type": itype,
            "phase": ev_phase,
            "followup": bool(fs.get("evidence_followup")),
            "substantive": substantive,
            "verified": None,  # set True on PASS, False on probe strike-out
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        if len(responses) > 10:
            del responses[0:len(responses) - 10]

    @staticmethod
    def _mark_last_evidence_verified(fs, value):
        """Stamp the most recent captured evidence response's verified flag."""
        responses = fs.get("evidence_responses")
        if responses:
            responses[-1]["verified"] = value

    def _evidence_guard_active(self) -> bool:
        """The guard can only fire if the probe template is actually seeded.
        Check the raw registry (NOT render_prompt) so the existence test has no
        side effects: no warning spam every EVIDENCE turn during the seed-before-
        deploy window, and no clobbering of last_rendered_prompt_id (A3)."""
        return bool((self.prompts.get("step_evidence_probe") or {}).get("template"))

    def _evidence_substance_guard(self, fs, substantive):
        """No-Completion-Without-Evidence guard (ADO #28). Screens a pass-capable
        EVIDENCE turn: a bare "yes"/"I understand"/chip-click can't earn MASTERED.

        Returns None when the caller may grant mastery (substantive, or guard
        inactive). Otherwise returns a probe dict (≤2 probes in COLLECT, 1 in
        RETRY) or, once probes are spent, a strike-out that advances the queue
        with final_status=PARTIAL_MASTERY — NEVER into remediation (re-teaching a
        learner who answered correctly violates Diagnostic-Before-Reteach)."""
        if substantive:
            return None
        # Seed lag: no probe template -> guard inactive, treat as substantive so
        # we never hold the queue with no instruction the student can act on.
        # Log it DISTINCTLY (not the generic missing-template warning) because the
        # grading consequence is "unverified mastery granted" — operators must be
        # able to tell a not-yet-seeded prod from a broken template.
        if not self._evidence_guard_active():
            log.warning("EVIDENCE GUARD INACTIVE: step_evidence_probe not seeded — "
                        "granting mastery for fact %s without a substance check. "
                        "Run scripts/apply_evidence_guard_prompts.py.",
                        self.current_fact_id)
            return None
        probe_text = self.render_prompt("step_evidence_probe")  # render once, reuse
        cap = 1 if self.state.get("evidence_phase") == "RETRY" else 2
        if fs.get("evidence_probe_count", 0) < cap:
            fs["evidence_probe_count"] = fs.get("evidence_probe_count", 0) + 1
            fs["evidence_probe_pending"] = True
            return {"state_changed": True, "new_phase": "EVIDENCE",
                    "prompt_text": probe_text, "action": "evidence_probe"}
        # Probes exhausted — strike out to PARTIAL_MASTERY, mark unverified.
        fs["evidence_probe_pending"] = False
        fs["final_status"] = "PARTIAL_MASTERY"
        self._mark_last_evidence_verified(fs, False)
        # ADO #74: capture the fact being graded BEFORE the queue advances.
        # _evidence_advance_queue() pops and repoints current_fact to the NEXT
        # fact, so the V6_TRANSITION telemetry (web_ui) would otherwise attribute
        # this hollow outcome to the wrong fact. Carrying the graded fact lets the
        # engagement view + analyze_session count the strike-out as a gate FAIL
        # instead of mislabeling the chip/typed advance "solid".
        struck_fact_text = self.current_fact_text
        result = self._evidence_advance_queue()
        result["strikeout_fact"] = struck_fact_text
        return result

    def has_pending_evidence_probe(self) -> bool:
        """True when the current EVIDENCE fact is awaiting a probe answer. Durable
        (engine state), unlike the per-turn _last_engine_action — so the
        compliance-correction suppression still holds on a turn where the engine
        didn't run (e.g. a garbled voice transcript with no fact_discussed)."""
        if self.current_phase != "EVIDENCE":
            return False
        queue = self.state.get("evidence_queue") or []
        if not queue:
            return False
        return bool(self.fact_status(queue[0]).get("evidence_probe_pending"))

    def _evidence_advance_queue(self) -> dict:
        """Pop current fact from evidence queue and advance or finish."""
        queue = self.state["evidence_queue"]
        # The fact being resolved this turn counts as one evidence attempt
        # (probe/clarify turns return earlier and never reach here — ADO #28).
        if queue:
            self.fact_status(queue[0])["evidence_attempts"] = \
                self.fact_status(queue[0]).get("evidence_attempts", 0) + 1
        queue.pop(0)
        if not queue:
            if self.state["evidence_phase"] == "RETRY":
                # Retry done. Any remaining failures -> PARTIAL_MASTERY. Complete.
                for fid in self.state["evidence_failed"]:
                    fs = self.fact_status(fid)
                    fs["final_status"] = "PARTIAL_MASTERY"
                return self._complete_capsule()
            if self.state["evidence_failed"]:
                return self._evidence_remediate()
            return self._complete_capsule()
        self._set_current_to_fact(queue[0])
        prompt_id = "step_evidence_retry" if self.state.get("evidence_phase") == "RETRY" else "step_evidence"
        return {"state_changed": True, "new_phase": "EVIDENCE",
                "prompt_text": self.render_prompt(prompt_id),
                "action": "evidence_next"}

    def _evidence_remediate(self) -> dict:
        """Tiered evidence remediation per v6 spec.

        Determines tier, then for each failed fact:
          LIGHT:    re-teach (stretch) only
          MODERATE: re-teach (stretch) + TRY
          HEAVY:    re-teach (stretch) + TRY
        After remediation: _evidence_retry on failed facts only. Max 2 attempts. No loops.
        (Re-teach reuses the step_check_remediation prompt template — a re-teach
        script, not the removed CHECK phase.)
        """
        failed = self.state["evidence_failed"]
        total = self.total_facts
        rate = len(failed) / total if total > 0 else 0

        if rate <= 0.2:
            tier = "LIGHT"
        elif rate <= 0.4:
            tier = "MODERATE"
        else:
            tier = "HEAVY"

        self.state["evidence_phase"] = "REMEDIATION"
        self.state["evidence_remediation_tier"] = tier
        self.state["evidence_remediation_queue"] = list(failed)
        self.state["evidence_remediation_index"] = 0

        log.info("Evidence remediation tier=%s, failed=%d/%d", tier, len(failed), total)

        # Start remediating the first failed fact
        self._set_current_to_fact(failed[0])

        if tier == "LIGHT":
            # LIGHT: re-teach with stretch angle only, then evidence retry
            self.state["current_phase"] = "TEACH"
            self.state["teach_context"] = "reteach"
            return {"state_changed": True, "new_phase": "TEACH",
                    "prompt_text": self.render_prompt("step_check_remediation"),
                    "action": f"evidence_remediation_{tier}"}
        else:
            # MODERATE/HEAVY: re-teach, then TRY (before the evidence retry)
            self.state["current_phase"] = "TEACH"
            self.state["teach_context"] = "reteach"
            return {"state_changed": True, "new_phase": "TEACH",
                    "prompt_text": self.render_prompt("step_check_remediation"),
                    "action": f"evidence_remediation_{tier}"}

    def _evidence_remediation_advance(self) -> dict:
        """Advance to next fact in remediation queue, or start evidence retry."""
        queue = self.state.get("evidence_remediation_queue", [])
        idx = self.state.get("evidence_remediation_index", 0) + 1
        self.state["evidence_remediation_index"] = idx

        if idx < len(queue):
            fid = queue[idx]
            self._set_current_to_fact(fid)
            self.state["current_phase"] = "TEACH"
            self.state["teach_context"] = "reteach"
            return {"state_changed": True, "new_phase": "TEACH",
                    "prompt_text": self.render_prompt("step_check_remediation"),
                    "action": "evidence_remediation_next"}

        # All failed facts remediated -> evidence retry on failed facts only
        return self._evidence_retry()

    def _evidence_retry(self) -> dict:
        """Retry EVIDENCE on failed facts only. Max 2 attempts per fact.
        Pass -> MASTERED. Fail -> PARTIAL_MASTERY. No further loops."""
        failed = self.state["evidence_failed"]
        self.state["evidence_phase"] = "RETRY"
        self.state["evidence_queue"] = list(failed)
        self.state["evidence_failed"] = []  # Reset for retry tracking
        self.state["current_phase"] = "EVIDENCE"

        # ADO #28: a remediated fact earns one fresh probe in RETRY (cap=1) so a
        # genuinely-failed-then-retaught learner still has a path to MASTERED.
        for fid in failed:
            fs = self.fact_status(fid)
            fs["evidence_probe_count"] = 0
            fs["evidence_probe_pending"] = False

        if failed:
            self._set_current_to_fact(failed[0])

        return {"state_changed": True, "new_phase": "EVIDENCE",
                "prompt_text": self.render_prompt("step_evidence_retry"),
                "action": "evidence_retry_start"}

    # ------------------------------------------------------------------
    # RECALL
    # ------------------------------------------------------------------

    def _process_recall(self, itype: str) -> dict:
        # Engagement chip: student asked for more recall — allow up to 2 extra
        # warm-up turns so recall doesn't eat the session (ADO #26)
        if itype == "recall_more" and self.state.get("recall_turns", 0) < 2:
            self.state["recall_turns"] = self.state.get("recall_turns", 0) + 1
            return {"state_changed": True, "new_phase": "RECALL",
                    "prompt_text": self.render_prompt("step_recall_engage"),
                    "action": "recall_engage"}
        # Otherwise advance — no re-teaching
        return self._transition_to_teach()

    # ------------------------------------------------------------------
    # Scaffold progression
    # ------------------------------------------------------------------

    def _advance_scaffold(self) -> dict:
        """Advance within the current fact's scaffold."""
        self.state["scaffold_position"] += 1
        scaffold = self.current_scaffold
        pos = self.state["scaffold_position"]

        if pos >= len(scaffold):
            return self._advance_fact()

        step = scaffold[pos]
        if step == "TRY":
            # LIGHT remediation: skip TRY, go straight to next remediation fact
            if self.state.get("evidence_phase") == "REMEDIATION" and \
               self.state.get("evidence_remediation_tier") == "LIGHT":
                return self._evidence_remediation_advance()
            self.state["current_phase"] = "TRY"
            self.state["teach_context"] = None
            return {"state_changed": True, "new_phase": "TRY",
                    "prompt_text": self.render_prompt("step_try"),
                    "action": "scaffold_to_try"}

        # Another TEACH position
        self.state["current_phase"] = "TEACH"
        self.state["teach_context"] = "continue"
        return {"state_changed": True, "new_phase": "TEACH",
                "prompt_text": self.render_prompt("step_teach_continue",
                                                  {"is_same_fact": "true"}),
                "action": "scaffold_teach_continue"}

    def _force_advance_scaffold(self) -> dict:
        """Force advance past current scaffold position (max reteach exceeded)."""
        return self._advance_scaffold()

    def _fact_is_complete(self, fid: str,
                          treat_current_as_incomplete: bool = False) -> bool:
        """True when a fact needs no more TEACH->TRY: its scaffold finished (or
        was skipped) this-or-a-prior session, or it was already graded at
        EVIDENCE. Legacy blobs from before scaffold_complete existed (v006.10-)
        fall back to teach-confirmed + attempted — except for the CURRENT fact,
        which may be mid-scaffold and must stay resumable."""
        fs = self.state.get("fact_statuses", {}).get(fid, {})
        if (fs.get("scaffold_complete") or fs.get("final_status")
                or fs.get("evidence_result")):
            return True
        if treat_current_as_incomplete and fid == self.current_fact_id:
            return False
        return bool(fs.get("teach_complete") and fs.get("try_attempts", 0) >= 1)

    def _first_incomplete_index(self) -> Optional[int]:
        """Index (display order) of the first fact still needing TEACH->TRY.
        Display order is authoritative — this is what heals facts that older
        engine versions skipped past."""
        for i, f in enumerate(self._facts):
            if not self._fact_is_complete(f["id"], treat_current_as_incomplete=True):
                return i
        return None

    def remaining_fact_texts(self) -> list:
        """Texts of facts still needing TEACH->TRY — the single source of
        truth for what the tutor should teach next. The engine's CURRENT fact
        comes first (an explicit start-session selection may point past
        earlier incomplete facts); the rest follow in display order."""
        cur = self.current_fact_id
        out = []
        if cur and cur in self._fact_map and not self._fact_is_complete(
                cur, treat_current_as_incomplete=True):
            out.append(self._fact_map[cur]["text"])
        out.extend(f["text"] for f in self._facts
                   if f["id"] != cur
                   and not self._fact_is_complete(f["id"],
                                                  treat_current_as_incomplete=True))
        return out

    def start_at_fact(self, fact_id: str) -> bool:
        """Explicit session-start override from the start-session screen:
        position this session's one-fact run on fact_id, with fresh counters.
        Refused (False) outside teaching mode, for unknown facts, and for
        facts already complete — completed facts are unselectable in the UI,
        so a stale selection quietly falls back to the healed position."""
        if (self.current_phase not in ("TEACH", "TRY")
                or self.state.get("evidence_phase")):
            return False
        if fact_id not in self._fact_map:
            return False
        if self._fact_is_complete(fact_id):
            return False
        self._set_current_to_fact(fact_id)
        self.state["scaffold_position"] = 0
        self.state["current_phase"] = "TEACH"
        self.state["teach_context"] = None
        fs = self.state["fact_statuses"].setdefault(fact_id, {})
        fs["teach_attempts"] = 0
        fs["try_attempts"] = 0
        fs["teach_wait_turns"] = 0
        fs["hints_given"] = 0
        return True

    def _advance_fact(self) -> dict:
        """The current fact's TEACH->TRY is done (passed, accepted after
        retries, or skipped). v006.11: ONE FACT PER SESSION — mark it complete,
        END the session, and prime the next incomplete fact in display order
        (so previously skipped facts are picked back up next session). When no
        facts remain, prime the final EVIDENCE instead (v006.10 behavior)."""
        # During evidence remediation, advance through the remediation queue
        if self.state.get("evidence_phase") == "REMEDIATION":
            return self._evidence_remediation_advance()

        fid = self.current_fact_id
        if fid:
            fs = self.state["fact_statuses"].setdefault(fid, {})
            fs["scaffold_complete"] = True
            # A completed scaffold IS taught. teach_complete is otherwise only
            # set by an explicit TEACH confirmation — a student who jumped to
            # practice via move_on/"let me try" and then passed TRY finished
            # the fact without it, which left facts_taught (and therefore the
            # report-card is_taught sync, progress bars, and start-session
            # pills) blind to the completion.
            fs["teach_complete"] = True

        nxt = self._first_incomplete_index()
        if nxt is None:
            # Every fact done -> EVIDENCE runs in its own follow-up session
            return self._end_session_after_practice()

        next_fid = self._facts[nxt]["id"]
        self._set_current_to_fact(next_fid)
        self.state["scaffold_position"] = 0
        self.state["current_phase"] = "TEACH"
        self.state["teach_context"] = None
        self.state["fact_statuses"].setdefault(next_fid, {})["teach_attempts"] = 0
        self.state["practice_complete_end"] = True
        prompt = ""
        if "step_fact_complete" in self.prompts:
            prompt = self.render_prompt("step_fact_complete")
        if not prompt:
            prompt = Template(
                "The student has just finished practicing this fact — that "
                "completes today's session. Warmly congratulate them on what "
                "they just learned and let them know the session is wrapping "
                "up now; next time they'll learn: \"$next_fact\". Do NOT "
                "introduce new material and do NOT ask a question."
            ).safe_substitute({**self._render_base,
                               "next_fact": self._facts[nxt]["text"]})
        return {"state_changed": True, "new_phase": "TEACH",
                "prompt_text": prompt,
                "action": "fact_complete_end"}

    def _force_advance_fact(self) -> dict:
        """Force advance to next fact (TRY failure after max attempts)."""
        return self._advance_fact()

    def _prime_evidence_state(self):
        """Put the engine in EVIDENCE COLLECT with a fresh full-capsule queue."""
        self.state["current_phase"] = "EVIDENCE"
        self.state["evidence_phase"] = "COLLECT"
        self.state["evidence_queue"] = [f["id"] for f in self._facts]
        self.state["evidence_passed"] = []
        self.state["evidence_failed"] = []
        if self._facts:
            self._set_current_to_fact(self._facts[0]["id"])

    def _start_evidence(self) -> dict:
        """Start EVIDENCE for all facts in capsule."""
        self._prime_evidence_state()
        return {"state_changed": True, "new_phase": "EVIDENCE",
                "prompt_text": self.render_prompt("step_evidence"),
                "action": "start_evidence"}

    def _end_session_after_practice(self) -> dict:
        """Every fact has finished its TEACH->TRY scaffold. Prime EVIDENCE for
        the next session and end this one (should_end_session -> True). The
        wrap-up prompt tells the tutor to close out, not ask a new question;
        restore() clears the end flag so the next session resumes in EVIDENCE
        instead of instantly ending."""
        self._prime_evidence_state()
        self.state["practice_complete_end"] = True
        # Prefer a registry template so the wording stays tutor-editable; the
        # hardcoded fallback keeps the transition functional before the
        # registry learns the new id (missing template renders "").
        prompt = ""
        if "step_practice_complete" in self.prompts:
            prompt = self.render_prompt("step_practice_complete")
        if not prompt:
            prompt = Template(
                "The student has just finished practicing the final fact of "
                "'$capsule_name'. Warmly congratulate them on completing all "
                "the learning and practice for this capsule, briefly celebrate "
                "what they covered, and let them know today's session is "
                "wrapping up — next time they'll show what they've learned in "
                "one final check. Do NOT ask a new question and do NOT "
                "introduce any new material."
            ).safe_substitute(self._render_base)
        return {"state_changed": True, "new_phase": "EVIDENCE",
                "prompt_text": prompt,
                "action": "practice_complete_end"}

    # ------------------------------------------------------------------
    # Move-on / Forfeit
    # ------------------------------------------------------------------

    def _move_on_teach(self) -> dict:
        """Move-on during TEACH: free, skip to TRY or next fact."""
        scaffold = self.current_scaffold
        pos = self.state["scaffold_position"]
        remaining = scaffold[pos:]
        if "TRY" in remaining:
            idx = scaffold.index("TRY", pos)
            self.state["scaffold_position"] = idx
            self.state["current_phase"] = "TRY"
            return {"state_changed": True, "new_phase": "TRY",
                    "prompt_text": self.render_prompt("step_try"),
                    "action": "move_on_teach_to_try"}
        return self._advance_fact()

    def _move_on_try(self) -> dict:
        """Move-on during TRY: noted, advance to the next fact (the fact still
        faces the final EVIDENCE step)."""
        return self._advance_fact()

    # ------------------------------------------------------------------
    # Capsule completion
    # ------------------------------------------------------------------

    def _complete_capsule(self) -> dict:
        """All facts resolved — capsule complete."""
        self.state["current_phase"] = "CAPSULE_COMPLETE"

        # Set final_status for facts without one. ADO #28: MASTERED is granted
        # ONLY on evidence_result == "PASSED". A fact reaching completion with no
        # recorded evidence (empty-queue completion, restored-legacy blob, or a
        # bug) is NOT mastery — default to PARTIAL_MASTERY and log it loudly.
        for fid, fs in self.state["fact_statuses"].items():
            if not fs.get("final_status"):
                if fs.get("evidence_result") == "PASSED":
                    fs["final_status"] = "MASTERED"
                elif fs.get("evidence_result") == "FAILED":
                    fs["final_status"] = "PARTIAL_MASTERY"
                else:
                    fs["final_status"] = "PARTIAL_MASTERY"
                    log.warning("capsule complete with no evidence_result for "
                                "fact %s — defaulting to PARTIAL_MASTERY "
                                "(no mastery without evidence)", fid)

        statuses = [fs.get("final_status") for fs in self.state["fact_statuses"].values()]
        if all(s == "MASTERED" for s in statuses):
            status = "FULLY_MASTERED"
        else:
            status = "COMPLETED_WITH_GAPS"

        # ADO #26: completion offers a genuine closure choice (recap / end)
        # instead of ending the session on the spot. should_end_session()
        # stays False until the student answers (closure_ended).
        self.state["closure_state"] = "offered"
        return {"state_changed": True, "new_phase": "CAPSULE_COMPLETE",
                "prompt_text": self.render_prompt("step_capsule_closure"),
                "action": status}

    # While the closure choice is open, typed replies must not silently end
    # the session: most students TYPE ("yes recap please") rather than click,
    # and the assessor maps those to ordinary types. Anything that is not an
    # explicit end leans recap; only one recap is given (turn cap), after
    # which any reply ends.
    _CLOSURE_END_TYPES = ("closure_end", "student_move_on")

    def _process_closure(self, itype: str) -> dict:
        """Handle the student's closure choice after capsule completion."""
        if (self.state.get("closure_state") == "offered"
                and itype not in self._CLOSURE_END_TYPES):
            self.state["closure_state"] = "recap_done"
            return {"state_changed": True, "new_phase": "CAPSULE_COMPLETE",
                    "prompt_text": self.render_prompt("step_capsule_closure_recap"),
                    "action": "closure_recap"}
        self.state["closure_ended"] = True
        return {"state_changed": True, "new_phase": "CAPSULE_COMPLETE",
                "prompt_text": None, "action": "closure_end"}

    def _transition_to_teach(self) -> dict:
        self.state["current_phase"] = "TEACH"
        self.state["teach_context"] = None
        return {"state_changed": True, "new_phase": "TEACH",
                "prompt_text": self.render_prompt("step_teach"),
                "action": "transition_to_teach"}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _set_current_to_fact(self, fact_id: str):
        """Set current_fact_index to point to fact_id in the current batch."""
        batch = self.current_batch
        if fact_id in batch:
            self.state["current_fact_index"] = batch.index(fact_id)
        else:
            # Fact might be in a different batch (evidence remediation)
            for bi, b in enumerate(self._batches):
                if fact_id in b:
                    self.state["current_batch_index"] = bi
                    self.state["current_fact_index"] = b.index(fact_id)
                    return

    def to_knowledge_points(self) -> dict:
        """Export state as legacy knowledge_points dict for backward compat."""
        # Build fact_exposures from teach_attempts + try_attempts + check + evidence
        fact_exposures = {}
        for fid, fs in self.state.get("fact_statuses", {}).items():
            if fid in self._fact_map:
                text = self._fact_map[fid]["text"]
                exposures = fs.get("teach_attempts", 0) + fs.get("try_attempts", 0)
                exposures += fs.get("evidence_attempts", 0)
                fact_exposures[text] = exposures

        kp = {
            "facts_introduced": self.facts_introduced,
            "facts_taught": self.facts_taught,
            "facts_assessed": self.facts_assessed,
            "facts_mastered": self.facts_mastered,
            "total_facts": self.total_facts,
            "current_fact": self.current_fact_text,
            "current_fact_index": self.state.get("current_fact_index", 0) + 1,
            "batch_index": self.state.get("current_batch_index", 0),
            "batch_step": "TEACH_TRY",
            "batches": [[self._fact_map[fid]["text"] for fid in b if fid in self._fact_map]
                        for b in self._batches],
            "fact_exposures": fact_exposures,
            "fact_steps": {},
        }
        return kp

    # ------------------------------------------------------------------
    # Edge case handling
    # ------------------------------------------------------------------

    def should_end_session(self) -> bool:
        """Session ends after capsule completion AND the student has answered
        the closure prompt (ADO #26 deferred end). Back-compat: state dicts
        from before the closure flow have no closure_state and end immediately.

        v006.10: also ends immediately after the last fact's practice —
        _end_session_after_practice sets practice_complete_end and restore()
        clears it, so the flag only fires in the session that finished TRY."""
        if self.state.get("practice_complete_end"):
            return True
        if self.current_phase != "CAPSULE_COMPLETE":
            return False
        if self.state.get("closure_state") is None:
            return True  # completed without a closure offer (legacy path)
        return bool(self.state.get("closure_ended"))

    def is_capsule_complete(self) -> bool:
        return self.current_phase == "CAPSULE_COMPLETE"

    def can_forfeit(self) -> bool:
        """Check if student can forfeit (hasn't hit limit)."""
        return self.state["forfeit_count"] < self.state["forfeit_limit"]

    def forfeit_approaching_limit(self) -> bool:
        return self.state["forfeit_count"] == self.state["forfeit_limit"] - 1

    # ------------------------------------------------------------------
    # State serialization (for DB persistence / session resume)
    # ------------------------------------------------------------------

    def serialize(self) -> dict:
        """Serialize the full engine state for DB storage."""
        return {
            "state": self.state,
            "facts": [{"id": f["id"], "text": f["text"],
                        "meta": f["meta"], "scaffold": f["scaffold"]}
                       for f in self._facts],
            "batches": self._batches,
        }

    def restore(self, saved: dict):
        """Restore engine state from DB. Call instead of init_session."""
        self.state = saved["state"]
        self.state["message_count"] = 0  # New session, reset counter
        # Ensure new fields exist from older saves (pre-ADO-#26 blobs)
        self.state.setdefault("last_suggestions", [])
        self.state.setdefault("last_offered_intents", [])   # ADO #26 C*
        self.state.setdefault("chip_rotation_index", 0)     # ADO #26 C*
        self.state.setdefault("recall_turns", 0)
        self.state.setdefault("closure_state", None)
        self.state.setdefault("closure_ended", False)
        # v006.10: the after-practice end flag belongs to the session that
        # finished TRY. A restored session must NOT re-end on turn one — it
        # resumes in EVIDENCE and runs the final check.
        self.state["practice_complete_end"] = False
        # v006.9: CHECK/CHECK_REMEDIATION were removed. A session saved mid-CHECK
        # has no dispatch handler anymore, so process_assessor_result would
        # silently return "wait" every turn and strand the student. Land such a
        # blob back in TEACH for the current batch — it re-teaches and then flows
        # TEACH->TRY->...->EVIDENCE as normal. Same back-compat spirit as the
        # setdefault migrations above.
        if self.state.get("current_phase") in ("CHECK", "CHECK_REMEDIATION"):
            self.state["current_phase"] = "TEACH"
            self.state["current_fact_index"] = 0
            self.state["scaffold_position"] = 0
            self.state["teach_context"] = None
            self.state.pop("in_check_remediation", None)
        # Ensure new fields exist in fact_statuses from older saves
        for fid, fs in self.state.get("fact_statuses", {}).items():
            fs.setdefault("evidence_attempts", 0)
            fs.setdefault("evidence_followup", False)
            fs.setdefault("evidence_probe_count", 0)        # ADO #28
            fs.setdefault("evidence_probe_pending", False)  # ADO #28
            fs.setdefault("evidence_responses", [])         # ADO #28
            fs.setdefault("engagement_detours", 0)
            fs.setdefault("teach_wait_turns", 0)            # ADO #26 A*
            fs.setdefault("teach_checkpoint_done", False)   # ADO #26 A*
            fs.setdefault("hints_given", 0)                 # ADO #26 D
            fs.setdefault("scaffold_complete", False)       # v006.11
        self._facts = saved.get("facts", [])
        self._batches = saved.get("batches", [])
        self._fact_map = {}
        for f in self._facts:
            self._fact_map[f["id"]] = f

        # v006.11 heal: in teaching mode, always resume at the FIRST incomplete
        # fact in display order. Older engine versions could carry a position
        # past facts that were skipped or never finished, which made teaching
        # look out-of-order and left permanent holes in the capsule.
        if (self._facts
                and self.state.get("current_phase") in ("TEACH", "TRY")
                and not self.state.get("evidence_phase")):
            idx = self._first_incomplete_index()
            if idx is None:
                # Everything already practiced -> this session is the final check
                self._prime_evidence_state()
            else:
                # A new session is always a FRESH run of its fact: land at
                # TEACH with attempt counters reset, even when the position
                # doesn't move. Resuming a stale mid-TRY save graded the
                # student's first (recap-flavored) reply as a TRY answer, and
                # carried-over try_attempts meant one partial answer hit the
                # "2 attempts = accept" rule — completing the fact and ending
                # the session in a single turn.
                fid = self._facts[idx]["id"]
                self._set_current_to_fact(fid)
                self.state["scaffold_position"] = 0
                self.state["current_phase"] = "TEACH"
                self.state["teach_context"] = None
                fs = self.state["fact_statuses"].setdefault(fid, {})
                fs["teach_attempts"] = 0
                fs["try_attempts"] = 0
                fs["teach_wait_turns"] = 0
                fs["hints_given"] = 0

        # Phase 3a (ADO-87): validate on the resume path too, so a restore-only
        # construction (replay/admin tools) can't bypass the guardrail. No-op
        # after the first validation in this process.
        _maybe_validate_contract(self)

    # ------------------------------------------------------------------
    # Report card building
    # ------------------------------------------------------------------

    def build_report(self) -> dict:
        """Build the v6 report card for this capsule."""
        statuses = self.state.get("fact_statuses", {})
        total = len(statuses)
        mastered = sum(1 for fs in statuses.values() if fs.get("final_status") == "MASTERED")
        partial = sum(1 for fs in statuses.values() if fs.get("final_status") == "PARTIAL_MASTERY")
        forfeited = sum(1 for fs in statuses.values() if fs.get("final_status") == "FORFEITED")

        return {
            "capsule_id": self.state.get("capsule_id", ""),
            "status": "FULLY_MASTERED" if mastered == total else
                      "COMPLETED_WITH_GAPS" if self.is_capsule_complete() else "IN_PROGRESS",
            "summary": {
                "total_facts": total,
                "mastered": mastered,
                "partial_mastery": partial,
                "forfeited": forfeited,
                "mastery_percentage": round(mastered / total * 100, 1) if total > 0 else 0,
            },
            "fact_statuses": statuses,
        }
