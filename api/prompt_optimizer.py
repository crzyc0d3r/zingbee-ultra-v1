"""Automated prompt improvement feedback loop.

Analyzes judge feedback patterns across evaluated distillations,
identifies systematic issues, and suggests prompt modifications.
All analysis is rule-based (no LLM calls) — deterministic and auditable.
"""

from __future__ import annotations

import logging
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

import db

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class PatternDetection:
    """A detected quality pattern in evaluated variants."""
    pattern_id: str
    severity: float          # 0.0-1.0, higher = worse
    affected_pct: float      # % of variants affected
    judge_name: str
    description: str
    sample_flags: list[str] = field(default_factory=list)


@dataclass
class PromptSuggestion:
    """A concrete prompt modification to address a detected pattern."""
    pattern_id: str
    scope_type: str
    scope_key: str
    prompt_id: str = "explanation_gen_system"
    strategy: str | None = None
    override_type: str = "append"
    content: str = ""
    rationale: str = ""
    expected_improvement: float = 0.0  # estimated composite score delta


@dataclass
class AnalysisReport:
    """Complete analysis for a scope."""
    scope: dict
    total_variants: int
    evaluated_variants: int
    patterns: list[PatternDetection] = field(default_factory=list)
    suggestions: list[PromptSuggestion] = field(default_factory=list)
    by_strategy: dict[str, dict] = field(default_factory=dict)
    by_judge: dict[str, dict] = field(default_factory=dict)
    analyzed_at: str = ""


@dataclass
class ABTestResult:
    """Result of an A/B test comparing with/without a prompt override."""
    suggestion_id: str
    control_scores: list[float]
    treatment_scores: list[float]
    control_mean: float
    treatment_mean: float
    improvement_delta: float
    sample_size: int
    recommend_keep: bool
    t_stat: float = 0.0  # M-1: Welch's t for statistical transparency


# ---------------------------------------------------------------------------
# Pattern detection rules
# ---------------------------------------------------------------------------

# Each rule: (pattern_id, judge_name, threshold, min_pct, description)
_DETECTION_RULES = [
    ("topic_drift", "fact_alignment", 0.7, 0.30,
     "Explanations drift away from the specific fact being taught"),
    ("question_leakage", "clarity", None, 0.20,
     "TEACH explanations contain questions instead of declarative statements"),
    ("age_mismatch", "age_appropriateness", 0.7, 0.25,
     "Language or concepts are not calibrated for the target age range"),
    ("low_engagement", "engagement", 0.6, 0.30,
     "Explanations lack engagement hooks for the target audience"),
    ("pedagogical_weakness", "pedagogical_accuracy", 0.7, 0.20,
     "Explanations have pedagogical accuracy issues"),
]

# Flag-based detection (check flag frequency instead of score threshold)
_FLAG_RULES = [
    ("question_leakage", "clarity", "asks_question_during_teach", 0.15,
     "TEACH explanations ask questions instead of being declarative"),
    ("factual_errors", "pedagogical_accuracy", "factual_error", 0.05,
     "Explanations contain factual errors"),
    ("too_complex", "age_appropriateness", "too_complex", 0.20,
     "Explanations use language too complex for the target age"),
]


# ---------------------------------------------------------------------------
# Suggestion templates
# ---------------------------------------------------------------------------

