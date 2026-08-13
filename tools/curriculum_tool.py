"""Curriculum reading tool for AutoGen agents. Reads from PostgreSQL."""

import json
import sys
from pathlib import Path

_project_root = str(Path(__file__).parent.parent)
sys.path.insert(0, _project_root)
sys.path.insert(0, str(Path(_project_root) / "api"))
import db as database


def _aggregate_from_facts(fact_list, field):
    """Collect enrichment items across all facts for a field, deduplicating.

    Handles both list values (old schema) and string values (new meta_data schema).
    """
    seen = set()
    result = []
    for f in fact_list:
        fact_data = f.get("fact") or {}
        val = fact_data.get(field)
        if val is None:
            continue
        # New schema stores strings; old schema stored lists
        items = val if isinstance(val, list) else [val]
        for item in items:
            if not item:
                continue
            key = json.dumps(item, sort_keys=True) if isinstance(item, dict) else str(item)
            if key not in seen:
                seen.add(key)
                result.append(item)
    return result


def _capsule_row_to_dict(row, facts=None):
    """Convert a capsule DB row + facts into the dict format web_ui.py expects."""
    if not row:
        return None
    fact_list = facts or database.get_core_facts(row["id"])
    # Enrichment keys in new meta_data schema
    _ENRICHMENT_KEYS = ("application", "process", "micro_check", "vocabulary",
                        "misconception", "evidence", "stretch")
    return {
        "id": str(row["id"]),
        "db_id": row["id"],
        "name": row["name"],
        "theme_name": row["theme_name"],
        "curriculum_theme_id": str(row["theme_db_id"]),
        "theme_db_id": row["theme_db_id"],
        "phase": row["phase"],
        "age_range": row.get("age_range", "10-12"),
        "credit_value": 0.25,
        "core_facts": [f["fact_text"] for f in fact_list],
        "_fact_id_map": {f["fact_text"]: f["id"] for f in fact_list},
        "_fact_difficulty": {f["fact_text"]: float(f.get("difficulty_weighting") or 0.5) for f in fact_list},
        "_fact_cycle": {f["fact_text"]: f.get("fact_cycle") for f in fact_list if f.get("fact_cycle")},
        "_fact_enrichment": {
            f["fact_text"]: {
                k: v for k, v in (f.get("fact") or {}).items()
                if k in _ENRICHMENT_KEYS and v
            }
            for f in fact_list
        },
        "processes": _aggregate_from_facts(fact_list, "process"),
        "applications": _aggregate_from_facts(fact_list, "application"),
        "misconceptions": _aggregate_from_facts(fact_list, "misconception"),
        "micro_checks": _aggregate_from_facts(fact_list, "micro_check"),
        "evidence_expectations": _aggregate_from_facts(fact_list, "evidence"),
        "mastery_indicator": "",
        "stretch_questions": _aggregate_from_facts(fact_list, "stretch"),
        "vocabulary": _aggregate_from_facts(fact_list, "vocabulary"),
        "curriculum_alignment": {},
    }


def get_curriculum_overview(phase: int = 1) -> str:
    """Get the Biology curriculum overview for a given phase."""
    sc = database.get_curriculum_overview(phase)
    if not sc:
        return "Error: Curriculum not found for phase"

    themes = database.get_themes_for_phase(phase)
    overview = {
        "subject": sc["subject_name"],
        "phase": sc["phase"],
        "age_range": sc.get("age_range", "10-12"),
        "total_credits": float(sc.get("total_credits", 4.0)),
        "themes": [],
    }
    for t in themes:
        capsules = database.fetchall("""
            SELECT name FROM curriculum_capsules WHERE curriculum_theme_id = %s ORDER BY capsule_order
        """, (t["id"],))
        overview["themes"].append({
            "id": str(t["id"]),
            "name": t["name"],
            "guiding_question": t.get("guiding_question", ""),
            "capsules": [c["name"] for c in capsules],
        })
    return json.dumps(overview, indent=2)


