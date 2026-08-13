#!/usr/bin/env python3
"""Offline CLI for the session-level pedagogy scorer (Track B / ADO #58).

Usage:
    # Score the 20 most recent Biology sessions on the local judge panel
    python pedagogy_eval_cli.py score --subject Biology --limit 20

    # Narrow to a phase and tag the batch
    python pedagogy_eval_cli.py score --subject Math --phase 2 --limit 50 --fixture-set math-p2-smoke

    # Read back per-dimension p50/p95 + the multi-objective vector
    python pedagogy_eval_cli.py aggregate --subject Biology

LOCAL-ONLY by default (the GB10 Spark via Ollama). Frontier judges stay OFF unless
PEDAGOGY_EVAL_FRONTIER_ENABLED=true (D5 kill switch). Per-run fixtures are capped by
pedagogy_eval_policy.DEFAULT_GUARDRAILS["max_fixtures_per_run"].
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load api/.env before importing db so DB_* and LOCAL_*/PEDAGOGY_* are populated
# regardless of cwd (works as `python api/pedagogy_eval_cli.py` from the root).
load_dotenv(Path(__file__).resolve().parent / ".env")

import db  # noqa: E402
import pedagogy_eval_policy as policy  # noqa: E402
from pedagogy_eval_service import score_fixture_set  # noqa: E402


def _progress(i: int, n: int, summary: dict | None) -> None:
    s = summary or {}
    q = s.get("pedagogy_quality")
    q_str = f"{q:.3f}" if isinstance(q, (int, float)) else "n/a"
    print(f"  [{i}/{n}] {s.get('session_id', '?')}  -> {s.get('decision', '?'):6}  "
          f"quality={q_str}  judges={s.get('successful_judges', '?')}"
          f"{'  (fell_back)' if s.get('fell_back') else ''}",
          file=sys.stderr, flush=True)


def cmd_score(args) -> int:
    res = score_fixture_set(
        subject=args.subject, phase=args.phase, limit=args.limit,
        fixture_set=args.fixture_set, min_turns=args.min_turns, progress=_progress,
    )
    # Print the run summary (without the per-item firehose) to stdout as JSON.
    summary = {k: v for k, v in res.items() if k != "items"}
    print(json.dumps(summary, indent=2, default=str))
    print(f"\nDONE  scored={res['scored']}  errors={len(res['errors'])}  "
          f"run_id={res['run_id']}  fixture_set={res['fixture_set']}  "
          f"frontier_enabled={res['frontier_enabled']}", file=sys.stderr)
    return 1 if res["scored"] == 0 else 0


def cmd_aggregate(args) -> int:
    data = db.aggregate_pedagogy_scores(
        args.rubric_version if args.rubric_version is not None else policy.RUBRIC_VERSION,
        fixture_set=args.fixture_set,
        template_hash=args.template_hash,
        model_version=args.model,
    )
    print(json.dumps(data, indent=2, default=str))
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description="Offline session-level pedagogy scorer (Track B).")
    sub = p.add_subparsers(dest="command", required=True)

    sc = sub.add_parser("score", help="Score recent sessions on the judge panel")
    sc.add_argument("--subject", default=None, help="Subject name, e.g. Biology (default: all)")
    sc.add_argument("--phase", type=int, default=None, help="Curriculum phase filter")
    sc.add_argument("--limit", type=int, default=20, help="Max sessions (capped by guardrail)")
    sc.add_argument("--fixture-set", dest="fixture_set", default=None, help="Tag for this batch")
    sc.add_argument("--min-turns", dest="min_turns", type=int, default=None,
                    help="Skip sessions with fewer assistant turns (default: policy guardrail)")
    sc.set_defaults(func=cmd_score)

    ag = sub.add_parser("aggregate", help="Print per-dimension p50/p95 + multi-objective vector")
    ag.add_argument("--subject", default=None, help="(unused filter placeholder; use --fixture-set)")
    ag.add_argument("--fixture-set", dest="fixture_set", default=None)
    ag.add_argument("--template-hash", dest="template_hash", default=None)
    ag.add_argument("--model", default=None, help="Filter by tutor model_version")
    ag.add_argument("--rubric-version", dest="rubric_version", type=int, default=None)
    ag.set_defaults(func=cmd_aggregate)

    args = p.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
