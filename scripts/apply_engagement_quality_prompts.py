"""ADO #26 engagement-quality follow-up — prompt/config seed.

Applies the DB-side half of the gauntlet-hardened plan (the code-side lives in
api/session_engine.py, api/engagement.py, api/assessor.py). Idempotent and safe
to re-run; every template write is versioned via db.apply_prompt_template.

Changes per live schema (one with a system_prompt):
  A2  config.llm_roles.quick_classifier.temperature 1.3 -> 0.0 (raw config write)
  B   system_prompt <ACKNOWLEDGE_FIRST> rewritten to de-parrot (anti-echo, vary,
      keep specificity); teach-template "acknowledge in your FIRST sentence"
      lines softened
  C*  system_prompt <SUGGESTED_RESPONSES> + <OUTPUT_REQUIREMENTS> updated — the
      app now authors the chips, so the tutor need not emit <SUGGESTIONS>
  D   new step_try_hint template (created if absent)
  A*  assessment_user_prompt gains a TEACH classification ladder (substantive
      correct answers advance) + a tutor_parroting instruction

Run from repo root with the API env:
    python scripts/apply_engagement_quality_prompts.py [--dry-run]

Forward-only at deploy: do NOT let a DB restore overwrite these. Confirm the
live schema(s) via curriculum_themes.learning_system_id before running on prod.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / "api" / "api.env"
            if (Path(__file__).resolve().parents[1] / "api" / "api.env").exists()
            else Path(__file__).resolve().parents[1] / "api" / ".env")

import db  # noqa: E402

# --- B: de-parrotted acknowledgment block -------------------------------------
ACK_RE = re.compile(r"<ACKNOWLEDGE_FIRST>.*?</ACKNOWLEDGE_FIRST>", re.DOTALL)
ACK_MARKER = "Do NOT restate or echo"
ACK_NEW = (
    "<ACKNOWLEDGE_FIRST>\n"
    "  React to what the student just said before moving on, but keep it fresh\n"
    "  and short. Do NOT restate or echo their words back to them. In five words\n"
    "  or fewer, react (a genuine reaction, a quick question, or the next fact),\n"
    "  then immediately add something NEW. Vary how you open every single turn —\n"
    "  never start two replies the same way. Specific beats generic: engage with\n"
    "  the substance of their answer, never a hollow \"Great job!\". After a wrong\n"
    "  CHECK/EVIDENCE, keep the acknowledgment specific and supportive.\n"
    "</ACKNOWLEDGE_FIRST>"
)

# --- C*: suggestions are app-authored now -------------------------------------
SUG_RE = re.compile(r"<SUGGESTED_RESPONSES>.*?</SUGGESTED_RESPONSES>", re.DOTALL)
SUG_MARKER = "The app provides the clickable suggestion chips"
SUG_NEW = (
    "<SUGGESTED_RESPONSES>\n"
    "  The app provides the clickable suggestion chips now — server-authored and\n"
    "  anchored to the current fact. You do NOT need to emit a <SUGGESTIONS>\n"
    "  block; if you do, it may be replaced. Just end TEACH and RECALL turns with\n"
    "  ONE genuine spoken choice tied to what you taught (work an example, try it,\n"
    "  or explore deeper) and vary that closing question every turn. Never offer a\n"
    "  choice during TRY, CHECK, or EVIDENCE.\n"
    "</SUGGESTED_RESPONSES>"
)

# OUTPUT_REQUIREMENTS: stop mandating an LLM <SUGGESTIONS> block.
OUTPUT_SUBS = [
    ("include <EDUCATIONAL_IMAGE> AND <SUGGESTIONS>",
     "include <EDUCATIONAL_IMAGE> (suggestion chips are added by the app)"),
    ("no image. include <SUGGESTIONS>.",
     "no image. (suggestion chips are added by the app)"),
]

# Soften per-template parroting instruction across teach-family templates (B).
ACK_LINE_SUBS = [
    ("Acknowledge the student's previous response in your FIRST sentence.",
     "Open by reacting to the student in a few fresh words (do not restate "
     "their words); vary it every turn."),
]
TEACH_TEMPLATES = ["step_teach", "step_teach_continue", "step_teach_confused",
                   "step_teach_reteach", "step_teach_confirm",
                   "step_teach_example", "step_teach_explore"]

# --- D: hint template ---------------------------------------------------------
STEP_TRY_HINT = (
    "<STEP_TRANSITION step=\"TRY_HINT\">\n"
    "  <FACT>$core_fact</FACT>\n"
    "  <CONTEXT>The student asked for a hint (#$hint_number) on the current\n"
    "  practice question. They have NOT given up — honor the ask warmly.</CONTEXT>\n"
    "  <INSTRUCTIONS>\n"
    "    - Give ONE small nudge toward the answer: a clue, a thing to notice, or\n"
    "      the first step. Hint #1 is broad; hint #2 is more specific.\n"
    "    - NEVER give the full answer. Leave the student real work to do.\n"
    "    - Keep it to 1-2 short sentences.\n"
    "    - Then gently re-pose the original practice question so they try again.\n"
    "    - No <SUGGESTIONS> block.\n"
    "  </INSTRUCTIONS>\n"
    "</STEP_TRANSITION>"
)

# --- A*: assessor TEACH classification ladder + parroting flag ----------------
ASSESS_MARKER = "ADO26_QUALITY"
ASSESS_APPEND = (
    "\n\n<!-- ADO26_QUALITY -->\n"
    "TEACH classification (when current_step is TEACH):\n"
    "- If the student's message references the fact's content correctly (restates\n"
    "  it, applies it, or answers an implied question), classify it as\n"
    "  \"student_correct\" — or \"student_understands\" if they explicitly signal\n"
    "  they get it. A bare \"yes\"/\"ok\"/\"got it\" with no content = \"confirmation\".\n"
    "  Only truly content-free chatter = \"teaching\"; a genuine new question =\n"
    "  \"student_question\". Be generous: a correct on-topic answer MUST advance,\n"
    "  not loop.\n"
    "Also set tutor_compliance.tutor_parroting = true when the tutor's FIRST\n"
    "sentence merely restates the student's words instead of reacting and adding\n"
    "something new."
)


def _set_classifier_temp(cur, schema_id, dt, dry):
    cfg = (dt.get("config") or {}).get("llm_roles", {}).get("quick_classifier")
    if not isinstance(cfg, dict):
        return "no quick_classifier config"
    if cfg.get("temperature") == 0.0:
        return "temp already 0.0"
    if dry:
        return f"would set temp {cfg.get('temperature')} -> 0.0"
    cfg["temperature"] = 0.0
    cur.execute("UPDATE learning_system_schemas SET descision_tree = %s WHERE id = %s",
                (json.dumps(dt), schema_id))
    return "temp -> 0.0"


def _edit_template(name, schema_id, registry, pid, transform, dry, note):
    tmpl = (registry.get(pid) or {}).get("template", "")
    if not tmpl:
        return None
    new = transform(tmpl)
    if new is None or new == tmpl:
        return f"{pid}: unchanged"
    if dry:
        return f"{pid}: would update"
    res = db.apply_prompt_template(schema_id, pid, new, author="maintainer",
                                   source="manual", note=note)
    return f"{pid}: {res['status']}"


def verify():
    """Assert every ADO #26 prompt/config change is live on each tutor schema.

    Exits non-zero if anything is missing — the deploy gates flag-flips on this so
    a flag can never be enabled against an unseeded prompt (the silent no-op risk).
    Also catches the exact-string .replace() no-ops (e.g. OUTPUT_SUBS) that the
    apply step can't detect on its own.
    """
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, descision_tree FROM learning_system_schemas")
            schemas = cur.fetchall()
    finally:
        conn.close()

    ok = True
    for row in schemas:
        dt = row["descision_tree"] or {}
        reg = dt.get("prompt_registry", {})
        if "system_prompt" not in reg:
            continue
        name = row["name"]
        sysp = (reg.get("system_prompt") or {}).get("template", "")
        aup = (reg.get("assessment_user_prompt") or {}).get("template", "")
        temp = (((dt.get("config") or {}).get("llm_roles", {})
                 .get("quick_classifier") or {}).get("temperature"))
        checks = {
            "system_prompt de-parrot (B)": ACK_MARKER in sysp,
            "system_prompt app-chips (C*)": SUG_MARKER in sysp,
            "OUTPUT_REQUIREMENTS chip mandate removed": "AND <SUGGESTIONS>" not in sysp,
            "assessor TEACH ladder (A*)": ASSESS_MARKER in aup,
            "step_try_hint present (D)": bool((reg.get("step_try_hint") or {}).get("template")),
            "classifier temp == 0.0 (A2)": temp == 0.0,
        }
        for label, passed in checks.items():
            print(f"  [{'ok' if passed else 'FAIL'}] {name}: {label}")
            ok = ok and passed
    print("\nVERIFY: " + ("all checks passed" if ok else "FAILURES present"))
    if not ok:
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verify", action="store_true",
                    help="check all ADO #26 changes are live; exit 1 if not")
    ap.add_argument("--schema-id", default=None,
                    help="restrict to one learning_system_schemas id (recommended on prod)")
    args = ap.parse_args()
    if args.verify:
        return verify()
    dry = args.dry_run

    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, descision_tree FROM learning_system_schemas")
            schemas = cur.fetchall()
    finally:
        conn.close()

    for row in schemas:
        dt = row["descision_tree"] or {}
        registry = dt.get("prompt_registry", {})
        if "system_prompt" not in registry:
            continue
        schema_id, name = row["id"], row["name"]
        if args.schema_id and str(schema_id) != args.schema_id:
            continue
        print(f"\n== schema {name} ({schema_id}) ==")

        # A2: classifier temperature (raw config write, own connection)
        c2 = db.get_conn()
        try:
            with c2.cursor() as cur:
                # re-fetch within this txn for a clean write
                cur.execute("SELECT descision_tree FROM learning_system_schemas WHERE id=%s",
                            (schema_id,))
                dt2 = cur.fetchone()["descision_tree"] or {}
                print("  A2 classifier-temp:", _set_classifier_temp(cur, schema_id, dt2, dry))
            if not dry:
                c2.commit()
        finally:
            c2.close()

        # B + C*: system_prompt block rewrites
        def sysp(tmpl):
            out = tmpl
            if ACK_MARKER not in out:
                out = ACK_RE.sub(lambda _: ACK_NEW, out, count=1)
            if SUG_MARKER not in out:
                out = SUG_RE.sub(lambda _: SUG_NEW, out, count=1)
            for a, b in OUTPUT_SUBS:
                out = out.replace(a, b)
            # Exact-string replaces silently no-op if prod wording drifted; warn
            # loudly rather than ship the old <SUGGESTIONS> mandate under a green log.
            if "AND <SUGGESTIONS>" in out:
                print("  !! WARNING: OUTPUT_REQUIREMENTS still mandates <SUGGESTIONS> "
                      "(wording drifted; OUTPUT_SUBS did not match) — fix before enabling chips")
            return out
        print("  B/C* system_prompt:",
              _edit_template(name, schema_id, registry, "system_prompt", sysp, dry,
                             "ADO #26: de-parrot + app-authored chips"))

        # B: soften per-template acknowledge line
        def soften(tmpl):
            out = tmpl
            for a, b in ACK_LINE_SUBS:
                out = out.replace(a, b)
            return out
        for pid in TEACH_TEMPLATES:
            r = _edit_template(name, schema_id, registry, pid, soften, dry,
                               "ADO #26: soften acknowledge-first")
            if r and "unchanged" not in r:
                print("  B teach-line:", r)

        # D: step_try_hint (create if absent)
        existing = (registry.get("step_try_hint") or {}).get("template", "")
        if existing.strip():
            print("  D step_try_hint: already present")
        elif dry:
            print("  D step_try_hint: would create")
        else:
            res = db.apply_prompt_template(schema_id, "step_try_hint", STEP_TRY_HINT,
                                           author="maintainer", source="manual",
                                           note="ADO #26 D: TRY hint", allow_create=True)
            print("  D step_try_hint:", res["status"])

        # A*: assessment_user_prompt ladder + parroting
        def assess(tmpl):
            return tmpl if ASSESS_MARKER in tmpl else tmpl + ASSESS_APPEND
        print("  A* assessor-rule:",
              _edit_template(name, schema_id, registry, "assessment_user_prompt",
                             assess, dry, "ADO #26 A*: TEACH ladder + parroting"))

    print("\nDone." + (" (dry run)" if dry else ""))


if __name__ == "__main__":
    main()
