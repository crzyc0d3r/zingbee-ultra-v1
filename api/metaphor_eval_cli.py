#!/usr/bin/env python3
"""Command-line entrypoint for the capsule metaphor authoring pipeline.

Usage:
    # Run propose+judge across all Biology capsules (skip already-accepted)
    python metaphor_eval_cli.py evaluate --subject Biology

    # Single capsule by UUID
    python metaphor_eval_cli.py evaluate --capsule-id 7f0a...

    # Force re-run on one capsule (ignore prior acceptance)
    python metaphor_eval_cli.py regenerate --capsule-id 7f0a...

    # Coverage report
    python metaphor_eval_cli.py status --subject Biology
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

# Load api/.env before anything that reads environment variables. The CLI
# is run from arbitrary cwds (project root, api/, etc.); resolve relative
# to this file so `python api/metaphor_eval_cli.py` works without exporting
# vars first.
load_dotenv(Path(__file__).resolve().parent / ".env")

import db  # noqa: E402  (after load_dotenv so DB_* env is populated)
from metaphor_eval_service import SERVICE  # noqa: E402


def _add_save_run_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--save-run", action="store_true",
        help="Persist as eval_runs row (default off — useful for ad-hoc CLI use)",
    )
    parser.add_argument("--actor", default="cli", help="Actor name attributed to the run")


def _save_run(job_id: str, command: str, scope: dict, summary: dict) -> None:
    targets = []
    if scope.get("capsule_id"):
        targets.append(f"capsule:{scope['capsule_id']}")
    if scope.get("subject"):
        targets.append(f"subject:{scope['subject']}")
    if scope.get("phase") is not None:
        targets.append(f"phase:{scope['phase']}")
    db.create_eval_run(
        job_id=job_id, targets=targets, config=f"metaphor_eval:{command}",
        persona="operator", enable_grading=True, max_turns=None, pid=0,
    )
    db.save_eval_result(job_id, summary)
    status = summary.get("status", "")
    if status == "completed":
        db.complete_eval_run(job_id, "completed", exit_code=0, result=summary)
    elif status == "cancelled":
        db.complete_eval_run(job_id, "cancelled", exit_code=130, result=summary)
    else:
        db.complete_eval_run(job_id, "failed", exit_code=2, result=summary)


def cmd_evaluate(args: argparse.Namespace) -> int:
    scope = {}
    if args.capsule_id:
        scope["capsule_id"] = args.capsule_id
    if args.subject:
        scope["subject"] = args.subject
    if args.phase:
        scope["phase"] = args.phase
    if not (scope.get("capsule_id") or scope.get("subject")):
        print("error: provide --capsule-id or --subject", file=sys.stderr)
        return 2

    options = {
        "skip_existing": not args.force,
        "n_proposals": args.n_proposals,
        "max_capsules": args.max_capsules,
    }
    job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_metaphorcli_" + uuid.uuid4().hex[:6]
    summary = SERVICE.run_command(
        job_id=job_id, command="evaluate", scope=scope, options=options, actor=args.actor,
    )
    print(json.dumps(summary, indent=2, default=str))
    if args.save_run:
        _save_run(job_id, "evaluate", scope, summary)
    return 0 if summary.get("status") == "completed" else 1


def cmd_regenerate(args: argparse.Namespace) -> int:
    if not args.capsule_id:
        print("error: --capsule-id is required for regenerate", file=sys.stderr)
        return 2
    scope = {"capsule_id": args.capsule_id}
    options = {"n_proposals": args.n_proposals}
    job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_metaphorcli_" + uuid.uuid4().hex[:6]
    summary = SERVICE.run_command(
        job_id=job_id, command="regenerate", scope=scope, options=options, actor=args.actor,
    )
    print(json.dumps(summary, indent=2, default=str))
    if args.save_run:
        _save_run(job_id, "regenerate", scope, summary)
    return 0 if summary.get("status") == "completed" else 1


def cmd_status(args: argparse.Namespace) -> int:
    rows = db.list_capsules_with_metaphor_state(
        subject_name=args.subject,
        phase=args.phase,
    )
    counts = {"auto_accepted": 0, "human_approved": 0, "needs_review": 0, "auto_rejected": 0, "unset": 0}
    for row in rows:
        meta = row.get("meta_data") or {}
        review = meta.get("metaphor_review") or {}
        status = review.get("status") or ("unset" if not meta.get("metaphor") else "auto_accepted")
        counts[status] = counts.get(status, 0) + 1
    total = len(rows)
    accepted = counts["auto_accepted"] + counts["human_approved"]
    coverage = (accepted / total * 100.0) if total else 0.0
    print(json.dumps({
        "subject": args.subject,
        "phase": args.phase,
        "total_capsules": total,
        "counts": counts,
        "accepted_count": accepted,
        "coverage_pct": round(coverage, 2),
    }, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Capsule metaphor authoring pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ev = subparsers.add_parser("evaluate", help="Run propose+judge for one or many capsules")
    ev.add_argument("--capsule-id", default="")
    ev.add_argument("--subject", default="")
    ev.add_argument("--phase", type=int, default=None)
    ev.add_argument("--n-proposals", type=int, default=3, dest="n_proposals")
    ev.add_argument("--max-capsules", type=int, default=200, dest="max_capsules")
    ev.add_argument("--force", action="store_true", help="Re-evaluate even if already accepted")
    _add_save_run_args(ev)

    rg = subparsers.add_parser("regenerate", help="Force fresh propose+judge for one capsule")
    rg.add_argument("--capsule-id", required=True)
    rg.add_argument("--n-proposals", type=int, default=3, dest="n_proposals")
    _add_save_run_args(rg)

    st = subparsers.add_parser("status", help="Coverage report (no API calls)")
    st.add_argument("--subject", default="")
    st.add_argument("--phase", type=int, default=None)

    args = parser.parse_args()
    if args.command == "evaluate":
        return cmd_evaluate(args)
    if args.command == "regenerate":
        return cmd_regenerate(args)
    if args.command == "status":
        return cmd_status(args)
    parser.error(f"Unknown command {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
