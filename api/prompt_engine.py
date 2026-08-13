"""Prompt template engine for the v6 tutor state machine.

Loads prompts from learning_system_schemas.descision_tree and the v6 spec,
interpolates variables from persona + curriculum + fact data.
"""

import re
import logging
from string import Template
from typing import Optional

log = logging.getLogger(__name__)


class PromptEngine:
    """Loads and renders prompt templates from the decision tree schema."""

    def __init__(self, decision_tree: dict, persona: dict, curriculum: dict):
        """
        Args:
            decision_tree: Full descision_tree JSONB from learning_system_schemas
            persona: tutors.persona JSONB (tutor_name, creator_name, persona_description, persona_traits)
            curriculum: Dict with subject, subject_lower, age_range, phase, capsule_name
        """
        self._dt = decision_tree
        self._prompts = decision_tree.get("prompt_registry", {})
        self._injection_map = decision_tree.get("fact_field_injection_map", {})
        self._message_order = decision_tree.get("message_injection_order", {})

        # Persona traits may be a list or string
        traits = persona.get("persona_traits", "")
        if isinstance(traits, list):
            traits = "\n".join(f"- {t}" for t in traits)

        # Base variables available for all prompts
        self._base_vars = {
            "tutor_name": persona.get("tutor_name", "Tutor"),
            "creator_name": persona.get("creator_name", "ZingBee and Academy"),
            "persona_description": persona.get("persona_description", "a helpful"),
            "persona_traits": traits,
            "subject": curriculum.get("subject", ""),
            "subject_lower": curriculum.get("subject_lower", ""),
            "age_range": curriculum.get("age_range", "10-12"),
            "phase": str(curriculum.get("phase", 1)),
            "capsule_name": curriculum.get("capsule_name", ""),
        }

    def render(self, prompt_id: str, extra_vars: dict = None) -> str:
        """Render a prompt template with variable interpolation.

        Uses $variable-style templates with safe_substitute (unmatched vars left as-is).
        """
        prompt_entry = self._prompts.get(prompt_id, {})
        template_text = prompt_entry.get("template", "")

        if not template_text:
            log.warning("Prompt template '%s' has no template text", prompt_id)
            return ""

        # Merge base vars with extra vars
        all_vars = {**self._base_vars}
        if extra_vars:
            all_vars.update(extra_vars)

        return Template(template_text).safe_substitute(all_vars)

    def get_fact_vars(self, fact_meta: dict, prompt_id: str) -> dict:
        """Extract fact fields for a specific prompt based on the injection map."""
        mapping = self._injection_map.get("map", {})
        fields = mapping.get(prompt_id, [])

        result = {}
        for field in fields:
            if field in fact_meta:
                val = fact_meta[field]
                # Convert lists to strings for template interpolation
                if isinstance(val, list):
                    if field == "evidence_questions":
                        val = "\n".join(f"    - {q}" for q in val)
                    elif field == "scaffold":
                        val = ", ".join(val)
                    else:
                        val = ", ".join(str(v) for v in val)
                result[field] = val
            elif field == "core_fact":
                result["core_fact"] = fact_meta.get("core_fact", fact_meta.get("text", ""))
        return result

    def build_system_prompt(self, covered_section: str, next_section: str,
                            remaining_section: str, start_step: str,
                            start_instruction: str) -> str:
        """Build the full system prompt for session start."""
        return self.render("system_prompt", {
            "covered_section": covered_section,
            "next_section": next_section,
            "remaining_section": remaining_section,
            "start_step": start_step,
            "start_instruction": start_instruction,
        })

    def build_start_prompt(self, variant: str, student_name: str,
                           first_fact_meta: dict = None, **extra) -> str:
        """Build one of the 5 start prompts."""
        vars_dict = {"student_name": student_name, **extra}
        if first_fact_meta:
            vars_dict.update(self.get_fact_vars(first_fact_meta, variant))
            # Alias for start prompts
            if "core_fact" in vars_dict:
                vars_dict.setdefault("first_fact", vars_dict["core_fact"])
            for field in ("process", "vocabulary", "misconception"):
                if field in vars_dict:
                    vars_dict.setdefault(f"first_{field}", vars_dict[field])
        return self.render(variant, vars_dict)

    def build_step_transition(self, prompt_id: str, fact_meta: dict, **extra) -> str:
        """Build a step transition prompt (step_teach, step_try, etc.)."""
        vars_dict = self.get_fact_vars(fact_meta, prompt_id)
        # Always ensure core_fact is set
        if "core_fact" not in vars_dict and fact_meta.get("core_fact"):
            vars_dict["core_fact"] = fact_meta["core_fact"]
        vars_dict.update(extra)
        return self.render(prompt_id, vars_dict)

    def build_classifier_prompt(self, core_fact: str, current_step: str,
                                tutor_last_summary: str, student_message: str) -> tuple:
        """Build classifier system + user prompts. Returns (system_msg, user_msg)."""
        sys_msg = self.render("classifier_system_message")
        user_msg = self.render("classifier_user_prompt", {
            "core_fact": core_fact,
            "fact_sub_step": current_step,
            "tutor_last_summary": tutor_last_summary,
            "student_message": student_message,
        })
        return sys_msg, user_msg

    def build_assessor_prompt(self, fact_meta: dict, current_step: str,
                              recent_taught_str: str, mastered_count: int,
                              total_facts: int, tutor_response: str,
                              student_message: str, previous_tutor_message: str) -> tuple:
        """Build assessor system + user prompts. Returns (system_msg, user_msg)."""
        sys_msg = self.render("assessment_system_message")
        user_msg = self.render("assessment_user_prompt", {
            "core_fact": fact_meta.get("core_fact", ""),
            "fact_sub_step": current_step,
            "vocabulary": fact_meta.get("vocabulary", ""),
            "misconception": fact_meta.get("misconception", ""),
            "recent_taught_str": recent_taught_str,
            "mastered_count": str(mastered_count),
            "total_facts": str(total_facts),
            "tutor_response": tutor_response,
            "student_message": student_message,
            "previous_tutor_message": previous_tutor_message,
        })
        return sys_msg, user_msg

    def build_compliance_correction(self, fact_meta: dict) -> str:
        """Build compliance correction prompt."""
        vars_dict = self.get_fact_vars(fact_meta, "compliance_correction")
        return self.render("compliance_correction", vars_dict)

    def build_question_correction(self, student_message: str, core_fact: str) -> str:
        """Build question correction prompt for incorrect redirects."""
        return self.render("question_correction", {
            "student_message": student_message,
            "core_fact": core_fact,
        })

    def get_llm_config(self, role: str) -> dict:
        """Get LLM configuration for a role (tutor, full_assessor, quick_classifier)."""
        return self._dt.get("config", {}).get("llm_roles", {}).get(role, {})

    def get_student_context_injection(self, classifier_type: str) -> Optional[str]:
        """Map classifier type to student context injection string."""
        injections = self._prompts.get("student_context_injections", {})
        if isinstance(injections, dict):
            mapping = injections.get("mapping", {})
            return mapping.get(classifier_type)
        return None

    @property
    def classifier_skip_rules(self) -> list:
        """Get classifier skip rules from the schema."""
        rules = self._prompts.get("classifier_skip_rules", {})
        if isinstance(rules, dict):
            return rules.get("rules", [])
        return []
