"""ADO #26 engagement-quality before/after eval.

BEFORE  = real prod sessions (old behavior: LLM-authored chips, parroting, camping)
          read from /tmp/zbeval/before_*.tsv  (role<TAB>prompt_id<TAB>content)
AFTER   = (1) analytic chip-intent diversity from the deterministic builder, and
          (2) a fresh on-topic local session driven through the chat API.

Objective metrics (mapped to the user's complaints):
  - parroting rate     : tutor's first sentence echoes the student's words
  - chip semantic-diversity : consecutive-turn intent-set repeats (the "always
                         example+ready" collapse) + distinct intent sets
  - progression        : facts reaching mastery / phase advancement (no camping)

Run with the API up (flags on) from repo root:
    python scripts/eval_engagement_before_after.py
"""

import glob
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))
import engagement  # noqa: E402

EVAL_DIR = str(Path(__file__).resolve().parents[1] / ".eval")  # native path (Win-safe)
# Local-only by default. The live arm writes real session rows for EVAL_SID, so
# credentials come from the environment (never hardcoded) and the target must be
# localhost unless EVAL_ALLOW_REMOTE=1 is set explicitly.
API = os.environ.get("EVAL_API", "http://127.0.0.1:9000")
SID = os.environ.get("EVAL_SID", "")
EVAL_EMAIL = os.environ.get("EVAL_EMAIL", "")
EVAL_PASSWORD = os.environ.get("EVAL_PASSWORD", "")
STOP = {"the", "a", "an", "is", "are", "was", "were", "and", "or", "but", "to",
        "of", "in", "on", "it", "that", "this", "i", "you", "we", "they", "so",
        "do", "does", "what", "how", "why", "can", "with", "for", "as", "be"}


def _words(s):
    return [w for w in re.findall(r"[a-z]{3,}", (s or "").lower()) if w not in STOP]


def _first_sentence(s):
    s = re.sub(r"<EDUCATIONAL_IMAGE>.*?</EDUCATIONAL_IMAGE>", "", s or "", flags=re.S)
    s = engagement._INTENT_PREFIX and re.sub(r"<SUGGESTIONS>.*?</SUGGESTIONS>", "", s, flags=re.S)
    s = " ".join(s.split())
    m = re.split(r"(?<=[.!?])\s", s, maxsplit=1)
    return m[0] if m else s


def _is_parroting(tutor_text, student_text):
    """Tutor's opener restates the student's words (echo). >=50% of the
    student's content words reappear in the tutor's first sentence."""
    sw = set(_words(student_text))
    if len(sw) < 2:
        return False  # nothing substantive to echo
    fs = set(_words(_first_sentence(tutor_text)))
    overlap = len(sw & fs) / len(sw)
    return overlap >= 0.5


def _chip_intents_from_content(content):
    """Parse <SUGGESTIONS> intents from a stored tutor message (before data)."""
    m = re.search(r"<SUGGESTIONS>(.*?)</SUGGESTIONS>", content or "", flags=re.S)
    if not m:
        return None
    lines = [ln.strip().lstrip("-").strip() for ln in m.group(1).splitlines() if ln.strip()]
    tagged = engagement.tag_suggestions(lines)
    intents = tuple(c["intent"] for c in tagged if c["intent"])
    return intents or None


def _diversity(seq_of_sets):
    """Given a list of intent/text frozensets per turn, return repeat_rate and
    distinct fraction."""
    seq = [s for s in seq_of_sets if s]
    if len(seq) < 2:
        return None
    repeats = sum(1 for i in range(1, len(seq)) if seq[i] == seq[i - 1])
    return {
        "turns": len(seq),
        "consecutive_repeat_rate": round(repeats / (len(seq) - 1), 2),
        "distinct_sets": len({frozenset(s) for s in seq}),
    }


# ---------------------------------------------------------------------------
# BEFORE (prod)
# ---------------------------------------------------------------------------
def eval_before():
    out = {}
    for path in sorted(glob.glob(f"{EVAL_DIR}/before_*.tsv")):
        rows = []
        for ln in open(path, encoding="utf-8", errors="replace"):
            # gcloud->psql mangled the tab separator into the literal 'E\t'.
            parts = ln.rstrip("\n").split("E\\t", 2)
            if len(parts) >= 3:
                rows.append((parts[0], parts[1], parts[2].replace("\\n", "\n")))
        parrot_hits = parrot_total = 0
        intent_seq = []
        prompt_ids = {}
        prev_student = None
        for role, pid, content in rows:
            if role == "user":
                prev_student = content
            elif role == "assistant":
                prompt_ids[pid] = prompt_ids.get(pid, 0) + 1
                if prev_student is not None:
                    parrot_total += 1
                    if _is_parroting(content, prev_student):
                        parrot_hits += 1
                ci = _chip_intents_from_content(content)
                if ci:
                    intent_seq.append(ci)
                prev_student = None
        name = os.path.basename(path).replace("before_", "").replace(".tsv", "")[:8]
        out[name] = {
            "parroting_rate": round(parrot_hits / parrot_total, 2) if parrot_total else None,
            "parrot_n": parrot_total,
            "chip_intent_diversity": _diversity(intent_seq),
            "step_teach_continue_share": round(
                prompt_ids.get("step_teach_continue", 0) / max(sum(prompt_ids.values()), 1), 2),
            "assistant_turns": sum(prompt_ids.values()),
        }
    return out


