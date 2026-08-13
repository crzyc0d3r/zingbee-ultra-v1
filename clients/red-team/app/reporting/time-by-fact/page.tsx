"use client";

import { ReportShell, Panel, BarRow, fmtDur } from "@/components/reporting/ReportShell";

export default function TimeByFactPage() {
  return (
    <ReportShell
      kind="time"
      title="Time by Fact"
      subtitle="Total time spent on each fact across all students. Per-event gaps are capped at 5 min so AFK time doesn't pollute totals."
      render={(data) => {
        const rows = data.time_by_fact;
        const max = rows[0]?.seconds || 0;
        return (
          <Panel title={`Top ${rows.length} facts by time spent`} count={rows.length}>
            {rows.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 12 }}>No fact-level activity in this range.</div>
            ) : rows.map((f) => {
              const avgPerSession = f.sessions ? Math.round(f.seconds / f.sessions) : 0;
              return (
                <BarRow
                  key={f.fact_text}
                  label={f.fact_text}
                  value={f.seconds}
                  max={max}
                  formatted={fmtDur(Math.round(f.seconds))}
                  sub={`${f.unique_students} student${f.unique_students === 1 ? "" : "s"} · ${f.sessions} sess · ${fmtDur(avgPerSession)}/sess avg`}
                />
              );
            })}
          </Panel>
        );
      }}
    />
  );
}