_SUGGESTION_TEMPLATES: dict[str, dict[str, Any]] = {
    "topic_drift": {
        "override_type": "append",
        "content": (
            "CRITICAL: Focus exclusively on teaching THIS specific fact and nothing else. "
            "Do not discuss related concepts, adjacent topics, or broader context unless it "
            "directly explains this one fact. Stay laser-focused."
        ),
        "expected_improvement": 0.08,
    },
    "question_leakage": {
        "override_type": "append",
        "content": (
            "ABSOLUTE RULE: Do NOT ask the student any questions whatsoever. "
            "No rhetorical questions, no \"Did you know...?\", no \"Can you imagine...?\". "
            "Every sentence must be a declarative statement. You are TEACHING, not quizzing."
        ),
        "expected_improvement": 0.10,
    },
    "age_mismatch": {
        "override_type": "prepend",
        "content": (
            "IMPORTANT: Use vocabulary, sentence length, and conceptual complexity appropriate "
            "for the student's age range. Avoid jargon. Use short sentences. Connect to things "
            "students of this age encounter in daily life."
        ),
        "expected_improvement": 0.06,
    },
    "low_engagement": {
        "override_type": "append",
        "content": (
            "Make this explanation genuinely interesting. Use a surprising fact, a vivid comparison, "
            "or connect to something the student cares about. Avoid dry, textbook-style language. "
            "The student should WANT to keep reading."
        ),
        "expected_improvement": 0.07,
    },
    "pedagogical_weakness": {
        "override_type": "append",
        "content": (
            "Ensure your explanation is pedagogically sound: build from known concepts to new ones, "
            "use concrete examples before abstract definitions, and make the core idea unmistakably clear."
        ),
        "expected_improvement": 0.05,
    },
    "too_complex": {
        "override_type": "prepend",
        "content": (
            "SIMPLIFY: Use only words and concepts a student of this age already knows. "
            "If you must introduce a new term, immediately explain it in everyday language. "
            "Shorter sentences. Simpler structure. No academic tone."
        ),
        "expected_improvement": 0.07,
    },
    "factual_errors": {
        "override_type": "append",
        "content": (
            "ACCURACY CHECK: Before generating your explanation, verify that every claim you make "
            "is directly supported by the core fact provided. Do not add information that goes "
            "beyond what the fact states. If the fact says X, explain X — not X plus your assumptions."
        ),
        "expected_improvement": 0.12,
    },
}

# Strategy-specific engagement boosts
_STRATEGY_ENGAGEMENT = {
    "analogy": (
        "Your analogy must be vivid, concrete, and immediately relatable to the student's world. "
        "Use comparisons to things they see, touch, or do every day."
    ),
    "story": (
        "Your story must hook the reader in the first sentence. "
        "Use a character, a problem, or a surprising situation. Keep it brief but compelling."
    ),
    "visual_verbal": (
        "Paint a picture with words. Use sensory language — what does it look like, feel like, "
        "sound like? Help the student SEE the concept in their mind."
    ),
    "socratic": (
        "Start with a genuinely thought-provoking question that makes the student curious, "
        "then build the answer step by step."
    ),
}


# ---------------------------------------------------------------------------
# Core analyzer
# ---------------------------------------------------------------------------

