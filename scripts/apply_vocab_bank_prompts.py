"""Add the Vocabulary-Bank usage rule to the live TEACH prompt templates (ADO #25).

The Vocabulary Bank panel shows the student the exact terms from each fact's
KEY_VOCABULARY. For the chat and the panel to speak the same language, the
tutor must use those terms verbatim (not a synonym) and bold each on first use.
This script injects one <VOCABULARY_RULE> line, anchored on the existing
<KEY_VOCABULARY>$vocabulary</KEY_VOCABULARY> element that every teach-family
template already contains.

Touched templates: step_teach, step_teach_reteach, step_teach_confused,
step_teach_continue (the four where a concept is being explained). CHECK /
EVIDENCE templates are intentionally left alone — bolding answer terms during
assessment would defeat the panel's definition-masking.

Idempotent: a template that already has <VOCABULARY_RULE> is skipped. Every
write is versioned in prompt_versions (source="manual"); revert by re-applying
a prior version. Safe to run before OR after the code deploy — without the
rule the tutor simply doesn't bold, and the (server-derived) panel is
unaffected.

Run from repo root with the API env:
    python scripts/apply_vocab_bank_prompts.py [--dry-run]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / "api" / ".env")

import db  # noqa: E402

ANCHOR = "<KEY_VOCABULARY>$vocabulary</KEY_VOCABULARY>"
MARKER = "<VOCABULARY_RULE>"
RULE = (
    "\n  <VOCABULARY_RULE>Use every term from KEY_VOCABULARY in your "
    "explanation, and put it in **bold** the first time it appears. Use the "
    "exact term, never a synonym — the student sees these same words in their "
    "Vocabulary Bank panel, so the words on screen and the words you say must "
    "match.</VOCABULARY_RULE>"
)
TEACH_TEMPLATES = [
    "step_teach", "step_teach_reteach",
    "step_teach_confused", "step_teach_continue",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, descision_tree FROM learning_system_schemas")
            schemas = cur.fetchall()
    finally:
        conn.close()

    updated = skipped = no_anchor = 0
    for row in schemas:
        dt = row["descision_tree"] or {}
        registry = dt.get("prompt_registry", {})
        if "system_prompt" not in registry:
            continue  # not a live tutor schema
        schema_id, name = row["id"], row["name"]

        for pid in TEACH_TEMPLATES:
            tmpl = (registry.get(pid) or {}).get("template", "")
            if not tmpl:
                continue
            if MARKER in tmpl:
                print(f"  -- {name}/{pid}: rule already present — skipped")
                skipped += 1
                continue
            if ANCHOR not in tmpl:
                print(f"  !! {name}/{pid}: anchor not found — SKIPPED (review)")
                no_anchor += 1
                continue
            new_tmpl = tmpl.replace(ANCHOR, ANCHOR + RULE, 1)
            if args.dry_run:
                print(f"  ?? {name}/{pid}: would inject VOCABULARY_RULE (dry run)")
                continue
            res = db.apply_prompt_template(
                schema_id, pid, new_tmpl,
                author="maintainer", source="manual",
                note="ADO #25 vocabulary-bank verbatim-use + bolding rule")
            print(f"  ok {name}/{pid}: {res['status']}")
            updated += 1

    print(f"\nDone: {updated} updated, {skipped} already present, "
          f"{no_anchor} missing anchor{' (dry run)' if args.dry_run else ''}.")


if __name__ == "__main__":
    main()
