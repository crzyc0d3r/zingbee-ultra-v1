"""Tests for the engagement-monitoring outcome walk (ADO #26 dashboard).

The walk classifies each fact's advance (chip-ready vs typed-understanding)
against its CHECK/EVIDENCE *gate* outcome — NOT the next TRY attempt, because
failing first-attempt practice is the healthy loop, not misuse.

Run with: pytest api/tests/test_engagement_metrics.py -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engagement_metrics as em


def ev(step, **kw):
    """Build a v_engagement_events-shaped row (only the fields the walk reads)."""
    row = {"step": step, "fact": None, "intent": None, "hit": None,
           "phase": None, "interaction_type": None, "action": None,
           "strikeout_fact": None}
    row.update(kw)
    return row


# Shorthand event builders
def chip(intent, fact=None, hit=True):
    return ev("CHIP_MATCH", intent=intent, hit=hit, fact=fact, phase="TEACH")

def assess(itype, fact, phase):
    return ev("ASSESSMENT", interaction_type=itype, fact=fact, phase=phase)

def transition(action, fact):
    return ev("V6_TRANSITION", action=action, fact=fact, phase="TEACH")

def strikeout(graded_fact, next_fact=None):
    # ADO #74: an evidence-guard strike-out advances the queue, so the row's `fact`
    # is the NEXT fact; the GRADED (struck-out) fact is carried in strikeout_fact.
    return ev("V6_TRANSITION", action="evidence_next", fact=next_fact,
              phase="EVIDENCE", strikeout_fact=graded_fact)


F = "All living things are organisms"
G = "Cells are the unit of life"


class TestHollowReady(unittest.TestCase):
    def test_ready_chip_then_check_fail_is_hollow(self):
        out = em.analyze_session([
            chip("ready", F),
            assess("student_incorrect", F, "CHECK"),
        ])
        self.assertEqual(out["chip"], {"hollow": 1, "solid": 0, "inconclusive": 0})
        self.assertEqual(out["per_fact"][F]["outcome"], "hollow")

    def test_ready_chip_then_TRY_fail_then_check_pass_is_SOLID(self):
        # The crux: a TRY stumble after "ready" is normal practice, NOT misuse.
        # Only the CHECK/EVIDENCE gate decides hollow vs solid.
        out = em.analyze_session([
            chip("ready", F),
            assess("student_incorrect", F, "TRY"),     # practice miss — ignored
            assess("student_partially_correct", F, "TRY"),
            assess("student_correct", F, "CHECK"),       # gate passed
        ])
        self.assertEqual(out["chip"], {"hollow": 0, "solid": 1, "inconclusive": 0})
        self.assertEqual(out["per_fact"][F]["outcome"], "solid")

    def test_ready_chip_no_gate_is_inconclusive(self):
        out = em.analyze_session([
            chip("ready", F),
            assess("student_incorrect", F, "TRY"),  # never reaches a gate
        ])
        self.assertEqual(out["chip"], {"hollow": 0, "solid": 0, "inconclusive": 1})

    def test_continue_chip_evidence_fail_is_hollow(self):
        out = em.analyze_session([
            chip("continue", F),
            assess("student_correct", F, "CHECK"),
            assess("student_confused", F, "EVIDENCE"),  # last gate wins
        ])
        self.assertEqual(out["chip"]["hollow"], 1)

    def test_forfeit_at_gate_is_hollow(self):
        out = em.analyze_session([
            chip("ready", F),
            assess("student_move_on", F, "CHECK"),
        ])
        self.assertEqual(out["chip"]["hollow"], 1)

    def test_recall_continue_chip_not_counted_as_teach_advance(self):
        # A continue/ready click in RECALL means "skip recall / start new
        # content" — not "I understood this fact". Must not mark the fact as a
        # chip-advance (would inflate hollow-ready with non-TEACH clicks).
        out = em.analyze_session([
            ev("CHIP_MATCH", intent="continue", hit=True, fact=F, phase="RECALL"),
            assess("student_incorrect", F, "CHECK"),
        ])
        self.assertEqual(out["chip"], {"hollow": 0, "solid": 0, "inconclusive": 0})
        self.assertNotIn(F, out["per_fact"])

    def test_historical_chip_without_phase_still_counts(self):
        # Pre-enrichment CHIP_MATCH had no phase; counted best-effort (ready
        # only ever appeared in TEACH).
        out = em.analyze_session([
            ev("CHIP_MATCH", intent="ready", hit=True, fact=F, phase=None),
            assess("student_incorrect", F, "CHECK"),
        ])
        self.assertEqual(out["chip"]["hollow"], 1)

    def test_historical_chip_without_fact_uses_tracked_fact(self):
        # Pre-enrichment CHIP_MATCH carried no fact; current fact is tracked
        # from surrounding events so historical sessions still attribute.
        out = em.analyze_session([
            transition("teach_continue", F),      # establishes current fact
            chip("ready", fact=None),             # historical: no fact on the chip
            assess("student_incorrect", F, "CHECK"),
        ])
        self.assertEqual(out["chip"]["hollow"], 1)
        self.assertEqual(out["per_fact"][F]["advance_kind"], "chip")


class TestTypedBaseline(unittest.TestCase):
    def test_typed_understanding_is_separate_cohort(self):
        out = em.analyze_session([
            assess("student_understands", F, "TEACH"),  # typed "ok", no chip
            assess("student_incorrect", F, "CHECK"),
        ])
        self.assertEqual(out["typed"], {"hollow": 1, "solid": 0, "inconclusive": 0})
        self.assertEqual(out["chip"], {"hollow": 0, "solid": 0, "inconclusive": 0})

    def test_chip_click_takes_precedence_over_typed_understands(self):
        # The forced chip path also emits an ASSESSMENT student_understands — it
        # must count once, as chip, not double-counted as typed too.
        out = em.analyze_session([
            chip("ready", F),
            assess("student_understands", F, "TEACH"),  # the forced-chip assessment
            assess("student_correct", F, "CHECK"),
        ])
        self.assertEqual(out["chip"]["solid"], 1)
        self.assertEqual(out["typed"], {"hollow": 0, "solid": 0, "inconclusive": 0})


class TestOveruse(unittest.TestCase):
    def test_detours_split_by_eventual_outcome(self):
        out = em.analyze_session([
            chip("example", F), transition("teach_example", F),
            chip("ready", F),
            assess("student_incorrect", F, "CHECK"),     # F: detoured then failed
            transition("teach_explore", G),
            assess("student_correct", G, "CHECK"),         # G: detoured then mastered
        ])
        self.assertEqual(out["overuse"]["detours_before_fail"], 1)
        self.assertEqual(out["overuse"]["detours_before_mastery"], 1)

    def test_guided_try_fires_counted(self):
        out = em.analyze_session([
            ev("V6_TRANSITION", action="engagement_guided_try", fact=F, phase="TEACH"),
        ])
        self.assertEqual(out["overuse"]["guided_try_fires"], 1)


class TestAggregate(unittest.TestCase):
    def test_empty_session_no_crash(self):
        out = em.analyze_session([])
        self.assertEqual(out["chip"], {"hollow": 0, "solid": 0, "inconclusive": 0})
        self.assertEqual(out["per_fact"], {})

    def test_aggregate_sums_sessions_and_worst_facts(self):
        s1 = [chip("ready", F), assess("student_incorrect", F, "CHECK")]
        s2 = [chip("ready", F), assess("student_correct", F, "CHECK")]
        s3 = [chip("ready", G), assess("student_incorrect", G, "CHECK")]
        agg = em.aggregate([s1, s2, s3])
        # F: 1 hollow / 1 solid (2 ready clicks); G: 1 hollow / 1 click
        self.assertEqual(agg["totals"]["chip_ready_clicks"], 3)
        self.assertEqual(agg["totals"]["chip_hollow"], 2)
        worst = {w["fact"]: w for w in agg["worst_facts"]}
        self.assertEqual(worst[F]["ready_clicks"], 2)
        self.assertEqual(worst[F]["hollow_count"], 1)
        self.assertEqual(worst[G]["ready_clicks"], 1)
        # worst_facts sorted by volume*rate, not rate alone (G is 100% but n=1)
        self.assertEqual(agg["worst_facts"][0]["fact"], F)


class TestEvidenceStrikeout(unittest.TestCase):
    """ADO #74: an evidence-guard strike-out must count the advance as hollow.

    The guard fires on a PASS-graded EVIDENCE turn (a bare "yes"), so the
    ASSESSMENT records a spurious pass. The strike-out is the authoritative
    "no substantive evidence" signal and must override that pass — but only the
    GRADED fact, since the engine has already advanced the queue past it.
    """

    def test_strikeout_overrides_spurious_evidence_pass_to_hollow(self):
        out = em.analyze_session([
            chip("ready", F),
            assess("student_correct", F, "EVIDENCE"),  # non-substantive "yes" -> spurious pass
            strikeout(F, next_fact=G),                 # probes exhausted -> F fails its gate
        ])
        self.assertEqual(out["chip"], {"hollow": 1, "solid": 0, "inconclusive": 0})
        self.assertEqual(out["per_fact"][F]["outcome"], "hollow")

    def test_strikeout_on_last_fact_no_next_still_hollow(self):
        # Last fact strikes out -> queue completes, row carries no next fact.
        out = em.analyze_session([
            chip("ready", F),
            assess("student_correct", F, "EVIDENCE"),
            strikeout(F),                              # next_fact=None
        ])
        self.assertEqual(out["per_fact"][F]["outcome"], "hollow")

    def test_probe_recovery_stays_solid(self):
        # Probed, then the student genuinely answers -> no strikeout_fact emitted,
        # the EVIDENCE pass stands -> solid. Distinguishes recovery from misuse.
        out = em.analyze_session([
            chip("ready", F),
            assess("student_correct", F, "EVIDENCE"),  # legitimate substantive pass
            transition("evidence_next", G),            # normal advance, no strikeout_fact
        ])
        self.assertEqual(out["chip"], {"hollow": 0, "solid": 1, "inconclusive": 0})
        self.assertEqual(out["per_fact"][F]["outcome"], "solid")


if __name__ == "__main__":
    unittest.main()
