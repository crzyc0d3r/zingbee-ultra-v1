#!/usr/bin/env python3
"""Command-line entrypoint for the 4-stage distillation pipeline.

Pipeline order (enforced):
  1. generate_explanations  — Create 5 explanation strategies per fact
  2. evaluate_explanations  — Judge distillations against the source fact
  3. generate_images        — Create images for approved distillations
  4. evaluate_images        — Judge images against both distillation AND fact
                              (includes pair coherence judges when distillation context available)

Usage:
    python distillation_cli.py generate_explanations --phase 1 --theme "Cells" --capsule "Cell Types" --max-facts 5
    python distillation_cli.py evaluate_explanations --phase 1 --theme "Cells" --capsule "Cell Types" --max-evaluations 50
    python distillation_cli.py generate_images --phase 1 --theme "Cells" --capsule "Cell Types"
    python distillation_cli.py evaluate_images --phase 1 --theme "Cells" --capsule "Cell Types" --max-evaluations 50
    python distillation_cli.py full_loop --phase 1 --theme "Cells" --capsule "Cell Types" --max-facts 5
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
import uuid

import db
from distillation_pipeline import PIPELINE


def _add_scope_args(parser: argparse.ArgumentParser):
    parser.add_argument("--phase", required=True, type=int)
    parser.add_argument("--theme", required=True)
    parser.add_argument("--capsule", required=True)
    parser.add_argument("--subject", default="")


def _add_common_args(parser: argparse.ArgumentParser):
    parser.add_argument("--model", default="", help="LLM model for generation/evaluation")
    parser.add_argument("--max-runtime-sec", type=int, default=900)
    parser.add_argument("--actor", default="cli")
    parser.add_argument("--save-run", action="store_true", help="Persist as eval_runs row")


def main():
    parser = argparse.ArgumentParser(description="Distillation pipeline runner")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # -- generate_explanations --
    gen = subparsers.add_parser("generate_explanations", help="Generate 5 explanation variants per fact")
    _add_scope_args(gen)
    _add_common_args(gen)
    gen.add_argument("--max-facts", type=int, default=0, help="Limit facts (0 = all)")

    # -- evaluate_explanations --
    ev = subparsers.add_parser("evaluate_explanations", help="Run judges on draft explanations")
    _add_scope_args(ev)
    _add_common_args(ev)
    ev.add_argument("--max-evaluations", type=int, default=500)
    ev.add_argument("--judge-model", default="", help="Model for judge LLM calls")

    # -- generate_images --
    gi = subparsers.add_parser("generate_images", help="Generate images for approved explanations")
    _add_scope_args(gi)
    _add_common_args(gi)
    gi.add_argument("--variants-per-explanation", type=int, default=5)
    gi.add_argument("--img-max-explanations", type=int, default=0, help="Limit approved explanations for image gen (0 = all)")

    # -- evaluate_images --
    ei = subparsers.add_parser("evaluate_images", help="Judge images vs distillation + fact (includes pair coherence)")
    _add_scope_args(ei)
    _add_common_args(ei)
    ei.add_argument("--max-evaluations", type=int, default=500)

    # -- full_loop --
    fl = subparsers.add_parser("full_loop", help="Full 4-stage pipeline: distillations → eval → images → eval (with pair coherence)")
    _add_scope_args(fl)
    _add_common_args(fl)
    fl.add_argument("--max-facts", type=int, default=0)
    fl.add_argument("--img-max-explanations", type=int, default=0, help="Limit approved explanations for image gen (0 = all)")
    fl.add_argument("--max-evaluations", type=int, default=500)

    args = parser.parse_args()

    scope = {"phase": args.phase, "theme": args.theme, "capsule": args.capsule}
    if args.subject:
        scope["subject"] = args.subject

    options: dict = {"max_runtime_sec": args.max_runtime_sec}
    if args.model:
        options["model"] = args.model

    if args.command == "generate_explanations":
        if args.max_facts > 0:
            options["max_facts"] = args.max_facts
    elif args.command == "evaluate_explanations":
        options["max_evaluations"] = args.max_evaluations
        if hasattr(args, "judge_model") and args.judge_model:
            options["judge_model"] = args.judge_model
    elif args.command == "generate_images":
        options["variants_per_fact"] = args.variants_per_explanation
        if args.img_max_explanations > 0:
            options["img_max_explanations"] = args.img_max_explanations
    elif args.command == "evaluate_images":
        options["max_evaluations"] = args.max_evaluations
    elif args.command == "full_loop":
        if args.max_facts > 0:
            options["max_facts"] = args.max_facts
        if args.img_max_explanations > 0:
            options["img_max_explanations"] = args.img_max_explanations
        options["max_evaluations"] = args.max_evaluations

    job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_distcli_" + uuid.uuid4().hex[:6]

    if args.save_run:
        targets = [t for t in [
            f"subject:{args.subject}" if args.subject else "",
            f"phase:{args.phase}",
            f"theme:{args.theme}",
            f"capsule:{args.capsule}",
        ] if t]
        db.create_eval_run(
            job_id=job_id, targets=targets, config=f"distillation:{args.command}",
            persona="operator", enable_grading=True, max_turns=None, pid=0,
        )

    summary = PIPELINE.run_command(
        job_id=job_id, command=args.command, scope=scope, options=options, actor=args.actor,
    )
    print(json.dumps(summary, indent=2))

    if args.save_run:
        db.save_eval_result(job_id, summary)
        status = summary.get("status", "")
        if status == "completed":
            db.complete_eval_run(job_id, "completed", exit_code=0, result=summary)
        elif status == "cancelled":
            db.complete_eval_run(job_id, "cancelled", exit_code=130, result=summary)
        else:
            db.complete_eval_run(job_id, "failed", exit_code=2, result=summary)


if __name__ == "__main__":
    main()
