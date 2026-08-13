import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from image_eval_policy import compute_composite_and_decision


def _judge(score: float, flags=None):
    return {"score": score, "flags": flags or []}


class ImageEvalPolicyTests(unittest.TestCase):
    def test_combined_consensus_ship(self):
        judges = {
            "child_safety": _judge(0.9),
            "fact_checker": _judge(0.9),
            "misinterpretation_hunter": _judge(0.9),
            "visual_clarity": _judge(0.9),
            "text_accuracy": _judge(0.9),
            "pedagogical_effectiveness": _judge(0.9),
            "cultural_representation": _judge(0.9),
        }
        result = compute_composite_and_decision(judges=judges, subject="Science", mode="combined_consensus")
        self.assertEqual(result.decision, "SHIP")

    def test_master_judge_outlier_regenerates(self):
        judges = {
            "child_safety": _judge(0.95),
            "fact_checker": _judge(0.2),
            "misinterpretation_hunter": _judge(0.95),
            "visual_clarity": _judge(0.95),
            "text_accuracy": _judge(0.95),
            "pedagogical_effectiveness": _judge(0.95),
            "cultural_representation": _judge(0.95),
        }
        result = compute_composite_and_decision(judges=judges, subject="Science", mode="master_judge")
        self.assertEqual(result.decision, "REGENERATE")
        self.assertIn("master_judge_low_outlier", result.reasons)


if __name__ == "__main__":
    unittest.main()
