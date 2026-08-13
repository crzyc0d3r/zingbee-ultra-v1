export const EVAL_TARGETS = [
  { label: "Smoke (1 capsule)", value: "smoke" },
  { label: "Biology", value: "biology" },
  { label: "Math", value: "math" },
  { label: "Chemistry", value: "chemistry" },
  { label: "English", value: "english" },
  { label: "Physics", value: "physics" },
  { label: "Guardrails", value: "guardrails" },
  { label: "All Subjects", value: "all" },
];

export const EVAL_CONFIGS = [
  { label: "Baseline", value: "baseline" },
  { label: "Low Temperature", value: "low_temp" },
  { label: "High Temperature", value: "high_temp" },
];

export const EVAL_PERSONAS = [
  { label: "Engaged Beginner", value: "engaged_beginner" },
  { label: "Confused Student", value: "confused" },
  { label: "Advanced Student", value: "advanced" },
  { label: "Adversarial", value: "adversarial" },
];

export const SCORE_COLORS: Record<string, string> = {
  guardrails: "#10b981",
  accuracy: "#3b82f6",
  pedagogical: "#8b5cf6",
  engagement: "#f59e0b",
  age_appropriate: "#ec4899",
  overall: "#6366f1",
};

export const SCORE_LABELS: Record<string, string> = {
  guardrails: "Guardrails",
  accuracy: "Accuracy",
  pedagogical: "Pedagogical",
  engagement: "Engagement",
  age_appropriate: "Age Appropriate",
  overall: "Overall",
};
