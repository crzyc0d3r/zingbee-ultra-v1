export const IMAGE_COMMANDS = ["generate", "evaluate", "reprompt", "loop"] as const;
export type ImageCommand = (typeof IMAGE_COMMANDS)[number];

export type JudgeParamInput = {
  temperature: string;
  maxTokens: string;
};

export const JUDGE_CONTROLS: { key: string; label: string }[] = [
  { key: "child_safety", label: "Child Safety" },
  { key: "fact_checker", label: "Fact Checker" },
  { key: "misinterpretation_hunter", label: "Misinterpretation Hunter" },
  { key: "visual_clarity", label: "Visual Clarity" },
  { key: "text_accuracy", label: "Text Accuracy" },
  { key: "pedagogical_effectiveness", label: "Pedagogical Effectiveness" },
  { key: "cultural_representation", label: "Cultural Representation" },
];

export const DEFAULT_JUDGE_TOKEN_HINTS: Record<string, number> = {
  child_safety: 1024,
  text_accuracy: 1024,
  fact_checker: 2048,
  visual_clarity: 2048,
  misinterpretation_hunter: 1024,
  pedagogical_effectiveness: 1024,
  cultural_representation: 1024,
};

export function createEmptyJudgeParamInputs(): Record<string, JudgeParamInput> {
  return Object.fromEntries(
    JUDGE_CONTROLS.map(({ key }) => [key, { temperature: "", maxTokens: "" }]),
  ) as Record<string, JudgeParamInput>;
}
