"use client";

import { useState } from "react";
import type { JudgePayload } from "@/lib/images/types";
import { JUDGE_CONTROLS } from "@/lib/images/constants";

const JUDGE_LABELS: Record<string, string> = Object.fromEntries(
  JUDGE_CONTROLS.map(({ key, label }) => [key, label]),
);

function scoreColor(score: number | undefined): string {
  if (score === undefined) return "#475569";
  if (score >= 0.85) return "#22c55e";
  if (score >= 0.5) return "#f59e0b";
  return "#ef4444";
}

export function JudgeDetailPanel({
  judges,
  composite,
  decision,
}: {
  judges?: Record<string, JudgePayload>;
  composite?: number;
  decision?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!judges || !Object.keys(judges).length) {
    return <div className="judge-panel-empty">No judge scores available.</div>;
  }

  return (
    <div className="judge-panel">
      <button
        className="judge-panel-toggle"
        onClick={() => setExpanded(!expanded)}
        title="Show/hide individual judge scores and reasoning"
      >
        {expanded ? "Hide" : "Show"} Judge Details
        {composite !== undefined && (
          <span className="judge-panel-composite" style={{ color: scoreColor(composite) }}>
            {composite.toFixed(3)}
          </span>
        )}
        {decision && <span className={`badge ${decision}`}>{decision}</span>}
      </button>
      {expanded && (
        <div className="judge-panel-grid">
          {JUDGE_CONTROLS.map(({ key }) => {
            const payload = judges[key];
            if (!payload) return null;
            return (
              <div key={key} className="judge-panel-item">
                <div className="judge-panel-header">
                  <span className="judge-panel-name">{JUDGE_LABELS[key] || key}</span>
                  <span
                    className="judge-panel-score"
                    style={{ color: scoreColor(payload.score) }}
                  >
                    {payload.score !== undefined ? payload.score.toFixed(2) : "-"}
                  </span>
                </div>
                {payload.flags && payload.flags.length > 0 && (
                  <div className="judge-panel-flags">
                    {payload.flags.map((flag) => (
                      <span key={flag} className="judge-panel-flag">{flag}</span>
                    ))}
                  </div>
                )}
                {payload.reasoning && (
                  <div className="judge-panel-reasoning">{payload.reasoning}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