def get_capsule_content(curriculum_theme_id: str, curriculum_capsule_id: str, phase: int = 1) -> str:
    """Get detailed content for a specific capsule by UUID."""
    row = database.get_capsule_by_id(curriculum_capsule_id)
    if not row:
        return f"Error: Capsule {curriculum_capsule_id} not found in theme {curriculum_theme_id}"
    d = _capsule_row_to_dict(row)
    return json.dumps(d, indent=2)


def get_capsule_by_name(capsule_name: str) -> str:
    """Get capsule content by name. Searches all phases."""
    row = database.get_capsule_by_name(capsule_name)
    if not row:
        return f"Error: Capsule '{capsule_name}' not found"
    d = _capsule_row_to_dict(row)
    return json.dumps(d, indent=2)


def get_core_facts(capsule_name: str) -> str:
    """Get just the core facts for a capsule - for teaching."""
    row = database.get_capsule_by_name(capsule_name)
    if not row:
        return f"Error: Capsule '{capsule_name}' not found"
    facts = database.get_core_facts(row["id"])
    return json.dumps({
        "capsule": row["name"],
        "phase": row["phase"],
        "core_facts": [f["fact_text"] for f in facts],
        "vocabulary": _aggregate_from_facts(facts, "vocabulary"),
    }, indent=2)


def get_micro_checks(capsule_name: str) -> str:
    """Get the micro-check questions for a capsule - for assessment."""
    row = database.get_capsule_by_name(capsule_name)
    if not row:
        return f"Error: Capsule '{capsule_name}' not found"
    facts = database.get_core_facts(row["id"])
    return json.dumps({
        "capsule": row["name"],
        "phase": row["phase"],
        "micro_checks": _aggregate_from_facts(facts, "micro_check"),
        "evidence_expectations": _aggregate_from_facts(facts, "evidence"),
        "mastery_indicator": "",
    }, indent=2)


def get_misconceptions(capsule_name: str) -> str:
    """Get common misconceptions for a capsule."""
    row = database.get_capsule_by_name(capsule_name)
    if not row:
        return f"Error: Capsule '{capsule_name}' not found"
    facts = database.get_core_facts(row["id"])
    return json.dumps({
        "capsule": row["name"],
        "phase": row["phase"],
        "misconceptions": _aggregate_from_facts(facts, "misconception"),
    }, indent=2)


def get_mastery_levels(phase: int = 1) -> str:
    """Get the 6-level mastery rubric."""
    levels = database.get_mastery_levels(phase)
    if levels is None:
        return "Error: Curriculum not found"
    return json.dumps(levels, indent=2)


def get_learning_steps(phase: int = 1) -> str:
    """Get the 6-step learning flow."""
    steps = database.get_learning_steps(phase)
    if steps is None:
        return "Error: Curriculum not found"
    return json.dumps(steps, indent=2)


def list_all_capsules(phase: int = None) -> str:
    """List all capsules in the curriculum with their IDs."""
    rows = database.list_all_capsules(phase)
    capsules = [{
        "phase": r["phase"],
        "theme": r["theme_name"],
        "curriculum_theme_id": str(r["theme_db_id"]),
        "curriculum_capsule_id": str(r["id"]),
        "capsule_name": r["name"],
        "credit_value": 0.25,
    } for r in rows]
    return json.dumps(capsules, indent=2)


if __name__ == "__main__":
    print("=== Curriculum Overview (Phase 1) ===")
    print(get_curriculum_overview(1))
    print("\n=== List All Capsules (All Phases) ===")
    print(list_all_capsules())
    print("\n=== Core Facts for Characteristics of Life ===")
    print(get_core_facts("Characteristics of Life"))
    print("\n=== Capsule by name (Characteristics of Life) ===")
    result = json.loads(get_capsule_by_name("Characteristics of Life"))
    print(f"  db_id={result.get('db_id')}")
    print(f"  id={result.get('id')}")
    print(f"  name={result.get('name')}")
    print(f"  facts={len(result.get('core_facts', []))}")
    print(f"  _fact_id_map keys={len(result.get('_fact_id_map', {}))}")