class PromptOptimizer:
    """Analyzes judge feedback and suggests prompt improvements."""

    def analyze_scope(self, scope: dict) -> AnalysisReport:
        """Aggregate feedback for a scope and identify systematic issues."""
        variants = db.list_distillation_variants(
            subject_name=scope.get("subject"),
            phase=scope.get("phase"),
            theme_name=scope.get("theme"),
            capsule_name=scope.get("capsule"),
        )

        total = len(variants)
        evaluated = [v for v in variants if (v["variant"].get("evaluation") or {}).get("composite_score") is not None]
        n_eval = len(evaluated)

        if n_eval == 0:
            return AnalysisReport(
                scope=scope, total_variants=total, evaluated_variants=0,
                analyzed_at=datetime.now(timezone.utc).isoformat(),
            )

        # Group by strategy
        by_strategy: dict[str, list[dict]] = defaultdict(list)
        for row in evaluated:
            strat = row["variant"].get("strategy", "unknown")
            by_strategy[strat].append(row)

        # Compute per-judge aggregates
        by_judge: dict[str, dict] = {}
        all_scores_by_judge: dict[str, list[float]] = defaultdict(list)
        all_flags_by_judge: dict[str, list[str]] = defaultdict(list)

        for row in evaluated:
            scores = (row["variant"].get("evaluation") or {}).get("scores", {})
            for judge_name, judge_data in scores.items():
                score = judge_data.get("score")
                if score is not None:
                    all_scores_by_judge[judge_name].append(float(score))
                flags = judge_data.get("flags") or []
                all_flags_by_judge[judge_name].extend(flags)

        for judge_name, scores in all_scores_by_judge.items():
            by_judge[judge_name] = {
                "mean": round(statistics.mean(scores), 3) if scores else 0,
                "median": round(statistics.median(scores), 3) if scores else 0,
                "stdev": round(statistics.stdev(scores), 3) if len(scores) > 1 else 0,
                "min": round(min(scores), 3) if scores else 0,
                "count": len(scores),
                "below_70": sum(1 for s in scores if s < 0.7),
                "below_50": sum(1 for s in scores if s < 0.5),
            }

        # Compute per-strategy aggregates
        strategy_stats = {}
        for strat, rows in by_strategy.items():
            composites = [
                (r["variant"].get("evaluation") or {}).get("composite_score", 0)
                for r in rows
            ]
            composites = [c for c in composites if c is not None]
            statuses = defaultdict(int)
            for r in rows:
                statuses[r["variant"].get("status", "unknown")] += 1

            strategy_stats[strat] = {
                "count": len(rows),
                "mean_composite": round(statistics.mean(composites), 3) if composites else 0,
                "statuses": dict(statuses),
            }

        # Detect patterns
        patterns = self._detect_patterns(evaluated, n_eval, all_scores_by_judge, all_flags_by_judge)

        # Generate suggestions
        suggestions = self._generate_suggestions(patterns, scope, by_strategy)

        return AnalysisReport(
            scope=scope,
            total_variants=total,
            evaluated_variants=n_eval,
            patterns=patterns,
            suggestions=suggestions,
            by_strategy=strategy_stats,
            by_judge=by_judge,
            analyzed_at=datetime.now(timezone.utc).isoformat(),
        )

    def _detect_patterns(
        self,
        evaluated: list[dict],
        n_eval: int,
        scores_by_judge: dict[str, list[float]],
        flags_by_judge: dict[str, list[str]],
    ) -> list[PatternDetection]:
        """Apply detection rules to find systematic issues."""
        patterns = []

        # Score-based detection
        for pattern_id, judge_name, threshold, min_pct, description in _DETECTION_RULES:
            if threshold is None:
                continue  # flag-based only
            scores = scores_by_judge.get(judge_name, [])
            if not scores:
                continue
            below = sum(1 for s in scores if s < threshold)
            pct = below / len(scores)
            if pct >= min_pct:
                severity = min(1.0, pct * (1.0 - statistics.mean(scores)))
                patterns.append(PatternDetection(
                    pattern_id=pattern_id,
                    severity=round(severity, 3),
                    affected_pct=round(pct, 3),
                    judge_name=judge_name,
                    description=description,
                ))

        # Flag-based detection
        for pattern_id, judge_name, flag_name, min_pct, description in _FLAG_RULES:
            flags = flags_by_judge.get(judge_name, [])
            if not flags and n_eval == 0:
                continue
            flag_count = sum(1 for f in flags if f == flag_name)
            pct = flag_count / max(n_eval, 1)
            if pct >= min_pct:
                patterns.append(PatternDetection(
                    pattern_id=pattern_id,
                    severity=round(min(1.0, pct * 2), 3),
                    affected_pct=round(pct, 3),
                    judge_name=judge_name,
                    description=description,
                    sample_flags=[flag_name],
                ))

        # Deduplicate by pattern_id (keep highest severity)
        seen: dict[str, PatternDetection] = {}
        for p in patterns:
            if p.pattern_id not in seen or p.severity > seen[p.pattern_id].severity:
                seen[p.pattern_id] = p

        return sorted(seen.values(), key=lambda p: p.severity, reverse=True)

    def _generate_suggestions(
        self,
        patterns: list[PatternDetection],
        scope: dict,
        by_strategy: dict[str, list[dict]],
    ) -> list[PromptSuggestion]:
        """Map detected patterns to concrete prompt override suggestions."""
        suggestions = []

        # Build scope key for the most specific level available.
        # H-8: scope["theme"] is a UUID from the API — consistent with what apply_prompt_overrides
        # now stores after looking up curriculum_theme_id from the capsule.
        subject = scope.get("subject", "")
        phase = scope.get("phase")
        if scope.get("capsule"):
            scope_type, scope_key = "capsule", scope["capsule"]
        elif scope.get("theme"):
            scope_type, scope_key = "theme", scope["theme"]
        elif phase and subject:
            scope_type, scope_key = "phase", f"{subject}:{phase}"
        elif subject:
            scope_type, scope_key = "subject", subject
        else:
            scope_type, scope_key = "global", "all"

        for pattern in patterns:
            template = _SUGGESTION_TEMPLATES.get(pattern.pattern_id)
            if not template:
                continue

            # For low_engagement, add strategy-specific boosts
            if pattern.pattern_id == "low_engagement":
                for strat, boost in _STRATEGY_ENGAGEMENT.items():
                    if strat in by_strategy:
                        suggestions.append(PromptSuggestion(
                            pattern_id=pattern.pattern_id,
                            scope_type=scope_type,
                            scope_key=scope_key,
                            strategy=strat,
                            override_type="append",
                            content=template["content"] + "\n\n" + boost,
                            rationale=f"{pattern.description} (strategy: {strat}, affected: {pattern.affected_pct:.0%})",
                            expected_improvement=template["expected_improvement"],
                        ))
            else:
                suggestions.append(PromptSuggestion(
                    pattern_id=pattern.pattern_id,
                    scope_type=scope_type,
                    scope_key=scope_key,
                    override_type=template["override_type"],
                    content=template["content"],
                    rationale=f"{pattern.description} (affected: {pattern.affected_pct:.0%}, severity: {pattern.severity})",
                    expected_improvement=template["expected_improvement"],
                ))

        return suggestions

    def apply_suggestion(
        self,
        suggestion: PromptSuggestion,
        actor: str,
        active: bool = True,
        source: str = "auto_optimizer",
    ) -> str:
        """Write a suggestion as a prompt_override. Returns the override ID.

        C-4: Global-scope overrides are written as inactive (pending human review).
        C-3: 'replace' type is downgraded to 'append' for auto-optimizer safety.
        """
        override_type = suggestion.override_type
        if override_type == "replace":
            log.warning("Downgrading 'replace' override to 'append' for auto-optimizer safety (C-3)")
            override_type = "append"

        is_global = suggestion.scope_type == "global"
        if is_global and active:
            log.info("Global-scope override requires human approval — writing as inactive (C-4)")
            active = False

        row = db.upsert_prompt_override(
            scope_type=suggestion.scope_type,
            scope_key=suggestion.scope_key,
            prompt_id=suggestion.prompt_id,
            strategy=suggestion.strategy,
            override_type=override_type,
            content=suggestion.content,
            created_by=actor,
            source=source,
            active=active,
            performance_data={
                "pattern_id": suggestion.pattern_id,
                "expected_improvement": suggestion.expected_improvement,
                "rationale": suggestion.rationale,
                "pending_review": is_global,
            },
        )
        return str(row.get("id", ""))

    def run_ab_test(
        self,
        scope: dict,
        suggestion: PromptSuggestion,
        actor: str,
        sample_size: int = 10,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> ABTestResult:
        """Generate variants with/without the override, evaluate both arms, compare.

        C-1 fixes:
          - Override is written as INACTIVE before test; only activated for treatment arm.
          - Arms are split by creation timestamp, not position.
          - try/finally guarantees override is cleaned up on exception.
          - is_cancelled propagated into generation legs (H-6).
        """
        from explanation_gen_service import generate_for_scope
        from distillation_pipeline import _evaluate_single_explanation

        override_id = None
        try:
            # 1. Generate control variants (no override active yet)
            if is_cancelled and is_cancelled():
                return ABTestResult(
                    suggestion_id="", control_scores=[], treatment_scores=[],
                    control_mean=0.0, treatment_mean=0.0, improvement_delta=0.0,
                    sample_size=0, recommend_keep=False,
                )

            generate_for_scope(
                scope,
                strategies=[suggestion.strategy] if suggestion.strategy else None,
                max_facts=sample_size,
                is_cancelled=is_cancelled,
            )
            control_cutoff = datetime.now(timezone.utc).isoformat()

            if is_cancelled and is_cancelled():
                raise RuntimeError("Cancelled after control generation")

            # 2. Write override as INACTIVE (pending AB test — won't affect generation yet)
            override_id = self.apply_suggestion(
                suggestion, actor, active=False, source="ab_test",
            )

            # 3. Activate override then generate treatment arm
            db.activate_prompt_override(override_id)
            treatment_start = datetime.now(timezone.utc).isoformat()

            if is_cancelled and is_cancelled():
                raise RuntimeError("Cancelled before treatment generation")

            generate_for_scope(
                scope,
                strategies=[suggestion.strategy] if suggestion.strategy else None,
                max_facts=sample_size,
                is_cancelled=is_cancelled,
            )
            treatment_end = datetime.now(timezone.utc).isoformat()

            # 4. Evaluate both arms — split by creation timestamp (not position)
            all_variants = db.list_distillation_variants(
                subject_name=scope.get("subject"),
                phase=scope.get("phase"),
                theme_name=scope.get("theme"),
                capsule_name=scope.get("capsule"),
                status="draft",
            )

            control_scores: list[float] = []
            treatment_scores: list[float] = []

            for row in all_variants:
                v = row["variant"]
                created_at = v.get("created_at", "")
                if not created_at:
                    continue
                if (v.get("evaluation") or {}).get("composite_score") is not None:
                    continue  # already evaluated

                if created_at < control_cutoff:
                    arm = "control"
                elif treatment_start <= created_at <= treatment_end:
                    arm = "treatment"
                else:
                    continue  # in transition window or after test

                updated = _evaluate_single_explanation(
                    v, row.get("fact_text", ""),
                    row.get("age_range", "10-12"),
                    row.get("subject_name", ""),
                )
                score = (updated.get("evaluation") or {}).get("composite_score")
                if score is None:
                    continue
                if arm == "control" and len(control_scores) < sample_size:
                    control_scores.append(score)
                elif arm == "treatment" and len(treatment_scores) < sample_size:
                    treatment_scores.append(score)

            # 5. Compare with statistical power checks (M-1)
            _MIN_N = 10        # minimum per-arm sample size for a meaningful comparison
            _MIN_DELTA = 0.03  # minimum absolute improvement to recommend keeping

            ctrl_mean = statistics.mean(control_scores) if control_scores else 0.0
            treat_mean = statistics.mean(treatment_scores) if treatment_scores else 0.0
            delta = treat_mean - ctrl_mean

            # Welch's t-statistic (pure stdlib — no scipy needed)
            n1, n2 = len(control_scores), len(treatment_scores)
            t_stat = 0.0
            if n1 > 1 and n2 > 1:
                s1 = statistics.stdev(control_scores)
                s2 = statistics.stdev(treatment_scores)
                se = math.sqrt(s1 ** 2 / n1 + s2 ** 2 / n2)
                t_stat = delta / se if se > 0 else 0.0

            # Require: adequate N, meaningful delta, t > 1.65 (≈ one-tailed p < 0.05 at large N)
            recommend = (
                n1 >= _MIN_N
                and n2 >= _MIN_N
                and delta >= _MIN_DELTA
                and t_stat >= 1.65
            )

            log.info(
                "A/B result: ctrl_mean=%.4f (n=%d) treat_mean=%.4f (n=%d) delta=%.4f t=%.2f recommend=%s",
                ctrl_mean, n1, treat_mean, n2, delta, t_stat, recommend,
            )

            if recommend:
                # Keep override active permanently
                log.info("A/B test recommends keeping override %s (delta=%.4f)", override_id, delta)
            else:
                db.deactivate_prompt_override(override_id)
                log.info("A/B test not keeping override %s (delta=%.4f, ctrl_n=%d, treat_n=%d)",
                         override_id, delta, len(control_scores), len(treatment_scores))
                override_id = None  # prevent double-deactivate in finally

            return ABTestResult(
                suggestion_id=override_id or "",
                control_scores=control_scores,
                treatment_scores=treatment_scores,
                control_mean=round(ctrl_mean, 4),
                treatment_mean=round(treat_mean, 4),
                improvement_delta=round(delta, 4),
                sample_size=len(control_scores) + len(treatment_scores),
                recommend_keep=recommend,
                t_stat=round(t_stat, 4),
            )

        except Exception:
            # C-1: Always clean up override on any exception
            if override_id:
                try:
                    db.deactivate_prompt_override(override_id)
                    log.info("Cleaned up A/B test override %s after exception", override_id)
                except Exception:
                    log.warning("Failed to clean up A/B override %s", override_id)
            raise


OPTIMIZER = PromptOptimizer()
