"use client";

import type { AuditSummary, AuditInsight } from "./types";

interface Props {
  summary: AuditSummary;
  title: string;
  generatedAt: string;
  insights?: AuditInsight[];
}

function healthColor(score: number): string {
  if (score >= 80) return "#2dd4bf";
  if (score >= 60) return "#fbbf24";
  return "#f472b6";
}

function severityColor(severity: string): string {
  if (severity === "concern") return "#f472b6";
  if (severity === "suggestion") return "#fbbf24";
  return "#4ade80";
}

export function AuditHeader({ summary, title, generatedAt, insights }: Props) {
  // Compute insight counts from actual insights array if available
  let concern = 0, suggestion = 0, strength = 0;
  if (insights && insights.length > 0) {
    for (const ins of insights) {
      if (ins.severity === "concern") concern++;
      else if (ins.severity === "suggestion") suggestion++;
      else if (ins.severity === "strength") strength++;
    }
  } else if (summary.concern_count != null) {
    concern = summary.concern_count;
    suggestion = summary.suggestion_count;
    strength = summary.strength_count;
  } else {
    concern = summary.critical_count ?? 0;
    suggestion = summary.warning_count ?? 0;
    strength = summary.info_count ?? 0;
  }

  const health = insights && insights.length > 0
    ? Math.max(0, 100 - 10 * concern - 3 * suggestion)
    : summary.health_score;
  const color = healthColor(health);

  const stats = [
    { label: "Subjects", value: summary.subjects_count },
    { label: "Capsules", value: summary.capsules_count },
    { label: "Facts", value: summary.facts_count },
    { label: "Phases", value: summary.phases_count },
  ];
  const severities = [
    { label: "Concerns", count: concern, sev: "concern" },
    { label: "Suggestions", count: suggestion, sev: "suggestion" },
    { label: "Strengths", count: strength, sev: "strength" },
  ];

  return (
    <div className="ah">
      <div className="ah-top">
        <div>
          <div className="ah-title">{title}</div>
          <div className="ah-date">{generatedAt}</div>
        </div>
        <div className="ah-health">
          <div className="ah-health-score" style={{ color }}>{health}%</div>
          <div className="ah-health-label">Health</div>
          <div className="ah-health-bar">
            <div className="ah-health-fill" style={{ width: `${health}%`, background: color }} />
          </div>
        </div>
      </div>
      <div className="ah-stats">
        {stats.map((s) => (
          <div key={s.label} className="ah-stat">
            <div className="ah-stat-val">{s.value.toLocaleString()}</div>
            <div className="ah-stat-label">{s.label}</div>
          </div>
        ))}
        <div className="ah-divider" />
        {severities.map((i) => (
          <div key={i.sev} className="ah-stat">
            <div className="ah-stat-val" style={{ color: severityColor(i.sev) }}>{i.count}</div>
            <div className="ah-stat-label">{i.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
