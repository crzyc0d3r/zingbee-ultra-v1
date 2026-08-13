"use client";

import { ReportShell, Panel, BarRow, Donut, fmtUSD, SERIES_COLORS } from "@/components/reporting/ReportShell";

export default function CostBySubjectPage() {
  return (
    <ReportShell
      kind="cost"
      title="Cost by Subject"
      subtitle="Cost grouped by the subject of the capsule each session was working on."
      render={(data) => {
        const rows = data.cost_by_subject;
        const max = rows[0]?.cost_usd || 0;
        return (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
            <Panel title="Share of Cost">
              <Donut
                data={rows.map((r, i) => ({
                  label: r.subject, value: r.cost_usd, color: SERIES_COLORS[i % SERIES_COLORS.length],
                }))}
                valueFmt={fmtUSD}
              />
            </Panel>
            <Panel title="Per Subject" count={rows.length}>
              {rows.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: 12 }}>No costs in this range.</div>
              ) : rows.map((s) => (
                <BarRow
                  key={s.subject}
                  label={s.subject}
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
