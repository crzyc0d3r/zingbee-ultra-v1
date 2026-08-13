"""Apply ADO #26 engagement-prompt template updates to the live prompt registry.

Replaces the binary I-understand chips with conversational engagement prompts:
- system_prompt: intent-tagged <SUGGESTED_RESPONSES> spec, acknowledge-first
  rule, TEACH engagement question, RECALL chips
- step_teach* templates: acknowledgment + engagement-question instructions
- assessment_user_prompt: tutor_missing_acknowledgment compliance flag
- 5 new templates: step_teach_example, step_teach_explore, step_recall_engage,
  step_capsule_closure, step_capsule_closure_recap

Idempotent: anchored replacements are skipped when the anchor is already gone
(apply_prompt_template also returns "unchanged" for no-op rewrites).
All writes are versioned in prompt_versions (source="manual") — revert by
re-applying any prior version's content.

Run from repo root with the API env available:
    python scripts/apply_engagement_prompts.py [--dry-run]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / "api" / ".env")

import db  # noqa: E402


# ---------------------------------------------------------------------------
# Anchored replacements on existing templates: (old_substring, new_substring).
# The old substring must match the live template exactly; if it is missing the
# replacement is reported and skipped (likely already applied or diverged).
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_EDITS = [
    # 1. Acknowledge-first rule (inserted before RESPONSE_LENGTH)
    ("<RESPONSE_LENGTH>",
     "<ACKNOWLEDGE_FIRST>\n"
     "  Your FIRST sentence in every response must acknowledge what the student\n"
     "  just said: engage with their answer, their question, their choice, or\n"
     "  their feeling. Never silently move on to the next thing. This applies\n"
     "  in every step. Acknowledgment is specific (\"Right, the squirrel IS an\n"
     "  organism because it grows and responds\") not generic (\"Great job!\").\n"
     "</ACKNOWLEDGE_FIRST>\n"
     "<RESPONSE_LENGTH>"),

    # 2. RECALL now carries suggestions
    ("  - RECALL:   no image. no suggestions.\n</OUTPUT_REQUIREMENTS>",
     "  - RECALL:   no image. include <SUGGESTIONS>.\n</OUTPUT_REQUIREMENTS>"),

    # 3. TEACH step: the closing engagement question replaces "no questions ever"
    ("    PURPOSE: Explain ONE fact. NO questions.",
     "    PURPOSE: Explain ONE fact, then offer a genuine choice of what to do\n"
     "    next. No comprehension-check or content-testing questions."),
    ("    - Stop. Do not ask if it makes sense or if they are ready.",
     "    - END with ONE engagement question offering a genuine choice tied to\n"
     "      what you just taught (work an example together / try it yourself /\n"
     "      explore deeper). Vary the phrasing every turn. Your <SUGGESTIONS>\n"
     "      chips MUST mirror the choices you offered.\n"
     "    - Never ask \"Does that make sense?\" or \"Ready?\". A genuine choice,\n"
     "      not a comprehension check."),
    ("    Do not:\n    - Ask any question (\"Does that make sense?\", \"Ready?\", \"Sound good?\")",
     "    Do not:\n"
     "    - Ask comprehension-check questions (\"Does that make sense?\", \"Ready?\",\n"
     "      \"Sound good?\") or content-testing questions. The ONLY question\n"
     "      allowed is the closing engagement question offering a choice."),

    # 4. TEACH example: engagement question + intent-tagged chips
    ("      <SUGGESTIONS>\n"
     "      - Can you give me another example?\n"
     "      - I don't understand yet\n"
     "      - Oh that makes sense, like a thermostat\n"
     "      - What happens if homeostasis stops working?\n"
     "      </SUGGESTIONS>",
     "      Want to see homeostasis in action with another example, or do you\n"
     "      feel ready to try one yourself?\n"
     "      <SUGGESTIONS>\n"
     "      - confused: I'm not sure I get it yet\n"
     "      - example: Show me homeostasis in action\n"
     "      - ready: I'm ready to try one\n"
     "      </SUGGESTIONS>"),

    # 5. RECALL step behavior: chips allowed
    ("    \"Last time we learned...\" Correct: affirm. Wrong: brief reminder.\n"
     "    No image. No suggestions. No new material.",
     "    \"Last time we learned...\" Correct: affirm. Wrong: brief reminder.\n"
     "    No image. No new material. Include <SUGGESTIONS> with a recall_more\n"
     "    chip (more recall practice) and a continue chip (start new material)."),

    # 6. The intent-tagged SUGGESTED_RESPONSES spec (replaces the fixed-pair spec)
    ("<SUGGESTED_RESPONSES>\n"
     "  TEACH STEP ONLY. Include a <SUGGESTIONS> block ONLY during TEACH.\n"
     "  Never include <SUGGESTIONS> during TRY, CHECK, EVIDENCE, or RECALL.\n"
     "  This is a hard rule. No exceptions.\n"
     "  TEACH format:\n"
     "  <SUGGESTIONS>\n"
     "  - Can you give me another example?\n"
     "  - I don't understand yet\n"
     "  - <acknowledgement of understanding>\n"
     "  - <followup question>\n"
     "  </SUGGESTIONS>\n"
     "  Exactly 4 items. Items 1-2 fixed. Items 3-4 dynamic, written from the\n"
     "  student's voice and tied to the fact you just taught. Each under 12 words.\n"
     "</SUGGESTED_RESPONSES>",
     "<SUGGESTED_RESPONSES>\n"
     "  Include a <SUGGESTIONS> block during TEACH and RECALL (and when a\n"
     "  closure instruction asks for one). Never during TRY, CHECK, or EVIDENCE.\n"
     "  This is a hard rule. No exceptions.\n"
     "  Format: 2-3 items, one per line, each written as `intent: text`:\n"
     "  <SUGGESTIONS>\n"
     "  - confused: I'm not sure I follow yet\n"
     "  - example: Can we see this in a real story?\n"
     "  - ready: I'm ready to try it myself\n"
     "  </SUGGESTIONS>\n"
     "  RULES:\n"
     "  - intent is one of: example, ready, explore, confused, continue, recap,\n"
     "    end, recall_more. The prefix is stripped before the student sees it.\n"
     "  - text is in the STUDENT's voice, under 12 words, specific to what you\n"
     "    just taught. NEVER the generic pair \"Got it\" / \"I don't understand\".\n"
     "  - The chips MUST mirror the choices your message offered. If you asked\n"
     "    \"shall we work an example, or try it yourself?\", emit an example:\n"
     "    chip and a ready: chip.\n"
     "  - Order: help options first (confused / example / explore), the advance\n"
     "    option (ready / continue) LAST. Keep that order every time.\n"
     "  - Vary the wording every turn. Never repeat the previous turn's chips.\n"
     "  - Never use the words \"skip\", \"move on\", \"already know\", or\n"
     "    \"next fact\" in chip text.\n"
     "  - Intent meanings: example = worked example together; explore = stretch\n"
     "    question / deeper dive; ready = student tries now; confused = needs a\n"
     "    different explanation; continue = keep going; recall_more = more\n"
     "    recall practice (RECALL only); recap / end = closure choices.\n"
     "</SUGGESTED_RESPONSES>"),
]

# The missing_acknowledgment rule judges against TUTOR_REPLIED_TO (the message
# the tutor's latest response actually replied to) — NOT STUDENT_LAST_MESSAGE.
# The assessor runs BEFORE the tutor's reply exists, so TUTOR_LATEST_RESPONSE is
# the tutor's prior message; it predates STUDENT_LAST_MESSAGE and cannot
# acknowledge it (the un-fixed wording false-flagged ~60% of turns — PR #77
# thread 130). Single edit (no stacked rewording) so a fresh prod run applies
# the final wording in one pass.
_ACK_RULE = (
    "- missing_acknowledgment=true if TUTOR_LATEST_RESPONSE does not open by\n"
    "  engaging with TUTOR_REPLIED_TO (the student message it was replying to)\n"
    "  before introducing anything new. CRITICAL: judge against TUTOR_REPLIED_TO,\n"
    "  NOT STUDENT_LAST_MESSAGE — the latest response was written before\n"
    "  STUDENT_LAST_MESSAGE and cannot acknowledge it. A generic opener\n"
    "  (\"Great job!\") that could follow ANY message counts as missing. Set false\n"
    "  when it engages specifically with TUTOR_REPLIED_TO, or when TUTOR_REPLIED_TO\n"
    "  is empty (session opener).")

ASSESSMENT_EDITS = [
    ("- missing_suggestions=true if TEACH and no <SUGGESTIONS>. TRY/CHECK/EVIDENCE must NOT have <SUGGESTIONS>.",
     "- missing_suggestions=true if TEACH or RECALL and no <SUGGESTIONS>. TRY/CHECK/EVIDENCE must NOT have <SUGGESTIONS>.\n"
     + _ACK_RULE),
    ("    \"tutor_missing_suggestions\": true/false,",
     "    \"tutor_missing_suggestions\": true/false,\n"
     "    \"tutor_missing_acknowledgment\": true/false,"),
    # Surface the TUTOR_REPLIED_TO variable the rule above references.
    ('<STUDENT_LAST_MESSAGE description="responding to TUTOR_PREVIOUS_MESSAGE">',
     '<TUTOR_REPLIED_TO description="the student message TUTOR_LATEST_RESPONSE was '
     'written in reply to; acknowledgment is judged against THIS message">\n'
     '$tutor_replied_to\n'
     '</TUTOR_REPLIED_TO>\n'
     '<STUDENT_LAST_MESSAGE description="responding to TUTOR_PREVIOUS_MESSAGE">'),
]

STEP_EDITS = {
    "step_teach": [
        ("  <INSTRUCTIONS>\n    - Explain with analogy + example. ",
         "  <INSTRUCTIONS>\n"
         "    - Acknowledge the student's previous response in your FIRST sentence.\n"
         "    - Explain with analogy + example. "),
        ("    - ZERO questions. \n    - ZERO recap. This fact only.",
         "    - ZERO recap. This fact only.\n"
         "    - No comprehension-check or content-testing questions.\n"
         "    - END with ONE engagement question offering a genuine choice\n"
         "      (example together / try it yourself / explore deeper). The\n"
         "      <SUGGESTIONS> chips must mirror the choices you offered."),
    ],
    "step_teach_confused": [
        ("  <INSTRUCTIONS>\n    - SIMPLER language, everyday analogy, smaller pieces. ",
         "  <INSTRUCTIONS>\n"
         "    - FIRST sentence: acknowledge their confusion warmly. Being confused\n"
         "      is a normal part of learning, never a failure.\n"
         "    - SIMPLER language, everyday analogy, smaller pieces. "),
        ("    - ZERO questions. \n    - Stay objective with how you treat the student.",
         "    - Stay objective with how you treat the student.\n"
         "    - END with ONE engagement question offering a genuine choice\n"
         "      (another way of explaining / an example / try it). Chips mirror it."),
    ],
    "step_teach_reteach": [
        ("  <INSTRUCTIONS>\n    - Re-explain targeting struggle. If misconception: address directly.",
         "  <INSTRUCTIONS>\n"
         "    - FIRST sentence: acknowledge their last response warmly, without\n"
         "      dwelling on the mistake.\n"
         "    - Re-explain targeting struggle. If misconception: address directly."),
        ("    - ZERO questions. \n    - ZERO references of failed attempt.",
         "    - ZERO references of failed attempt.\n"
         "    - END with ONE engagement question offering a genuine choice\n"
         "      (an example / try again / explain differently). Chips mirror it."),
    ],
    "step_teach_continue": [
        ("  <INSTRUCTIONS>\n    - Same fact: DIFFERENT analogy. New fact: smooth transition.",
         "  <INSTRUCTIONS>\n"
         "    - Acknowledge the student's previous response in your FIRST sentence.\n"
         "    - Same fact: DIFFERENT analogy. New fact: smooth transition."),
        ("    - Explain, vocabulary, process, misconception. \n    - ZERO questions.",
         "    - Explain, vocabulary, process, misconception.\n"
         "    - No comprehension-check or content-testing questions.\n"
         "    - END with ONE engagement question offering a genuine choice. The\n"
         "      <SUGGESTIONS> chips must mirror the choices you offered."),
    ],
    "step_check_remediation": [
        ("  <INSTRUCTIONS>\n    - Teach using STRETCH: \"$stretch\". Deeper perspective. Vocabulary.",
         "  <INSTRUCTIONS>\n"
         "    - Acknowledge the student's previous response in your FIRST sentence.\n"
         "    - Teach using STRETCH: \"$stretch\". Deeper perspective. Vocabulary."),
    ],
}

# ---------------------------------------------------------------------------
# New templates (allow_create=True)
# ---------------------------------------------------------------------------

NEW_TEMPLATES = {
    "step_teach_example": """<STEP_TRANSITION step="TEACH_EXAMPLE">
  <FACT_TO_TEACH>$core_fact</FACT_TO_TEACH>
  <LEARNING_OBJECTIVE>$process</LEARNING_OBJECTIVE>
  <KEY_VOCABULARY>$vocabulary</KEY_VOCABULARY>
  <COMMON_MISCONCEPTION>$misconception</COMMON_MISCONCEPTION>
  <CONTEXT>The student CHOSE to see a worked example. Honor that choice.</CONTEXT>
  <INSTRUCTIONS>
    - FIRST sentence: acknowledge their choice ("Good call, let's walk through one together.").
    - Walk through ONE concrete worked example of $core_fact, step by step,
      inside your established scaffold (same character, setting, analogy).
    - Narrate the thinking: WHY each step happens, not just what happens.
    - Keep it tight: 4-6 short sentences.
    - END with ONE engagement question offering a genuine choice
      (another example / try one yourself / dig deeper). Chips mirror it.
    - <EDUCATIONAL_IMAGE />
    - <SUGGESTIONS />
  </INSTRUCTIONS>
