"""Engagement-monitoring outcome walk (ADO #26 dashboard).

Pure, DB-free analysis of a session's ordered telemetry events (rows shaped like
the `v_engagement_events` view). Separates genuine engagement from compliance
theatre by correlating *how a student advanced past TEACH* (clicked a ready/
continue chip vs typed an understanding) against the fact's eventual **CHECK or
EVIDENCE gate** outcome.

Crucially, a stumble at TRY (practice) is the healthy learning loop, NOT misuse —
only the mastery gates (CHECK/EVIDENCE) decide hollow vs solid. A fact that never
reaches a gate in-session is `inconclusive`, never silently counted as success.

The aggregates that don't need ordering (CTR, intent distribution, fallback,
compliance) are computed in SQL over the view; this module owns only the
outcome correlation that needs a per-session ordered walk.
"""

GATE_PHASES = ("CHECK", "EVIDENCE")
_READY_INTENTS = ("ready", "continue")
_GATE_FAIL_TYPES = ("student_incorrect", "student_confused",
                    "student_partially_correct", "student_move_on")
_DETOUR_ACTIONS = ("teach_example", "teach_explore")


def _empty_buckets():
    return {"hollow": 0, "solid": 0, "inconclusive": 0}


def analyze_session(events):
    """Walk one session's ordered events → per-fact and per-cohort outcomes.

    `events`: list of dicts with keys step, fact, intent, hit, phase,
    interaction_type, action, strikeout_fact (extra keys ignored). Assumed in
    chronological order.

    Returns: {
      "chip":  {hollow, solid, inconclusive},      # ready/continue-chip cohort
      "typed": {hollow, solid, inconclusive},      # typed-understanding cohort
      "per_fact": {fact: {advance_kind, outcome, detours}},
      "overuse": {detours_before_fail, detours_before_mastery, guided_try_fires},
    }
    """
    advance_kind = {}     # fact -> "chip" | "typed" (chip wins ties)
    gate_outcome = {}     # fact -> "pass" | "fail" (last gate wins)
    detours = {}          # fact -> int (example/explore detours)
    guided_try_fires = 0
    current_fact = None

    for e in events:
        step = e.get("step")
        fact = e.get("fact") or None
        if fact:
            current_fact = fact

        if step == "CHIP_MATCH":
            # Only a TEACH ready/continue click is an "I understood this fact"
            # advance. The same intents in RECALL mean "skip recall / start new
            # content" — not a TEACH-understanding signal — so an explicit
            # non-TEACH phase is excluded. phase is None on pre-enrichment
            # historical events: counted best-effort (ready only ever appeared
            # in TEACH).
            if (e.get("hit") and e.get("intent") in _READY_INTENTS
                    and e.get("phase") in ("TEACH", None)):
                f = fact or current_fact
                if f:
                    advance_kind[f] = "chip"   # chip is the specific signal — wins
        elif step == "ASSESSMENT":
            itype = e.get("interaction_type")
            phase = e.get("phase")
            f = fact or current_fact
            if not f:
                continue
            if phase in GATE_PHASES:
                gate_outcome[f] = "fail" if itype in _GATE_FAIL_TYPES else "pass"
            elif itype == "student_understands":
                advance_kind.setdefault(f, "typed")   # don't override a chip advance
        elif step == "V6_TRANSITION":
            action = e.get("action")
            # ADO #74: an evidence-guard strike-out advances on a PASS-graded turn,
            # so the ASSESSMENT just above (mis)recorded this fact as a gate pass.
            # The strike-out is the authoritative "no substantive evidence" signal,
            # so force the gate to fail — overriding the spurious pass — and count
            # the chip/typed advance as hollow. Keyed by the GRADED fact carried on
            # the event (not current_fact: the engine already advanced past it).
            sf = e.get("strikeout_fact")
            if sf:
                gate_outcome[sf] = "fail"
            if action == "engagement_guided_try":
                guided_try_fires += 1
            elif action in _DETOUR_ACTIONS:
                f = fact or current_fact
                if f:
                    detours[f] = detours.get(f, 0) + 1

    chip = _empty_buckets()
    typed = _empty_buckets()
    per_fact = {}
    detours_before_fail = 0
    detours_before_mastery = 0

    for f, kind in advance_kind.items():
        g = gate_outcome.get(f)
        outcome = "inconclusive" if g is None else ("hollow" if g == "fail" else "solid")
        (chip if kind == "chip" else typed)[outcome] += 1
        per_fact[f] = {"advance_kind": kind, "outcome": outcome,
                       "detours": detours.get(f, 0)}

    # Overuse: detours that preceded a failed vs mastered gate (a detour is the
    # success case when curiosity still ends in mastery).
    for f, n in detours.items():
        if n <= 0:
            continue
        g = gate_outcome.get(f)
        if g == "fail":
            detours_before_fail += 1
        elif g == "pass":
            detours_before_mastery += 1

    return {
        "chip": chip,
        "typed": typed,
        "per_fact": per_fact,
        "overuse": {
            "detours_before_fail": detours_before_fail,
            "detours_before_mastery": detours_before_mastery,
            "guided_try_fires": guided_try_fires,
        },
    }


