"""Enrich curriculum facts with student-facing vocabulary definitions (ADO #25).

The Vocabulary Bank panel needs a short definition per term, but the real
curriculum stores `meta_data.vocabulary` as a bare semicolon-separated string
of terms — no definitions. This script generates a one-sentence,
age-appropriate definition for each term and writes a NEW sibling key,
`meta_data.vocabulary_bank: [{term, definition}]`, leaving the legacy
`vocabulary` string untouched (so live prompts / assessor / old session blobs
are unaffected; rollback = ignore the new key).

Definition constraints baked into the prompt:
  - one sentence, plain language matched to the fact's phase age-range,
  - metaphor-neutral (a session picks its own sustained metaphor),
  - non-circular (never define a term using the term),
  - child-safe (definitions are shown directly to students).

Idempotent: a fact whose vocabulary_bank already covers all its current terms
is skipped, so re-runs only fill gaps (e.g. after a curriculum re-import).

Usage (from repo root, with the API env):
    python scripts/generate_vocab_definitions.py --sample 25      # review only, no writes
    python scripts/generate_vocab_definitions.py --subject Biology --dry-run
    python scripts/generate_vocab_definitions.py --subject Biology
    python scripts/generate_vocab_definitions.py                  # all subjects
"""

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))          # repo root — for the `tools` package
sys.path.insert(0, str(_ROOT / "api"))  # api modules (db, llm)

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / "api" / ".env")

import db  # noqa: E402
from llm import call_xai  # noqa: E402

# Cheap + deterministic: definitions are short, factual, and reviewed.
MODEL = None  # None -> llm default; override with --model
TEMPERATURE = 0.2
MAX_TOKENS = 800
BATCH_TERMS = 25  # terms per LLM call


def parse_terms(meta: dict) -> list:
    """Terms from the legacy semicolon string (the authoritative source list)."""
    raw = meta.get("vocabulary")
    if isinstance(raw, str):
        return [t.strip() for t in raw.split(";") if t.strip()]
    if isinstance(raw, list):
        out = []
        for v in raw:
            if isinstance(v, dict) and (v.get("term") or "").strip():
                out.append(v["term"].strip())
            elif isinstance(v, str) and v.strip():
                out.append(v.strip())
        return out
    return []


def existing_defs(meta: dict) -> dict:
    """term(lower) -> definition already present in vocabulary_bank."""
    out = {}
    for v in (meta.get("vocabulary_bank") or []):
        if isinstance(v, dict) and (v.get("term") or "").strip() and (v.get("definition") or "").strip():
            out[v["term"].strip().lower()] = v["definition"].strip()
    return out


def fetch_facts(subject=None):
    conditions, params = ["cf.meta_data->>'vocabulary' IS NOT NULL"], []
    if subject:
        conditions.append("s.name = %s")
        params.append(subject)
    where = " AND ".join(conditions)
    return db.fetchall(
        f"""
        SELECT cf.id AS fact_id,
               cf.meta_data AS fact_meta,
               cf.meta_data->>'core_fact' AS fact_text,
               sc.phase, sc.age_range, s.name AS subject_name
        FROM curriculum_facts cf
        JOIN curriculum_capsules cc ON cf.curriculum_capsule_id = cc.id
        JOIN curriculum_themes ct ON cc.curriculum_theme_id = ct.id
        JOIN subject_curriculum sc ON ct.subject_curriculum_id = sc.id
        JOIN subjects s ON sc.subject_id = s.id
        WHERE {where}
        ORDER BY s.name, sc.phase, cf."order"
        """,
        tuple(params),
    )


def build_prompt(terms, fact_text, subject, age_range):
    listing = "\n".join(f"- {t}" for t in terms)
    return [
        {"role": "system", "content":
            "You write short glossary definitions for a school tutoring app. "
            "Each definition is ONE sentence, in plain language a student in the "
            "given age range can read unaided. Define the term on its own terms — "
            "do NOT use the word itself in its definition, and do NOT lean on any "
            "story or metaphor (the lesson supplies its own). Keep it accurate and "
            "age-appropriate. Return ONLY a JSON object mapping each term to its "
            "definition, no commentary."},
        {"role": "user", "content":
            f"Subject: {subject}\nStudent age range: {age_range}\n"
            f"Lesson fact (context only): {fact_text}\n\n"
            f"Define these terms:\n{listing}\n\n"
            'Respond as JSON: {"term": "definition", ...}'},
    ]