# ---------------------------------------------------------------------------
# AFTER — analytic chip diversity from the deterministic builder
# ---------------------------------------------------------------------------
def eval_after_builder(n=12):
    meta = {"core_fact": "All living things are organisms", "vocabulary": "organism; life process"}
    seq, last = [], None
    anchored = 0
    for i in range(n):
        chips = engagement.build_fact_chips("TEACH", None, meta, i, last_offered=last)
        intents = tuple(c["intent"] for c in chips)
        last = [c["intent"] for c in chips]
        seq.append(intents)
        if any("organism" in c["text"].lower() for c in chips):
            anchored += 1
    div = _diversity(seq)
    div["topic_anchored_turns"] = f"{anchored}/{n}"
    return div


# ---------------------------------------------------------------------------
# AFTER — live on-topic session through the API
# ---------------------------------------------------------------------------
def eval_after_live():
    import requests
    # Safety: never run the destructive live arm against a non-local target by
    # accident, and require credentials from the environment.
    if not (API.startswith("http://127.0.0.1") or API.startswith("http://localhost")
            or os.environ.get("EVAL_ALLOW_REMOTE") == "1"):
        raise RuntimeError(f"refusing live eval against non-local API {API!r} "
                           "(set EVAL_ALLOW_REMOTE=1 to override)")
    if not (EVAL_EMAIL and EVAL_PASSWORD and SID):
        raise RuntimeError("set EVAL_EMAIL, EVAL_PASSWORD, and EVAL_SID to run "
                           "the live arm (no credentials are hardcoded)")
    s = requests.Session()
    r = s.post(f"{API}/api/login", json={"email": EVAL_EMAIL,
               "password": EVAL_PASSWORD, "turnstile_token": ""}, timeout=30)
    r.raise_for_status()
    s.get(f"{API}/api/session/{SID}", timeout=60)

    def phase():
        return s.get(f"{API}/api/session/{SID}", timeout=60).json()\
                .get("progress", {}).get("step_name")

    turns = []

    def turn(msg, greeting=False):
        body = {"message": msg, "student_id": SID, "subject": "Biology",
                "greeting": greeting, "tutor_id": None}
        d = s.post(f"{API}/api/chat", json=body, timeout=180).json()
        turns.append({"student": msg, "tutor": d.get("response", ""),
                      "chips": d.get("suggestions", []), "phase": phase()})

    # On-topic answers for "Characteristics of Life" so A* can actually advance.
    turn("", greeting=True)
    turn("Quiz me on what we did last time")
    turn("All living things are called organisms")
    turn("Life processes are things like eating, breathing, growing and moving")
    turn("A dog is an organism because it grows, eats and reproduces")
    turn("Yes, plants are organisms too since they grow and need food")
    turn("Reproduction means making more of the same living thing")

    parrot_hits = parrot_total = 0
    chip_text_seq = []
    for t in turns:
        if t["student"]:
            parrot_total += 1
            if _is_parroting(t["tutor"], t["student"]):
                parrot_hits += 1
        if t["chips"]:
            chip_text_seq.append(tuple(t["chips"]))
    phases = [t["phase"] for t in turns]
    return {
        "parroting_rate": round(parrot_hits / parrot_total, 2) if parrot_total else None,
        "parrot_n": parrot_total,
        "chip_text_diversity": _diversity(chip_text_seq),
        "phases_visited": phases,
        "distinct_phases": sorted(set(p for p in phases if p)),
        "transcript": turns,
    }


def main():
    Path(EVAL_DIR).mkdir(parents=True, exist_ok=True)
    before = eval_before()
    after_builder = eval_after_builder()
    try:
        after_live = eval_after_live()
    except Exception as e:
        after_live = {"error": repr(e)}
    report = {"BEFORE_prod": before,
              "AFTER_builder_intents": after_builder,
              "AFTER_live_session": after_live}
    with open(f"{EVAL_DIR}/report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
