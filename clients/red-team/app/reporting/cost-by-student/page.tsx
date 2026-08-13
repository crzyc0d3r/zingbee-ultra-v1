"use client";

import { ReportShell, Panel, BarRow, Donut, fmtUSD } from "@/components/reporting/ReportShell";

export default function CostByStudentPage() {
  return (
    <ReportShell
      kind="cost"
      title="Cost by Student"
      subtitle="Total LLM and media cost attributed to each student within the selected date range."
      render={(data) => {
        const rows = data.cost_by_student;
        const max = rows[0]?.cost_usd || 0;
        return (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
            <Panel title="Share of Cost">
              <Donut
                data={rows.slice(0, 8).map((r) => ({ label: r.student_name, value: r.cost_usd }))}
                valueFmt={fmtUSD}
              />
            </Panel>
            <Panel title="Per Student" count={rows.length}>
              {rows.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: 12 }}>No costs in this range.</div>
              ) : rows.map((s) => (
                <BarRow
                  key={s.student_id}
                  label={s.student_name}
                  value={s.cost_usd}
                  max={max}
                  formatted={fmtUSD(s.cost_usd)}
                />
              ))}
            </Panel>
          </div>
        );
      }}
    />
  );
}
