#!/usr/bin/env python3
"""Command-line entrypoint for image eval pipeline stages.

Usage:
    python image_eval_cli.py generate --phase 1 --theme "Cells" --capsule "Cell Types"
    python image_eval_cli.py evaluate --phase 1 --theme "Cells" --capsule "Cell Types"
    python image_eval_cli.py reprompt --phase 1 --theme "Cells" --capsule "Cell Types"
    python image_eval_cli.py loop --phase 1 --theme "Cells" --capsule "Cell Types"
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
import uuid

import db
from image_eval_service import SERVICE


def _add_scope_args(parser: argparse.ArgumentParser):
    """Add shared scope arguments to a subparser."""
    parser.add_argument("--phase", required=True, type=int)
    parser.add_argument("--theme", required=True)
    parser.add_argument("--capsule", required=True)
    parser.add_argument("--subject", default="")


def _add_common_args(parser: argparse.ArgumentParser):
    """Add shared pipeline arguments to a subparser."""
    parser.add_argument("--image-model", action="append", default=[], help="Model spec (repeatable), e.g. xai:grok-imagine-image")
    parser.add_argument("--prompt-strategy", action="append", default=[], help="Prompt strategy (repeatable)")
    parser.add_argument("--prompt-version", default="")
    parser.add_argument("--max-runtime-sec", type=int, default=900)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--actor", default="cli")
    parser.add_argument("--save-run", action="store_true", help="Persist as eval_runs row")


def main():
    parser = argparse.ArgumentParser(description="Image Eval pipeline runner")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # -- generate --
    gen = subparsers.add_parser("generate", help="Generate image variants for facts")
    _add_scope_args(gen)
    _add_common_args(gen)
    gen.add_argument("--variants-per-fact", type=int, default=1)
    gen.add_argument("--max-facts", type=int, default=0)

    # -- evaluate --
    ev = subparsers.add_parser("evaluate", help="Run judge evaluation on generated images")
    _add_scope_args(ev)
    _add_common_args(ev)
    ev.add_argument("--model-filter", default="", help="Evaluate only this generation model")
    ev.add_argument("--strategy-filter", default="", help="Evaluate only this prompt strategy")
    ev.add_argument("--max-evaluations", type=int, default=500)
    ev.add_argument("--decision-mode", default="combined_consensus")

    # -- reprompt --
    rp = subparsers.add_parser("reprompt", help="Regenerate failed images with improved prompts")
    _add_scope_args(rp)
    _add_common_args(rp)
    rp.add_argument("--model-filter", default="", help="Reprompt only this generation model")
    rp.add_argument("--strategy-filter", default="", help="Reprompt only this prompt strategy")
    rp.add_argument("--next-prompt-version", default="")

    # -- loop --
    lp = subparsers.add_parser("loop", help="Full generate → evaluate → reprompt cycle")
    _add_scope_args(lp)
    _add_common_args(lp)
    lp.add_argument("--model-filter", default="", help="Filter to this generation model")
    lp.add_argument("--strategy-filter", default="", help="Filter to this prompt strategy")
    lp.add_argument("--max-facts", type=int, default=0)
    lp.add_argument("--max-cycles", type=int, default=1)
    lp.add_argument("--max-evaluations", type=int, default=500)
    lp.add_argument("--max-regenerations", type=int, default=200)
    lp.add_argument("--next-prompt-version", default="")
    lp.add_argument("--no-generate-after-reprompt", action="store_true", help="Disable re-generation after reprompt")

    args = parser.parse_args()

    scope = {"phase": args.phase, "theme": args.theme, "capsule": args.capsule}
    if args.subject:
        scope["subject"] = args.subject

    # Build options dict from args — only include non-default values
    options: dict = {}
    if args.prompt_version:
        options["prompt_version"] = args.prompt_version
    if args.image_model:
        options["image_models"] = args.image_model
    if args.prompt_strategy:
        options["prompt_strategies"] = args.prompt_strategy
    options["max_runtime_sec"] = args.max_runtime_sec
    if args.dry_run:
        options["dry_run"] = True

    if args.command == "generate":
        options["variants_per_fact"] = args.variants_per_fact
        if args.max_facts > 0:
            options["max_facts"] = args.max_facts
    elif args.command == "evaluate":
        if args.model_filter:
            options["model"] = args.model_filter
        if args.strategy_filter:
            options["prompt_strategy"] = args.strategy_filter
        options["max_evaluations"] = args.max_evaluations
        options["decision_mode"] = args.decision_mode
    elif args.command == "reprompt":
        if args.model_filter:
            options["model"] = args.model_filter
        if args.strategy_filter:
            options["prompt_strategy"] = args.strategy_filter
        if args.next_prompt_version:
            options["next_prompt_version"] = args.next_prompt_version
    elif args.command == "loop":
        if args.model_filter:
            options["model"] = args.model_filter
        if args.strategy_filter:
            options["prompt_strategy"] = args.strategy_filter
        if args.max_facts > 0:
            options["max_facts"] = args.max_facts
        options["max_cycles"] = args.max_cycles
        options["max_evaluations"] = args.max_evaluations
        options["max_regeneration_per_command"] = args.max_regenerations
        options["allow_generate_after_reprompt"] = not args.no_generate_after_reprompt
        if args.next_prompt_version:
            options["next_prompt_version"] = args.next_prompt_version

    job_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + "_imgcli_" + uuid.uuid4().hex[:6]

    if args.save_run:
        targets = [t for t in [
            f"subject:{args.subject}" if args.subject else "",
            f"phase:{args.phase}",
            f"theme:{args.theme}",
            f"capsule:{args.capsule}",
        ] if t]
        db.create_eval_run(
            job_id=job_id, targets=targets, config=f"image_eval:{args.command}",
            persona="operator", enable_grading=True, max_turns=None, pid=0,
        )

    summary = SERVICE.run_command(
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
