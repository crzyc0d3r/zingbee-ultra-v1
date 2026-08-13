"""Shared utilities for report_card JSONB manipulation.

Extracted from web_ui.py to eliminate DRY violations between
_save_progress and _advance_to_next_capsule.
"""

import json


def ensure_json(value):
    """Parse JSON string if needed, return dict/list as-is."""
    if isinstance(value, str):
        return json.loads(value)
    return value if value else {}


def sync_facts_to_report_card(cap: dict, knowledge_points: dict, fact_id_map: dict,
                               pending_interactions: list, now_iso: str) -> None:
    """Sync in-memory knowledge points and pending interactions into a report_card capsule entry.

    Mutates `cap` in place. Caller is responsible for clearing `pending_interactions` afterward.
    """
    exposures = knowledge_points.get("fact_exposures", {})
    taught_set = set(knowledge_points.get("facts_taught", []))
    assessed_set = set(knowledge_points.get("facts_assessed", []))
    mastered_set = set(knowledge_points.get("facts_mastered", []))
    introduced_set = set(knowledge_points.get("facts_introduced", []))

    for fact_text, fact_db_id in fact_id_map.items():
        fid = str(fact_db_id)
        fd = cap["facts"].setdefault(fid, {
            "is_introduced": False, "introduced_at": None,
            "is_taught": False, "taught_at": None,
            "is_assessed": False, "assessed_at": None,
            "is_mastered": False, "mastered_at": None,
            "exposure_count": 0, "correct_count": 0, "incorrect_count": 0,
            "interactions": [],
        })
        fd.setdefault("is_introduced", False)
        fd.setdefault("introduced_at", None)

        for flag, flag_set in [("is_introduced", introduced_set), ("is_taught", taught_set),
                                ("is_assessed", assessed_set), ("is_mastered", mastered_set)]:
            if fact_text in flag_set and not fd.get(flag):
                fd[flag] = True
                ts_key = flag.replace("is_", "") + "_at"
                fd[ts_key] = fd.get(ts_key) or now_iso
        fd["exposure_count"] = max(fd["exposure_count"], exposures.get(fact_text, 0))

    # Flush pending interactions
    cap.setdefault("passed_facts", {})
    cap.setdefault("failed_attempts", [])
    for ix in pending_interactions:
        fid = ix["fact_db_id"]
        if fid not in cap["facts"]:
            continue
        cap["facts"][fid]["interactions"].append({
            "session_id": ix["session_id"],
            "type": ix["type"],
            "understood": ix["understood"],
            "step": ix["step"],
            "exposure": ix["exposure"],
            "message_ids": ix["message_ids"],
            "at": ix["at"],
        })
        if ix["type"] == "student_correct":
            cap["facts"][fid]["correct_count"] += 1
            cap["passed_facts"][fid] = {
                "step": ix["step"],
                "at": ix["at"],
                "session_id": ix["session_id"],
            }
        elif ix["type"] == "student_incorrect":
            cap["facts"][fid]["incorrect_count"] += 1
            cap["failed_attempts"].append({
                "fact_id": fid,
                "step": ix["step"],
                "at": ix["at"],
                "session_id": ix["session_id"],
            })


def traverse_report_card_capsules(report_card: dict):
    """Yield (subject_id, phase, theme_id, capsule_id, capsule_data) for every capsule in a report_card.

    Handles the nested structure: subject_id -> phases -> phase_num -> themes -> theme_id -> capsules -> capsule_id
    Skips top-level keys like 'current_position'.
    """
    for subject_id, sdata in report_card.items():
        if subject_id == "current_position" or not isinstance(sdata, dict):
            continue
        phases = sdata.get("phases", sdata)
        if not isinstance(phases, dict):
            continue
        for phase_key, pdata in phases.items():
            if not isinstance(pdata, dict):
                continue
            themes = pdata.get("themes", pdata)
            if not isinstance(themes, dict):
                continue
            for theme_id, tdata in themes.items():
                if not isinstance(tdata, dict):
                    continue
                capsules = tdata.get("capsules", tdata)
                if not isinstance(capsules, dict):
                    continue
                for capsule_id, cdata in capsules.items():
                    if isinstance(cdata, dict):
                        yield subject_id, phase_key, theme_id, capsule_id, cdata


def set_current_position(rc: dict, *, subject_id, phase, theme_id=None, theme_name="",
                         capsule_id=None, capsule_name="", step=2, step_name="TEACH",
                         fact_id=None) -> None:
    """Set rc['current_position'] with standard curriculum navigation fields.

    fact_id: explicit fact selection from the start-session screen — the
    session engine starts on this fact (if it is still incomplete). Callers
    that don't pass it clear any stale selection, which is intentional."""
    rc["current_position"] = {
        "subject_id": str(subject_id) if subject_id else None,
        "phase": phase,
        "curriculum_theme_id": str(theme_id) if theme_id else None,
        "theme_name": theme_name,
        "capsule_id": str(capsule_id) if capsule_id else None,
        "capsule_name": capsule_name,
        "step": step,
        "step_name": step_name,
        "fact_id": str(fact_id) if fact_id else None,
    }


def get_capsule_status(capsule_data: dict) -> str:
    """Derive capsule completion status from facts -- facts are the source of truth."""
    facts = capsule_data.get("facts", {})
    if not facts:
        return capsule_data.get("status") or "not_started"
    if all(isinstance(f, dict) and f.get("is_mastered") for f in facts.values()):
        return "completed"
    if any(isinstance(f, dict) and f.get("is_taught") for f in facts.values()):
        return "in_progress"
    return "not_started"
