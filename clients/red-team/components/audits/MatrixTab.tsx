"use client";

import type { AuditInsight } from "./types";

interface Props {
  insights?: AuditInsight[];
}

function sevColor(sev: string): string {
  return sev === "concern" ? "#f472b6" : sev === "suggestion" ? "#fbbf24" : "#4ade80";
}

function healthColor(concern: number, suggestion: number, total: number): string {
  if (total === 0) return "#475569";
  const ratio = concern / total;
  if (ratio > 0.3) return "#f472b6";
  if (concern > 0 || suggestion / total > 0.5) return "#fbbf24";
  return "#2dd4bf";
}

export function MatrixTab({ insights }: Props) {
  if (!insights || insights.length === 0) {
    return (
      <div className="mx">
        <div className="it-empty">No insights available. Generate insights first.</div>
      </div>
    );
  }

  // Build subject × phase matrix
  const subjects = new Set<string>();
  const phases = new Set<string>();
  const matrix: Record<string, Record<string, { concern: number; suggestion: number; strength: number }>> = {};

  for (const ins of insights) {
    subjects.add(ins.subject);
    phases.add(ins.phase);
    if (!matrix[ins.subject]) matrix[ins.subject] = {};
    if (!matrix[ins.subject][ins.phase]) matrix[ins.subject][ins.phase] = { concern: 0, suggestion: 0, strength: 0 };
    matrix[ins.subject][ins.phase][ins.severity]++;
  }

  const sortedSubjects = [...subjects].sort();
  const sortedPhases = [...phases].sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, "")) || 0;
    const nb = parseInt(b.replace(/\D/g, "")) || 0;
    return na - nb || a.localeCompare(b);
  });

  // Subject totals
  const subjectTotals: Record<string, { concern: number; suggestion: number; strength: number }> = {};
  for (const subj of sortedSubjects) {
    subjectTotals[subj] = { concern: 0, suggestion: 0, strength: 0 };
    for (const phase of sortedPhases) {
      const cell = matrix[subj]?.[phase];
      if (cell) {
        subjectTotals[subj].concern += cell.concern;
        subjectTotals[subj].suggestion += cell.suggestion;
        subjectTotals[subj].strength += cell.strength;
      }
    }
  }

  return (
    <div className="mx">
      <h3 className="mx-heading">Insights Matrix</h3>
      <div className="mx-scroll">
        <table className="mx-table">
          <thead>
            <tr>
              <th>Subject</th>
              {sortedPhases.map((p) => <th key={p}>{p}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedSubjects.map((subj) => {
              const tot = subjectTotals[subj];
              const subjTotal = tot.concern + tot.suggestion + tot.strength;
              return (
                <tr key={subj}>
                  <td className="mx-subj">{subj}</td>
                  {sortedPhases.map((phase) => {
                    const cell = matrix[subj]?.[phase];
                    if (!cell) return <td key={phase} className="mx-cell"><span className="mx-val" style={{ color: "#475569" }}>-</span></td>;
                    const total = cell.concern + cell.suggestion + cell.strength;
                    const color = healthColor(cell.concern, cell.suggestion, total);
                    return (
                      <td key={phase} className="mx-cell">
                        <div className="mx-insight-cell">
                          {cell.concern > 0 && <span style={{ color: sevColor("concern") }} title="Concerns">{cell.concern}</span>}
                          {cell.suggestion > 0 && <span style={{ color: sevColor("suggestion") }} title="Suggestions">{cell.suggestion}</span>}
                          {cell.strength > 0 && <span style={{ color: sevColor("strength") }} title="Strengths">{cell.strength}</span>}
                        </div>
                        <div className="mx-bar">
                          <div className="mx-bar-fill" style={{
                            width: `${total > 0 ? Math.round((cell.strength / total) * 100) : 0}%`,
                            background: color,
                          }} />
                        </div>
                      </td>
                    );
                  })}
                  <td className="mx-cell">
                    <div className="mx-insight-cell" style={{ fontWeight: 700 }}>
                      {tot.concern > 0 && <span style={{ color: sevColor("concern") }}>{tot.concern}</span>}
                      {tot.suggestion > 0 && <span style={{ color: sevColor("suggestion") }}>{tot.suggestion}</span>}
                      {tot.strength > 0 && <span style={{ color: sevColor("strength") }}>{tot.strength}</span>}
                      <span style={{ color: "#94a3b8", marginLeft: 4 }}>{subjTotal}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mx-legend">
        <span><span className="mx-legend-dot" style={{ background: sevColor("concern") }} /> Concerns</span>
        <span><span className="mx-legend-dot" style={{ background: sevColor("suggestion") }} /> Suggestions</span>
        <span><span className="mx-legend-dot" style={{ background: sevColor("strength") }} /> Strengths</span>
        <span className="mx-legend-note">Bar shows strength ratio — more green = healthier</span>
      </div>
    </div>
  );
}