def generate_defs(terms, fact_text, subject, age_range, model):
    """Return {term: definition}. Robust to fenced / noisy JSON."""
    resp = call_xai(build_prompt(terms, fact_text, subject, age_range),
                    temperature=TEMPERATURE, max_tokens=MAX_TOKENS, model=model)
    content = (getattr(resp, "content", "") or "").strip()
    if content.startswith("```"):
        content = content.split("```", 2)[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()
    try:
        data = json.loads(content)
    except Exception:
        # Salvage the largest brace span. Guard the ordering (start < end) and
        # the recovery parse so a malformed response yields {} instead of
        # raising and aborting the whole run.
        start, end = content.find("{"), content.rfind("}")
        data = {}
        if 0 <= start < end:
            try:
                data = json.loads(content[start:end + 1])
            except Exception:
                data = {}
    # case-insensitive lookup back onto the requested terms
    lowered = {k.strip().lower(): str(v).strip() for k, v in data.items()}
    return {t: lowered.get(t.lower(), "") for t in terms}


def merge_bank(meta: dict, defs: dict) -> list:
    """Build the vocabulary_bank array in the fact's term order, preserving any
    previously-stored definitions not regenerated this run."""
    prior = existing_defs(meta)
    bank = []
    for t in parse_terms(meta):
        d = defs.get(t) or prior.get(t.lower(), "")
        bank.append({"term": t, "definition": d})
    return bank


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subject", help="limit to one subject (e.g. Biology)")
    ap.add_argument("--dry-run", action="store_true", help="generate but do not write")
    ap.add_argument("--sample", type=int, metavar="N",
                    help="generate for the first N facts and print results; no writes")
    ap.add_argument("--model", default=MODEL)
    args = ap.parse_args()

    facts = fetch_facts(args.subject)
    print(f"Scanning {len(facts)} facts"
          + (f" in {args.subject}" if args.subject else "") + " ...")

    sample_left = args.sample if args.sample else None
    enriched_facts = skipped = term_count = failed = 0
    cov_missing = {}  # subject/phase -> count of terms left without a definition

    for f in facts:
        meta = f["fact_meta"] or {}
        terms = parse_terms(meta)
        if not terms:
            continue
        have = existing_defs(meta)
        missing = [t for t in terms if t.lower() not in have]
        if not missing and not args.sample:
            skipped += 1
            continue

        # Isolate each fact: a transient xAI failure on one fact must not abort
        # a multi-thousand-fact run. Writes are per-fact and idempotent, so a
        # re-run fills any skipped gaps.
        try:
            target_terms = terms if args.sample else missing
            defs = {}
            for i in range(0, len(target_terms), BATCH_TERMS):
                chunk = target_terms[i:i + BATCH_TERMS]
                defs.update(generate_defs(chunk, f["fact_text"] or "",
                                          f["subject_name"], f["age_range"], args.model))

            bank = merge_bank(meta, defs)
            blanks = [v["term"] for v in bank if not v["definition"]]
            if blanks:
                key = f"{f['subject_name']} P{f['phase']}"
                cov_missing[key] = cov_missing.get(key, 0) + len(blanks)

            if args.sample:
                print(f"\n[{f['subject_name']} P{f['phase']} · age {f['age_range']}] "
                      f"{(f['fact_text'] or '')[:70]}")
                for v in bank:
                    print(f"    {v['term']}: {v['definition'] or '(blank)'}")
                sample_left -= 1
                if sample_left <= 0:
                    break
                continue

            if args.dry_run:
                print(f"  ?? {f['fact_id']}: would write {len(bank)} terms "
                      f"({len(missing)} new)")
            else:
                # Merge only the vocabulary_bank key against the LIVE row (||), not
                # a full-object overwrite from the start-of-run snapshot — a
                # concurrent curriculum edit to other keys must not be clobbered.
                db.execute(
                    "UPDATE curriculum_facts "
                    "SET meta_data = meta_data || jsonb_build_object('vocabulary_bank', %s::jsonb) "
                    "WHERE id = %s",
                    (json.dumps(bank), f["fact_id"]))
                print(f"  ok {f['fact_id']}: wrote {len(bank)} terms ({len(missing)} new)")
            enriched_facts += 1
            term_count += len(bank)
        except Exception as e:
            failed += 1
            print(f"  !! {f['fact_id']}: FAILED ({e}) — skipping")

    print(f"\nDone: {enriched_facts} facts enriched, {skipped} already complete, "
          f"{failed} failed, {term_count} terms{' (dry run)' if args.dry_run else ''}"
          f"{' (sample only)' if args.sample else ''}.")
    if cov_missing:
        print("Terms left without a definition (review):")
        for k, n in sorted(cov_missing.items()):
            print(f"    {k}: {n}")


if __name__ == "__main__":
    main()