</STEP_TRANSITION>""",

    "step_teach_explore": """<STEP_TRANSITION step="TEACH_EXPLORE">
  <FACT_TO_TEACH>$core_fact</FACT_TO_TEACH>
  <KEY_VOCABULARY>$vocabulary</KEY_VOCABULARY>
  <STRETCH_QUESTIONS>
$stretch_questions
  </STRETCH_QUESTIONS>
  <CONTEXT>The student CHOSE to explore this idea more deeply. Honor their curiosity.</CONTEXT>
  <INSTRUCTIONS>
    - FIRST sentence: acknowledge their curiosity specifically. It is a strength.
    - Pick ONE stretch question from STRETCH_QUESTIONS (or follow its
      instruction when none are listed) and explore it WITH the student:
      pose it, think out loud for one step, then invite their take.
    - Stay inside $core_fact territory. Keep the established scaffold.
    - 3-5 short sentences.
    - END with ONE engagement question (explore further / back to practicing).
      Chips mirror it.
    - <EDUCATIONAL_IMAGE />
    - <SUGGESTIONS />
  </INSTRUCTIONS>
</STEP_TRANSITION>""",

    "step_recall_engage": """<STEP_TRANSITION step="RECALL_ENGAGE">
  <CONTEXT>The student CHOSE more recall practice before new material.</CONTEXT>
  <INSTRUCTIONS>
    - FIRST sentence: acknowledge their choice ("Love it, let's warm up a little more.").
    - Ask ONE light recall question about a fact from their previous session
      (see the conversation so far), different from what you just asked.
      Conversational, not test-like.
    - Do not mark right or wrong harshly: acknowledge and bridge.
    - No image. Include <SUGGESTIONS> with a recall_more chip and a continue chip.
  </INSTRUCTIONS>
