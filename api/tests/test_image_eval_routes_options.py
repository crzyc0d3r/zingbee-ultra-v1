import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from image_eval_routes import _normalize_options


class ImageEvalRoutesOptionsTests(unittest.TestCase):
    def test_loop_options_include_cost_failsafes(self):
        options = _normalize_options(
            "loop",
            {
                "max_cycles": 3,
                "max_facts": 4,
                "max_runtime_sec": 1200,
                "max_evaluations": 321,
                "max_regeneration_per_command": 99,
            },
        )
        self.assertEqual(options["max_cycles"], 3)
        self.assertEqual(options["max_facts"], 4)
        self.assertEqual(options["max_runtime_sec"], 1200)
        self.assertEqual(options["max_evaluations"], 321)
        self.assertEqual(options["max_regeneration_per_command"], 99)

    def test_bad_int_options_raise_value_error(self):
        with self.assertRaises(ValueError):
            _normalize_options("evaluate", {"limit": "nope"})


if __name__ == "__main__":
    unittest.main()
