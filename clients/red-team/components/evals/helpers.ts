"use client";

export function formatDuration(secs: number): string {
  if (secs < 60) return Math.round(secs) + "s";
  if (secs < 3600) return Math.round(secs / 60) + "m";
  return (secs / 3600).toFixed(1) + "h";
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return iso;
  }
}

export function scoreColor(v: number): string {
  return v >= 0.8 ? "#2dd4bf" : v >= 0.6 ? "#fbbf24" : "#f472b6";
}

export const SCORE_KEYS = [
  "guardrails",
  "accuracy",
  "pedagogical",
  "engagement",
  "age_appropriateness",
] as const;
