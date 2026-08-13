"""Reporting / analytics endpoints for ZingBee RT Studio.

Aggregates over learning_sessions.execution_log (cost, model, step type) and
session-level fields (duration, student). One combined endpoint:

  GET /api/reporting/summary?from=<iso>&to=<iso>

Returns cost-by-student, cost-by-step, cost-by-model, time-by-student,
and the top facts by time-spent (capped to keep response small).

`from`/`to` are inclusive UTC bounds on learning_sessions.start_time. Both
optional — defaults are 30 days ago through now.
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

import db as database
from auth import require_role

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reporting", tags=["reporting"])


# Step types we treat as paid LLM/media work — keep this list explicit so
# we never accidentally double-count or attribute non-cost steps.
_COST_BEARING_STEPS = {
    "LLM_REQUEST",          # tutor call (cost recorded on REQUEST in some paths)
    "LLM_RESPONSE",         # tutor call (cost recorded on RESPONSE in other paths)
    "ASSESSMENT_LLM_REQUEST",
    "ASSESSMENT_LLM_RESPONSE",
    "CLASSIFIER",
    "IMAGE_REQUEST",
    "IMAGE_GENERATE_FULL",
    "IMAGE_GENERATE_RESULT",
    "TTS_REQUEST",
}

# Human-friendly groupings for cost-by-step. Step names are normalised into
# these buckets so the UI can show one row per logical workload.
_STEP_BUCKETS = {
    "LLM_REQUEST": "Tutor LLM",
    "LLM_RESPONSE": "Tutor LLM",
    "ASSESSMENT_LLM_REQUEST": "Assessor LLM",
    "ASSESSMENT_LLM_RESPONSE": "Assessor LLM",
    "CLASSIFIER": "Classifier LLM",
    "IMAGE_REQUEST": "Image Gen",
    "IMAGE_GENERATE_FULL": "Image Gen",
    "IMAGE_GENERATE_RESULT": "Image Gen",
    "TTS_REQUEST": "TTS",
}


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    # Accept both 'Z' and offset-less ISO strings — treat naive as UTC.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _pctl(values, p):
    """Linear-interpolated percentile (p in [0,1]) of a numeric list."""
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * p
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


@router.get("/summary")
async def reporting_summary(
    request: Request,
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    fact_limit: int = Query(50, ge=1, le=500),
):
    """Aggregate cost + time across all sessions whose start_time falls in
    the requested window."""
    # Operator/admin only — returns cross-student PII (names, cost, accuracy, fact-level
    # time). Consumed solely by Red Team Studio (operator tool); matches the two sibling
    # /api/reporting read endpoints.
    require_role(request, {"admin", "operator"})

    end = _parse_dt(date_to) or datetime.now(timezone.utc)
    start = _parse_dt(date_from) or (end - timedelta(days=30))
    if start > end:
        start, end = end, start

    rows = database.fetchall(
        """
        SELECT s.id, s.student_id, s.start_time, s.end_time, s.duration_seconds,
               s.facts_taught_count, s.questions_asked, s.correct_answers,
               s.execution_log,
               COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                        s.student_id) AS student_name,
               sub.name AS subject_name,
               cc.name AS capsule_name
        FROM learning_sessions s
        LEFT JOIN students st ON st.student_id = s.student_id
        LEFT JOIN users u ON u.id = st.user_id
        LEFT JOIN curriculum_capsules cc ON cc.id = s.curriculum_capsule_id
        LEFT JOIN curriculum_themes ct ON ct.id = cc.curriculum_theme_id
        LEFT JOIN subject_curriculum sc ON sc.id = ct.subject_curriculum_id
        LEFT JOIN subjects sub ON sub.id = sc.subject_id
        WHERE s.start_time >= %s AND s.start_time <= %s
        """,
        (start, end),
    )

    # Aggregators
    cost_by_student: dict[tuple, float] = defaultdict(float)
    cost_by_bucket: dict[str, dict] = defaultdict(lambda: {"cost_usd": 0.0, "count": 0})
    cost_by_model: dict[str, dict] = defaultdict(lambda: {"cost_usd": 0.0, "count": 0})
    cost_by_subject: dict[str, float] = defaultdict(float)
    time_by_student: dict[tuple, dict] = defaultdict(lambda: {"duration_seconds": 0, "sessions": 0})
    time_by_fact: dict[str, dict] = defaultdict(lambda: {"seconds": 0.0, "sessions": 0, "student_ids": set()})

    # Per-student detailed roll-up: cost + time + facts together so the UI can
    # compute ratios (time-per-fact, cost-per-fact, cost-per-minute).
    students_detailed: dict[tuple, dict] = defaultdict(lambda: {
        "cost_usd": 0.0, "duration_seconds": 0, "sessions": 0,
        "facts_taught": 0, "questions": 0, "correct": 0,
    })

    # Daily time series (UTC day buckets) for sparklines / trend charts.
    daily: dict[str, dict] = defaultdict(lambda: {
        "cost_usd": 0.0, "duration_seconds": 0, "sessions": 0,
    })
    # Daily cost split by model: day -> model -> usd. Drives the
    # "cost over time, stacked by model" chart.
    daily_by_model: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    daily_by_bucket: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    total_cost = 0.0
    total_duration = 0
    total_sessions = len(rows)

    for r in rows:
        student_key = (r["student_id"], r["student_name"] or r["student_id"])
        exec_log = r.get("execution_log") or []
        # psycopg2 returns JSONB as parsed lists; legacy rows may have strings.
        if isinstance(exec_log, str):
            import json as _json
            try:
                exec_log = _json.loads(exec_log)
            except Exception:
                exec_log = []

        # Duration roll-up
        dur = int(r.get("duration_seconds") or 0)
        facts_taught = int(r.get("facts_taught_count") or 0)
        questions = int(r.get("questions_asked") or 0)
        correct = int(r.get("correct_answers") or 0)
        total_duration += dur
        time_by_student[student_key]["duration_seconds"] += dur
        time_by_student[student_key]["sessions"] += 1

        # Detailed per-student roll-up (facts + correctness + duration)
        ds = students_detailed[student_key]
        ds["duration_seconds"] += dur
        ds["sessions"] += 1
        ds["facts_taught"] += facts_taught
        ds["questions"] += questions
        ds["correct"] += correct

        # Day bucket key (UTC date) for daily series
        day_key = (r["start_time"].astimezone(timezone.utc).date().isoformat()
                   if r.get("start_time") else None)
        if day_key:
            daily[day_key]["duration_seconds"] += dur
            daily[day_key]["sessions"] += 1

        # Per-fact time using V6_TRANSITION events as fact-context markers.
        # Algorithm: scan execution_log chronologically. Whenever we see a
        # fact name (in V6_TRANSITION.details.fact or LLM response details),
        # add the time since the previous event to that fact. Cap per-event
        # delta at 5 minutes so an idle/AFK gap doesn't get attributed.
        prev_ts: Optional[datetime] = None
        current_fact: Optional[str] = None
        seen_facts_this_session: set[str] = set()
        for entry in exec_log:
            if not isinstance(entry, dict):
                continue
            ts = _parse_dt(entry.get("timestamp"))
            details = entry.get("details") or {}
            if isinstance(details, str):
                # Shouldn't happen often but be defensive
                try:
                    import json as _json
                    details = _json.loads(details)
                except Exception:
                    details = {}

            # Update current_fact whenever an event names one
            f = details.get("fact") if isinstance(details, dict) else None
            if isinstance(f, str) and f.strip():
                current_fact = f.strip()

            # Cost accumulation
            step = entry.get("step") or ""
            if step in _COST_BEARING_STEPS:
                cost = float(details.get("cost_usd") or 0)
                if cost > 0:
                    total_cost += cost
                    cost_by_student[student_key] += cost
                    students_detailed[student_key]["cost_usd"] += cost
                    bucket = _STEP_BUCKETS.get(step, step)
                    cost_by_bucket[bucket]["cost_usd"] += cost
                    cost_by_bucket[bucket]["count"] += 1
                    model = details.get("model") or "(unknown)"
                    cost_by_model[model]["cost_usd"] += cost
                    cost_by_model[model]["count"] += 1
                    if r.get("subject_name"):
                        cost_by_subject[r["subject_name"]] += cost
                    if day_key:
                        daily[day_key]["cost_usd"] += cost
                        daily_by_model[day_key][model] += cost
                        daily_by_bucket[day_key][bucket] += cost

            # Time-on-fact
            if ts and prev_ts and current_fact:
                delta = (ts - prev_ts).total_seconds()
                if 0 < delta <= 300:  # cap 5min per gap to avoid AFK noise
                    bucket = time_by_fact[current_fact]
                    bucket["seconds"] += delta
                    bucket["student_ids"].add(r["student_id"])
                    seen_facts_this_session.add(current_fact)
            if ts:
                prev_ts = ts

        for fact_text in seen_facts_this_session:
            time_by_fact[fact_text]["sessions"] += 1

    # Serialize aggregators (sorted desc by cost/time)
    cost_by_student_out = [
        {"student_id": sid, "student_name": name, "cost_usd": round(v, 4)}
        for (sid, name), v in sorted(cost_by_student.items(), key=lambda kv: kv[1], reverse=True)
    ]
    cost_by_bucket_out = [
        {"bucket": k, "cost_usd": round(v["cost_usd"], 4), "count": v["count"]}
        for k, v in sorted(cost_by_bucket.items(), key=lambda kv: kv[1]["cost_usd"], reverse=True)
    ]
    cost_by_model_out = [
        {"model": k, "cost_usd": round(v["cost_usd"], 4), "count": v["count"]}
        for k, v in sorted(cost_by_model.items(), key=lambda kv: kv[1]["cost_usd"], reverse=True)
    ]
    cost_by_subject_out = [
        {"subject": k, "cost_usd": round(v, 4)}
        for k, v in sorted(cost_by_subject.items(), key=lambda kv: kv[1], reverse=True)
    ]
    time_by_student_out = [
        {"student_id": sid, "student_name": name,
         "duration_seconds": v["duration_seconds"],
         "sessions": v["sessions"]}
        for (sid, name), v in sorted(time_by_student.items(),
                                     key=lambda kv: kv[1]["duration_seconds"], reverse=True)
    ]
    time_by_fact_out = [
        {"fact_text": k,
         "seconds": round(v["seconds"], 1),
         "sessions": v["sessions"],
         "unique_students": len(v["student_ids"])}
        for k, v in sorted(time_by_fact.items(), key=lambda kv: kv[1]["seconds"], reverse=True)
    ][:fact_limit]

    # Detailed per-student rows with derived ratios. Sorted by total time
    # so the time-by-student report can use this list directly.
    students_detailed_out = []
    for (sid, name), v in sorted(students_detailed.items(),
                                 key=lambda kv: kv[1]["duration_seconds"], reverse=True):
        ft = v["facts_taught"]
        dur = v["duration_seconds"]
        cost = v["cost_usd"]
        students_detailed_out.append({
            "student_id": sid,
            "student_name": name,
            "cost_usd": round(cost, 4),
            "duration_seconds": dur,
            "sessions": v["sessions"],
            "facts_taught": ft,
            "questions": v["questions"],
            "correct": v["correct"],
            "accuracy_pct": round(100.0 * v["correct"] / v["questions"], 1) if v["questions"] else None,
            "seconds_per_fact": round(dur / ft, 1) if ft else None,
            "usd_per_fact": round(cost / ft, 4) if ft else None,
            "usd_per_minute": round(60.0 * cost / dur, 4) if dur else None,
        })

    # Build a dense daily series spanning [start, end] so the chart has no
    # gaps. Models and buckets are sparse — only days with cost contribute.
    daily_out = []
    cur = start.date()
    end_date = end.date()
    while cur <= end_date:
        day = cur.isoformat()
        bucket = daily.get(day) or {"cost_usd": 0.0, "duration_seconds": 0, "sessions": 0}
        models = daily_by_model.get(day, {})
        buckets = daily_by_bucket.get(day, {})
        daily_out.append({
            "date": day,
            "cost_usd": round(bucket["cost_usd"], 4),
            "duration_seconds": bucket["duration_seconds"],
            "sessions": bucket["sessions"],
            "by_model": {m: round(v, 4) for m, v in models.items()},
            "by_bucket": {b: round(v, 4) for b, v in buckets.items()},
        })
        cur += timedelta(days=1)

    return {
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "totals": {
            "sessions": total_sessions,
            "students": len(time_by_student),
            "duration_seconds": total_duration,
            "cost_usd": round(total_cost, 4),
        },
        "cost_by_student": cost_by_student_out,
        "cost_by_bucket": cost_by_bucket_out,
        "cost_by_model": cost_by_model_out,
        "cost_by_subject": cost_by_subject_out,
        "time_by_student": time_by_student_out,
        "time_by_fact": time_by_fact_out,
        "students_detailed": students_detailed_out,
        "daily": daily_out,
    }


@router.get("/prompt-versions")
async def reporting_prompt_versions(
    request: Request,
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    """Per-prompt-version usage / cost / latency, with model-drift detection (Track A2).

    Scans tutor LLM_RESPONSE events (tagged with prompt_id + template_hash + served_fingerprint)
    over the window and groups by (prompt_id, template_hash). `model_drift` flags a prompt
    version served by >1 distinct xAI build (served_fingerprint) OR >1 configured model — the
    "did the model change under us" signal. template_hash joins to prompt_versions for the text.
    """
    # Operator/admin only: this is platform-wide tutor-prompt operational telemetry
    # (cost, latency, model fingerprints, drift) — matches the privilege of the prompt
    # mutation endpoints that produce it. Students/teachers share this API (require_auth
    # alone would expose it to any logged-in account).
    require_role(request, {"admin", "operator"})

    end = _parse_dt(date_to) or datetime.now(timezone.utc)
    start = _parse_dt(date_from) or (end - timedelta(days=30))
    if start > end:
        start, end = end, start

    # Aggregate entirely in Postgres: expand each session's execution_log with
    # jsonb_array_elements, keep LLM_RESPONSE rows, GROUP BY (prompt_id, template_hash).
    # This returns at most a few dozen aggregated rows instead of pulling every session's
    # full (large) execution_log JSONB into Python memory — the prior approach OOM'd at scale.
    # NULLIF(...,'')::numeric tolerates missing/blank numeric fields (-> NULL, ignored by aggs).
    rows = database.fetchall(
        """
        WITH ev AS (
            SELECT e->'details' AS d
            FROM learning_sessions s
            CROSS JOIN LATERAL jsonb_array_elements(s.execution_log) e
            WHERE s.start_time >= %s AND s.start_time <= %s
              AND s.execution_log IS NOT NULL
              AND jsonb_typeof(s.execution_log) = 'array'
              AND e->>'step' = 'LLM_RESPONSE'
              AND e->'details'->>'prompt_id' IS NOT NULL
        )
        SELECT
            d->>'prompt_id'    AS prompt_id,
            d->>'template_hash' AS template_hash,
            count(*)           AS turns,
            COALESCE(sum(NULLIF(d->>'cost_usd','')::numeric), 0)            AS cost_usd,
            avg(NULLIF(d->>'latency_ms','')::numeric)                      AS avg_latency_ms,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY NULLIF(d->>'latency_ms','')::numeric) AS p50_latency_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY NULLIF(d->>'latency_ms','')::numeric) AS p95_latency_ms,
            avg(NULLIF(d->>'completion_tokens','')::numeric)              AS avg_completion_tokens,
            array_agg(DISTINCT d->>'model')                               AS models,
            array_agg(DISTINCT d->>'served_fingerprint')
                FILTER (WHERE d->>'served_fingerprint' IS NOT NULL)       AS served_fingerprints
        FROM ev
        GROUP BY 1, 2
        ORDER BY turns DESC
        LIMIT 200
        """,
        (start, end),
    )

    def _r(x):
        return round(float(x)) if x is not None else None

    out = []
    for r in rows:
        models = [m for m in (r.get("models") or []) if m is not None]
        fps = [f for f in (r.get("served_fingerprints") or []) if f is not None]
        out.append({
            "prompt_id": r["prompt_id"],
            "template_hash": r["template_hash"],
            "turns": r["turns"],
            "cost_usd": round(float(r["cost_usd"] or 0), 4),
            "avg_latency_ms": _r(r["avg_latency_ms"]),
            "p50_latency_ms": _r(r["p50_latency_ms"]),
            "p95_latency_ms": _r(r["p95_latency_ms"]),
            "avg_completion_tokens": _r(r["avg_completion_tokens"]),
            "models": models,
            "served_fingerprints": fps,
            # drift = this prompt version served by >1 distinct xAI build, OR >1 configured model.
            "model_drift": len(fps) > 1 or len(models) > 1,
        })

    return {
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "prompt_versions": out,
        "drift_flags": [o for o in out if o["model_drift"]],
    }


@router.get("/pedagogy-scores")
async def reporting_pedagogy_scores(
    request: Request,
    rubric_version: Optional[int] = Query(None, description="defaults to the live RUBRIC_VERSION"),
    fixture_set: Optional[str] = Query(None),
    template_hash: Optional[str] = Query(None),
    model_version: Optional[str] = Query(None, alias="model"),
    run_id: Optional[str] = Query(None, description="pin a specific run; else latest run for the fixture_set"),
):
    """Read-time aggregation of the Track B pedagogy scorer (ADO #58).

    Returns per-dimension p50/p95 (from pedagogy_eval_runs) plus the
    multi-objective vector means (from pedagogy_eval_sessions), optionally sliced
    by fixture_set / template_hash / model. Advisory monitoring only — never gates.
    """
    # Operator/admin only — platform-wide pedagogy-eval aggregates, not student-scoped.
    require_role(request, {"admin", "operator"})

    if rubric_version is None:
        import pedagogy_eval_policy
        rubric_version = pedagogy_eval_policy.RUBRIC_VERSION

    data = database.aggregate_pedagogy_scores(
        rubric_version,
        fixture_set=fixture_set,
        template_hash=template_hash,
        model_version=model_version,
        run_id=run_id,
    )
    return JSONResponse({"rubric_version": rubric_version, **data})


# ---------------------------------------------------------------------------
# Engagement monitoring (ADO #26) — chip health, misuse, compliance
# ---------------------------------------------------------------------------
# Reads the v_engagement_events view (db/014) for the cheap aggregates and runs
# engagement_metrics over a per-session ordered walk for the outcome
# correlations (hollow-ready, typed baseline, overuse). Outcome-anchored
# throughout: a click is never "good" on its own — only its downstream CHECK/
# EVIDENCE gate decides hollow vs solid. Exploratory instrumentation.
#
# Known follow-ups before 10x scale (acceptable for v1 / low operator traffic):
#  - The cheap aggregates issue ~7 separate SELECTs that each re-expand the
#    view's JSONB. Collapse to one GROUPING SETS pass (the /prompt-versions
#    pattern) when traffic warrants; EXPLAIN to confirm start_time pushdown.
#  - The walk keys outcomes by core_fact TEXT; two facts sharing identical text
#    in one capsule would merge. Robust fix: thread fact_db_id into the
#    CHIP_MATCH/ASSESSMENT telemetry + view. Rare; deferred.

_SEGMENT_COLS = {"age": "age_band", "subject": "subject", "tutor": "tutor", "none": None}


@router.get("/engagement")
async def reporting_engagement(
    request: Request,
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    segment: str = Query("age"),
    fact_limit: int = Query(40, ge=1, le=200),
):
    """Engagement-chip health: misuse (hollow-ready) headline, adoption, the
    typed-advance baseline, compliance, and overuse — segmented by age band
    (default), subject, or tutor."""
    # Operator/admin only — cross-student learning telemetry; matches the sibling
    # /api/reporting endpoints' privilege.
    require_role(request, {"admin", "operator"})

    import engagement_metrics

    end = _parse_dt(date_to) or datetime.now(timezone.utc)
    start = _parse_dt(date_from) or (end - timedelta(days=30))
    if start > end:
        start, end = end, start
    seg_col = _SEGMENT_COLS.get(segment, "age_band")
    win = (start, end)

    # --- Cheap SQL aggregates over the view ---------------------------------
    ctr = database.fetchone(
        """SELECT count(*) FILTER (WHERE step='CHIP_MATCH') AS chip_turns,
                  count(*) FILTER (WHERE step='CHIP_MATCH' AND hit) AS chip_clicks,
                  count(*) FILTER (WHERE step='SUGGESTIONS_FALLBACK') AS fallback_turns,
                  count(DISTINCT session_id) AS sessions
           FROM v_engagement_events WHERE start_time >= %s AND start_time <= %s""", win)
    chip_turns = int(ctr["chip_turns"] or 0)
    chip_clicks = int(ctr["chip_clicks"] or 0)
    fallback_turns = int(ctr["fallback_turns"] or 0)

    intents = database.fetchall(
        """SELECT intent, count(*) AS clicks FROM v_engagement_events
           WHERE step='CHIP_MATCH' AND hit AND intent IS NOT NULL
             AND start_time >= %s AND start_time <= %s
           GROUP BY intent ORDER BY clicks DESC""", win)
    total_intent_clicks = sum(int(r["clicks"]) for r in intents) or 1
    intent_distribution = [
        {"intent": r["intent"], "clicks": int(r["clicks"]),
         "pct": round(100.0 * int(r["clicks"]) / total_intent_clicks, 1)}
        for r in intents]

    daily_rows = database.fetchall(
        """SELECT to_char(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
                  intent, count(*) AS clicks
           FROM v_engagement_events
           WHERE step='CHIP_MATCH' AND hit AND intent IS NOT NULL
             AND start_time >= %s AND start_time <= %s
           GROUP BY 1, 2""", win)
    daily_map: dict[str, dict] = defaultdict(lambda: defaultdict(int))
    for r in daily_rows:
        daily_map[r["d"]][r["intent"]] += int(r["clicks"])
    daily = [{"date": d, "by_intent": dict(v)} for d, v in sorted(daily_map.items())]

    compliance = database.fetchall(
        """SELECT subtype, count(*) AS n FROM v_engagement_events
           WHERE step='COMPLIANCE_VIOLATION' AND subtype IS NOT NULL
             AND start_time >= %s AND start_time <= %s
           GROUP BY subtype ORDER BY n DESC""", win)
    compliance_by_subtype = [{"subtype": r["subtype"], "count": int(r["n"])} for r in compliance]
    # ack-violation rate = missing_acknowledgment events / assessed turns (ASSESSMENT count)
    assessed = database.fetchone(
        """SELECT count(*) AS n FROM v_engagement_events
           WHERE step='ASSESSMENT' AND start_time >= %s AND start_time <= %s""", win)
    assessed_n = int(assessed["n"] or 0)
    ack_viol = sum(c["count"] for c in compliance_by_subtype if c["subtype"] == "missing_acknowledgment")

    latency = database.fetchall(
        """SELECT step,
                  percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms) AS p50,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
                  count(*) AS n
           FROM v_engagement_events
           WHERE latency_ms IS NOT NULL AND step IN ('LLM_RESPONSE','ASSESSMENT_LLM_RESPONSE')
             AND start_time >= %s AND start_time <= %s
           GROUP BY step""", win)
    latency_by_step = [
        {"step": r["step"], "p50_ms": round(float(r["p50"])) if r["p50"] is not None else None,
         "p95_ms": round(float(r["p95"])) if r["p95"] is not None else None, "n": int(r["n"])}
        for r in latency]

    # --- Per-session outcome walk (hollow-ready, typed baseline, overuse) ----
    walk_rows = database.fetchall(
        """SELECT session_id, age_band, subject, tutor, step, fact, intent, hit,
                  phase, interaction_type, action
           FROM v_engagement_events
           WHERE step IN ('CHIP_MATCH','ASSESSMENT','V6_TRANSITION')
             AND start_time >= %s AND start_time <= %s
           ORDER BY session_id, ts NULLS LAST, src, ord""", win)
    sessions_events: dict[str, list] = defaultdict(list)
    session_seg: dict[str, str] = {}
    for r in walk_rows:
        sessions_events[r["session_id"]].append(r)
        if seg_col:
            session_seg[r["session_id"]] = r.get(seg_col) or "unknown"

    # Walk each session exactly once; reuse the per-session results for both the
    # overall roll-up and every segment bucket (no double walk).
    session_ids = list(sessions_events.keys())
    results = [engagement_metrics.analyze_session(sessions_events[sid]) for sid in session_ids]
    overall = engagement_metrics.aggregate_results(results)

    by_segment = []
    if seg_col:
        seg_groups: dict[str, list] = defaultdict(list)
        for sid, res in zip(session_ids, results):
            seg_groups[session_seg.get(sid, "unknown")].append(res)
        for label, res_list in seg_groups.items():
            st = engagement_metrics.segment_totals(res_list)
            by_segment.append({"segment_label": label, **st})
        by_segment.sort(key=lambda s: (s["hollow_rate"] or 0) * s["hollow_n"], reverse=True)

    # --- Engagement-vs-accuracy (reuse session-level accuracy fields) --------
    acc_rows = database.fetchall(
        """WITH ps AS (
              SELECT session_id,
                     count(*) FILTER (WHERE step='CHIP_MATCH') AS turns,
                     count(*) FILTER (WHERE step='CHIP_MATCH' AND hit) AS clicks
              FROM v_engagement_events
              WHERE start_time >= %s AND start_time <= %s GROUP BY session_id)
           SELECT ps.clicks, ps.turns, ls.questions_asked, ls.correct_answers
           FROM ps JOIN learning_sessions ls ON ls.id = ps.session_id
           WHERE ps.turns > 0 AND ls.questions_asked > 0""", win)
    acc_buckets = {"0-25%": [], "25-50%": [], "50-75%": [], "75-100%": []}
    for r in acc_rows:
        ctr_pct = 100.0 * int(r["clicks"]) / int(r["turns"])
        acc = 100.0 * int(r["correct_answers"]) / int(r["questions_asked"])
        band = ("0-25%" if ctr_pct < 25 else "25-50%" if ctr_pct < 50
                else "50-75%" if ctr_pct < 75 else "75-100%")
        acc_buckets[band].append(acc)
    accuracy_vs_ctr = [
        {"ctr_band": b, "avg_accuracy": round(sum(v) / len(v), 1) if v else None, "sessions": len(v)}
        for b, v in acc_buckets.items()]

    t = overall["totals"]
    return {
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "segment": segment,
        "totals": {
            "sessions": int(ctr["sessions"] or 0),
            "chip_turns": chip_turns,
            "chip_ctr": round(100.0 * chip_clicks / chip_turns, 1) if chip_turns else None,
            "hollow_ready_rate": t["chip_hollow_rate"],
            "hollow_ready_n": t["chip_hollow_n"],
            "typed_advance_hollow_rate": t["typed_hollow_rate"],
            "typed_advance_hollow_n": t["typed_hollow_n"],
            "fallback_rate": round(100.0 * fallback_turns / (chip_turns + fallback_turns), 1)
                             if (chip_turns + fallback_turns) else None,
            "ack_violation_rate": round(100.0 * ack_viol / assessed_n, 1) if assessed_n else None,
            "ack_violation_n": assessed_n,   # the true denominator (assessed turns)
        },
        "intent_distribution": intent_distribution,
        "daily": daily,
        "by_segment": by_segment,
        "compliance_by_subtype": compliance_by_subtype,
        "overuse": {
            "guided_try_fires": t["guided_try_fires"],
            "detours_before_fail": t["detours_before_fail"],
            "detours_before_mastery": t["detours_before_mastery"],
        },
        "accuracy_vs_ctr": accuracy_vs_ctr,
        "latency_by_step": latency_by_step,
        "worst_facts": overall["worst_facts"][:fact_limit],
    }
