"use client";

import {
  ReportShell, Panel, BarRow, Donut, StackedTimeChart, fmtUSD, SERIES_COLORS,
} from "@/components/reporting/ReportShell";

export default function CostByWorkloadPage() {
  return (
    <ReportShell
      kind="cost"
      title="Cost by Workload"
      subtitle="Cost broken down by LLM/sequence type (Tutor, Assessor, Classifier, Image, TTS)."
      render={(data) => {
        const rows = data.cost_by_bucket;
        const max = rows[0]?.cost_usd || 0;

        // Time series stacked by bucket
        const series = rows.map((r, i) => ({ key: r.bucket, color: SERIES_COLORS[i % SERIES_COLORS.length] }));
        const days = data.daily.map((d) => ({ date: d.date, values: d.by_bucket }));

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel title="Cost Over Time (stacked by workload)">
              <StackedTimeChart days={days} series={series} valueFmt={fmtUSD} />
            </Panel>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
              <Panel title="Share of Cost">
                <Donut
                  data={rows.map((r, i) => ({
                    label: r.bucket, value: r.cost_usd, color: SERIES_COLORS[i % SERIES_COLORS.length],
                  }))}
                  valueFmt={fmtUSD}
                />
              </Panel>
              <Panel title="Per Workload" count={rows.length}>
                {rows.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>No costs in this range.</div>
                ) : rows.map((b) => (
                  <BarRow
                    key={b.bucket}
                    label={b.bucket}
                    value={b.cost_usd}
                    max={max}
                    formatted={fmtUSD(b.cost_usd)}
                    sub={`${b.count} calls`}
                  />
                ))}
              </Panel>
            </div>
          </div>
        );
      }}
    />
  );
}