</STEP_TRANSITION>""",

    "step_capsule_closure": """<STEP_TRANSITION step="CAPSULE_CLOSURE">
  <PROGRESS>Mastered: $mastered_count / $total_facts</PROGRESS>
  <INSTRUCTIONS>
    - The student just finished the capsule. FIRST: acknowledge their final
      answer specifically.
    - Celebrate genuinely and personally: name ONE thing they did well today
      (a specific answer, a good question they asked, their persistence).
    - ONE sentence recap of the big idea of $capsule_name.
    - Then offer a genuine choice: a recap of everything they learned today,
      or wrapping up here.
    - Warm, proud tone. 3-5 short sentences. No image.
    - Include <SUGGESTIONS> with a recap chip and an end chip.
  </INSTRUCTIONS>
</STEP_TRANSITION>""",

    "step_capsule_closure_recap": """<STEP_TRANSITION step="CAPSULE_CLOSURE_RECAP">
  <INSTRUCTIONS>
    - The student chose a recap. Acknowledge that choice first.
    - Recap what they learned today as THEIR achievements ("You figured out
      that..."), one line per big idea, in the order they learned them.
    - End with one forward-looking sentence about what comes next time, and a
      warm goodbye.
    - No image. No <SUGGESTIONS> (the session ends after their reply).
  </INSTRUCTIONS>
</STEP_TRANSITION>""",
}


_FAILURES = []


def _apply_edits(schema_id, registry, prompt_id, edits, dry_run):
    tmpl = (registry.get(prompt_id) or {}).get("template", "")
    if not tmpl:
        print(f"  !! {prompt_id}: not found in registry — skipped")
        _FAILURES.append(f"{prompt_id}: missing from registry")
        return
    new = tmpl
    applied, skipped = 0, 0
    for old, replacement in edits:
        # Idempotency: the FULL replacement already present means this edit
        # was applied on a prior run — never re-apply (some anchors, like
        # <RESPONSE_LENGTH>, deliberately survive their own replacement).
        if replacement in new:
            skipped += 1
            continue
        count = new.count(old)
        if count == 1:
            new = new.replace(old, replacement)
            applied += 1
        else:
            msg = (f"{prompt_id}: anchor matched {count} times (need exactly 1) "
                   f"and replacement absent: {old[:60]!r}...")
            print(f"  !! {msg}")
            _FAILURES.append(msg)
    if new == tmpl:
        print(f"  -- {prompt_id}: no changes ({skipped} already applied)")
        return
    if dry_run:
        print(f"  ?? {prompt_id}: would apply {applied} edits (dry run)")
        return
    res = db.apply_prompt_template(schema_id, prompt_id, new,
                                   author="maintainer", source="manual",
                                   note="ADO #26 conversational engagement prompts")
    print(f"  ok {prompt_id}: {applied} edits -> {res['status']}")


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

    for row in schemas:
        dt = row["descision_tree"] or {}
        registry = dt.get("prompt_registry", {})
        if "system_prompt" not in registry:
            continue
        schema_id = row["id"]
        print(f"schema {row['name']} ({schema_id}):")

        _apply_edits(schema_id, registry, "system_prompt", SYSTEM_PROMPT_EDITS, args.dry_run)
        _apply_edits(schema_id, registry, "assessment_user_prompt", ASSESSMENT_EDITS, args.dry_run)
        for pid, edits in STEP_EDITS.items():
            _apply_edits(schema_id, registry, pid, edits, args.dry_run)

        for pid, content in NEW_TEMPLATES.items():
            if pid in registry and (registry[pid] or {}).get("template"):
                print(f"  -- {pid}: already exists — skipped")
                continue
            if args.dry_run:
                print(f"  ?? {pid}: would create (dry run)")
                continue
            res = db.apply_prompt_template(schema_id, pid, content,
                                           author="maintainer", source="manual",
                                           note="ADO #26 new engagement template",
                                           allow_create=True)
            print(f"  ok {pid}: created -> {res['status']}")

    if _FAILURES:
        print(f"\n{len(_FAILURES)} edit(s) FAILED — registry has drifted from the "
              f"expected content. Review before re-running:")
        for f in _FAILURES:
            print(f"  - {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
