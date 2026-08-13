"use client";

import type { SubjectStats, AuditInsight } from "./types";

interface Props {
  subjectStats: Record<string, SubjectStats>;
  insights?: AuditInsight[];
}

function severityColor(sev: string) {
  return sev === "concern" ? "#f472b6" : sev === "suggestion" ? "#fbbf24" : "#4ade80";
}

export function OverviewTab({ subjectStats, insights }: Props) {
  const subjects = Object.entries(subjectStats).sort(([a], [b]) => a.localeCompare(b));

  // Insight summary by subject
  const subjectInsights: Record<string, { concern: number; suggestion: number; strength: number }> = {};
  for (const ins of (insights ?? [])) {
    if (!subjectInsights[ins.subject]) subjectInsights[ins.subject] = { concern: 0, suggestion: 0, strength: 0 };
    subjectInsights[ins.subject][ins.severity]++;
  }
  const insightSubjects = Object.entries(subjectInsights).sort(
    ([, a], [, b]) => (b.concern * 100 + b.suggestion * 10) - (a.concern * 100 + a.suggestion * 10)
  );

  return (
    <div className="ov">
      <div className="ov-section">
        <h3 className="ov-heading">Subject Overview</h3>
        <div className="ov-cards">
          {subjects.map(([name, s]) => (
            <div key={name} className="ov-card">
              <div className="ov-card-name">{name}</div>
              <div className="ov-card-stats">
                <span>Phases: <b>{s.phases}</b></span>
                <span>Themes: <b>{s.themes}</b></span>
                <span>Capsules: <b>{s.capsules}</b></span>
              </div>
              <div className="ov-card-stats">
                <span>Facts: <b>{s.total_facts}</b></span>
                <span>Avg: <b>{s.avg_facts}</b></span>
                <span>Range: <b>{s.min_facts}-{s.max_facts}</b></span>
              </div>
              {s.zero_fact_capsules > 0 && (
                <div className="ov-card-warn">
                  {s.zero_fact_capsules} capsule{s.zero_fact_capsules > 1 ? "s" : ""} with 0 facts
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {insightSubjects.length > 0 && (
        <div className="ov-section">
          <h3 className="ov-heading">Insights by Subject</h3>
          <table className="ov-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Concerns</th>
                <th>Suggestions</th>
                <th>Strengths</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {insightSubjects.map(([subj, c]) => (
                <tr key={subj}>
                  <td>{subj}</td>
                  <td style={{ color: severityColor("concern") }}>{c.concern || "-"}</td>
                  <td style={{ color: severityColor("suggestion") }}>{c.suggestion || "-"}</td>
                  <td style={{ color: severityColor("strength") }}>{c.strength || "-"}</td>
                  <td>{c.concern + c.suggestion + c.strength}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