def aggregate(sessions_events):
    """Convenience: walk each session then fold. Equivalent to
    aggregate_results([analyze_session(s) for s in sessions_events])."""
    return aggregate_results([analyze_session(s) for s in sessions_events])


def segment_totals(results):
    """Cheap per-segment roll-up from already-walked results — only the three
    fields by_segment needs, so we never re-sort worst_facts per segment."""
    hollow = solid = ready_clicks = 0
    for r in results:
        c = r["chip"]
        hollow += c["hollow"]
        solid += c["solid"]
        ready_clicks += c["hollow"] + c["solid"] + c["inconclusive"]
    decided = hollow + solid
    return {
        "ready_clicks": ready_clicks,
        "hollow_rate": round(hollow / decided, 3) if decided else None,
        "hollow_n": decided,
    }


def aggregate_results(results):
    """Fold a list of per-session `analyze_session` outputs into totals + a
    worst_facts table (sorted by volume×hollow-rate so a 1-of-2 fact is not
    surfaced above a 30-of-200 one). Accepting pre-walked results lets callers
    reuse one walk for both the overall and per-segment roll-ups.
    """
    totals = {
        "chip_ready_clicks": 0, "chip_hollow": 0, "chip_solid": 0, "chip_inconclusive": 0,
        "typed_advances": 0, "typed_hollow": 0, "typed_solid": 0, "typed_inconclusive": 0,
        "detours_before_fail": 0, "detours_before_mastery": 0, "guided_try_fires": 0,
    }
    # fact -> {ready_clicks, hollow_count, solid_count, inconclusive_count}
    facts = {}

    for r in results:
        for k, v in r["chip"].items():
            totals[f"chip_{k}"] += v
        totals["chip_ready_clicks"] += sum(r["chip"].values())
        for k, v in r["typed"].items():
            totals[f"typed_{k}"] += v
        totals["typed_advances"] += sum(r["typed"].values())
        for k in ("detours_before_fail", "detours_before_mastery", "guided_try_fires"):
            totals[k] += r["overuse"][k]
        for f, pf in r["per_fact"].items():
            if pf["advance_kind"] != "chip":
                continue
            fa = facts.setdefault(f, {"ready_clicks": 0, "hollow_count": 0,
                                      "solid_count": 0, "inconclusive_count": 0})
            fa["ready_clicks"] += 1
            fa[f"{pf['outcome']}_count"] += 1

    worst = []
    for f, fa in facts.items():
        decided = fa["hollow_count"] + fa["solid_count"]
        rate = (fa["hollow_count"] / decided) if decided else 0.0
        worst.append({
            "fact": f,
            "ready_clicks": fa["ready_clicks"],
            "hollow_count": fa["hollow_count"],
            "solid_count": fa["solid_count"],
            "inconclusive_count": fa["inconclusive_count"],
            "hollow_rate": round(rate, 3),
            # rank by volume×rate (ready_clicks × hollow_rate) so a high-traffic
            # fact outranks a 1-of-1 100% noise spike
            "_rank": rate * fa["ready_clicks"],
        })
    worst.sort(key=lambda w: (w["_rank"], w["ready_clicks"], w["hollow_count"]), reverse=True)
    for w in worst:
        del w["_rank"]

    chip_decided = totals["chip_hollow"] + totals["chip_solid"]
    typed_decided = totals["typed_hollow"] + totals["typed_solid"]
    totals["chip_hollow_rate"] = round(totals["chip_hollow"] / chip_decided, 3) if chip_decided else None
    totals["chip_hollow_n"] = chip_decided
    totals["typed_hollow_rate"] = round(totals["typed_hollow"] / typed_decided, 3) if typed_decided else None
    totals["typed_hollow_n"] = typed_decided

    return {"totals": totals, "worst_facts": worst}
