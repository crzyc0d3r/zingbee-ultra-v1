"""Apply the ADO #28 evidence-probe template to the live prompt registry.

Adds ONE new template — `step_evidence_probe` — rendered when the No-Completion-
Without-Evidence guard catches a pass-graded EVIDENCE turn that produced no
substantive response (a bare "yes" / "I understand" / chip click). The probe
asks the learner to show their thinking before the capsule can be marked
complete (see api/session_engine.py `_evidence_substance_guard`).

Idempotent: a schema that already has a non-empty step_evidence_probe is
skipped. All writes are versioned in prompt_versions (source="manual") — revert
by re-applying a prior version's content (a freshly created template's only
prior content is empty, which the guard treats as "inactive").

Safe to run BEFORE the code deploy: an unused template is inert; the guard only
fires once api/session_engine.py ships. Run from repo root with the API env:
    python scripts/apply_evidence_guard_prompts.py [--dry-run]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / "api" / ".env")

import db  # noqa: E402


# The probe must: acknowledge warmly (never imply the answer was wrong — the
# assessor already graded it correct), ask the learner to SHOW their thinking,
# offer an application example as an alternative to explaining (lower written-
# production load for dyslexic learners), vary phrasing so a 2nd probe doesn't
# read as the tutor looping, never reveal the answer, and carry NO <SUGGESTIONS>
# (EVIDENCE is chip-free — a click can't substitute for produced evidence).
STEP_EVIDENCE_PROBE = """<STEP_TRANSITION step="EVIDENCE_PROBE">
  <FACT_BEING_ASSESSED>$core_fact</FACT_BEING_ASSESSED>
  <LEARNING_OBJECTIVE>$process</LEARNING_OBJECTIVE>
  <KEY_VOCABULARY>$vocabulary</KEY_VOCABULARY>
  <CONTEXT>
    The student signalled they understand, but hasn't yet PUT IT IN THEIR OWN
    WORDS. A capsule can't be marked mastered until they produce a written or
    spoken response showing understanding, application, or reasoning — a "yes"
    or a button click is not evidence. This is the only thing standing between
    them and finishing, so keep it light and encouraging.
  </CONTEXT>
  <INSTRUCTIONS>
    - FIRST sentence: warm acknowledgment. They are NOT wrong and must never
      feel they are ("Awesome — I can tell this is clicking!").
    - Then ask them to show their thinking ONE of two ways (pick whichever fits,
      and vary your wording if you have asked once already so it never sounds
      like you are repeating yourself):
        a) explain $core_fact in their own words, OR
        b) give one real example of where they'd use or see it.
    - Make it feel like a friendly invitation, not a test or a gotcha.
    - Do NOT reveal or restate the answer for them — the point is to hear THEIR
      understanding.
    - 2-4 short sentences. No image. No <SUGGESTIONS>.
  </INSTRUCTIONS>
</STEP_TRANSITION>"""


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

    created, skipped = 0, 0
    for row in schemas:
        dt = row["descision_tree"] or {}
        registry = dt.get("prompt_registry", {})
        if "system_prompt" not in registry:
            continue  # not a live tutor schema
        schema_id, name = row["id"], row["name"]

        if (registry.get("step_evidence_probe") or {}).get("template"):
            print(f"  -- {name} ({schema_id}): step_evidence_probe already exists — skipped")
            skipped += 1
            continue
        if args.dry_run:
            print(f"  ?? {name} ({schema_id}): would create step_evidence_probe (dry run)")
            continue
        res = db.apply_prompt_template(schema_id, "step_evidence_probe",
                                       STEP_EVIDENCE_PROBE,
                                       author="maintainer", source="manual",
                                       note="ADO #28 evidence probe template",
                                       allow_create=True)
        print(f"  ok {name} ({schema_id}): created -> {res['status']}")
        created += 1

    print(f"\nDone: {created} created, {skipped} already present"
          f"{' (dry run)' if args.dry_run else ''}.")


if __name__ == "__main__":
    main()
