"""Tests for classifier.is_substantive_response — ADO #28 evidence guard deny-list.

The guard is a DENY-LIST, not a quality bar: only the spec's enumerated
non-evidence (acks, "I understand", chip text, empty/emoji/too-short) is
non-substantive. Everything else — any language, any length ≥3 chars —
passes (fail-open). No LLM or DB calls.
Run with: pytest api/tests/test_classifier_substance.py -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from classifier import is_substantive_response


class TestDenyList(unittest.TestCase):
    """The spec's literal non-evidence: button clicks, "yes", "I understand"."""

    def test_empty_and_whitespace(self):
        self.assertFalse(is_substantive_response(""))
        self.assertFalse(is_substantive_response("   "))

    def test_punctuation_only(self):
        self.assertFalse(is_substantive_response("..."))
        self.assertFalse(is_substantive_response("?!"))

    def test_emoji_only(self):
        self.assertFalse(is_substantive_response("\U0001F44D"))

    def test_too_short(self):
        # <3 chars after normalization — includes correct "No." (plan edge
        # case: one probe, elaboration passes) and bare "42"
        self.assertFalse(is_substantive_response("xy"))
        self.assertFalse(is_substantive_response("No."))

    def test_bare_confirmations(self):
        for msg in ("yes", "Yes.", "yeah", "ok", "okay!", "sure", "got it",
                    "i get it", "makes sense", "cool", "alright"):
            self.assertFalse(is_substantive_response(msg), msg)

    def test_i_understand_variants(self):
        # _NON_EVIDENCE: the spec names "I understand" as explicitly not evidence
        for msg in ("I understand", "understood", "i know", "I know it",
                    "i get it now", "that makes sense", "makes sense now",
                    "yes i understand", "ok i get it", "yeah understood"):
            self.assertFalse(is_substantive_response(msg), msg)

    def test_four_word_acks_caught_by_filler_strip(self):
        # The rev-1 word-count heuristic would have passed these
        for msg in ("yeah I totally get it", "ok that makes sense now",
                    "I really understand it now", "um yeah I get it"):
            self.assertFalse(is_substantive_response(msg), msg)

    def test_repeated_token_gaming(self):
        # consecutive-dedupe: "yes yes yes yes" is still just "yes"
        self.assertFalse(is_substantive_response("yes yes yes yes"))
        self.assertFalse(is_substantive_response("ok ok ok"))

    def test_idk_and_move_on(self):
        for msg in ("idk", "i don't know", "not sure", "skip", "next", "move on"):
            self.assertFalse(is_substantive_response(msg), msg)

    def test_chip_text_exact_match(self):
        chips = ["Let me try it", "Can we see an example?"]
        self.assertFalse(is_substantive_response("Let me try it", chips))
        self.assertFalse(is_substantive_response("let me try it!", chips))


class TestFailOpen(unittest.TestCase):
    """Everything not on the deny-list is substantive — the assessor already
    judged content; the regex must not second-guess semantics."""

    def test_real_explanations(self):
        for msg in ("because living things grow and respond",
                    "Organisms are living things",
                    "you would use it to classify a virus"):
            self.assertTrue(is_substantive_response(msg), msg)

    def test_single_domain_word(self):
        # Short-answer questions get short answers; misspellings included
        self.assertTrue(is_substantive_response("organisms"))
        self.assertTrue(is_substantive_response("fotosinthesis"))

    def test_non_english_passes(self):
        # English lexicons must fail open for other languages — never lock
        # out CJK/Spanish/etc. students
        self.assertTrue(is_substantive_response("所有生物都叫有机体"))
        self.assertTrue(is_substantive_response("porque crecen y se reproducen"))

    def test_ack_prefix_with_content_passes(self):
        # Anchored matching: an ack FOLLOWED by substance is substantive
        self.assertTrue(is_substantive_response(
            "I understand that organisms are living things"))
        self.assertTrue(is_substantive_response("yes, because fire cannot reproduce"))

    def test_filler_strip_does_not_kill_real_answers(self):
        self.assertTrue(is_substantive_response(
            "um because they like grow and stuff"))

    def test_negative_answer_with_reason(self):
        self.assertTrue(is_substantive_response("no because it is not alive"))

    def test_non_matching_chip_text(self):
        self.assertTrue(is_substantive_response(
            "Let me try explaining it", ["Let me try it"]))


if __name__ == "__main__":
    unittest.main()
