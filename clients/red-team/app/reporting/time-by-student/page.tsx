"use client";

import { ReportShell, Panel, Donut, fmtDur, fmtUSD, SERIES_COLORS } from "@/components/reporting/ReportShell";

function fmtSecondsAsMinSec(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}

export default function TimeByStudentPage() {
  return (
    <ReportShell
      kind="time"
      title="Time by Student"
      subtitle="Total learning time per student plus derived efficiency metrics (time per fact, accuracy)."
      render={(data) => {
        const rows = data.students_detailed;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
              <Panel title="Share of Learning Time">
                <Donut
                  data={rows.slice(0, 8).map((r, i) => ({
                    label: r.student_name,
                    value: r.duration_seconds,
                    color: SERIES_COLORS[i % SERIES_COLORS.length],
                  }))}
                  valueFmt={(n) => fmtDur(n)}
                />
              </Panel>
              <Panel title="Share of Facts Taught">
                <Donut
                  data={rows.slice(0, 8).map((r, i) => ({
                    label: r.student_name,
                    value: r.facts_taught,
                    color: SERIES_COLORS[i % SERIES_COLORS.length],
                  }))}
                  valueFmt={(n) => String(n)}
                />
              </Panel>
            </div>

            <Panel title="Per-Student Detail" count={rows.length}>
              {rows.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: 12 }}>No sessions in this range.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: "#64748b", textAlign: "left", borderBottom: "1px solid #1e293b" }}>
                        <th style={{ padding: "6px 8px", fontWeight: 500 }}>Student</th>
                        <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Sessions</th>
                        <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Total Time</th>
                        <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Avg Session</th>
                        <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Facts Taught</th>
                        <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Time / Fact</th>
                        <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Accuracy</th>
                        <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Cost</th>
                        <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>$ / Fact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const avgSession = r.sessions ? Math.round(r.duration_seconds / r.sessions) : 0;
                        return (
                          <tr key={r.student_id} style={{ borderBottom: "1px solid #1e293b22", color: "#cbd5e1" }}>
                            <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{r.student_name}</td>
                            <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.sessions}</td>
                            <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtDur(r.duration_seconds)}</td>
                            <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#94a3b8" }}>{fmtDur(avgSession)}</td>
                            <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.facts_taught}</td>
                            <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtSecondsAsMinSec(r.seconds_per_fact)}</td>
                            <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                                         color: r.accuracy_pct == null ? "#64748b" : r.accuracy_pct >= 70 ? "#22c55e" : r.accuracy_pct >= 40 ? "#f59e0b" : "#ef4444" }}>
                              {r.accuracy_pct == null ? "—" : r.accuracy_pct.toFixed(0) + "%"}
                            </td>
                            <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#94a3b8" }}>{fmtUSD(r.cost_usd)}</td>
                            <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#94a3b8" }}>{r.usd_per_fact == null ? "—" : fmtUSD(r.usd_per_fact)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        );
      }}
    />
  );
}
