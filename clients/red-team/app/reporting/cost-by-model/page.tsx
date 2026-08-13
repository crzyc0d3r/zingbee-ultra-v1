"use client";

import {
  ReportShell, Panel, BarRow, Donut, StackedTimeChart, fmtUSD, SERIES_COLORS,
} from "@/components/reporting/ReportShell";

export default function CostByModelPage() {
  return (
    <ReportShell
      kind="cost"
      title="Cost by Model"
      subtitle="Cost attributed to each underlying model (e.g. grok-4.20-0309-reasoning, grok-imagine-image-pro)."
      render={(data) => {
        const rows = data.cost_by_model;
        const max = rows[0]?.cost_usd || 0;

        // Top N models for the time-series legend; bucket smaller ones as "Other"
        const TOP_N = 6;
        const topModels = rows.slice(0, TOP_N).map((r) => r.model);
        const series = topModels.map((m, i) => ({ key: m, color: SERIES_COLORS[i % SERIES_COLORS.length] }));
        if (rows.length > TOP_N) {
          series.push({ key: "Other", color: "#475569" });
        }
        const days = data.daily.map((d) => {
          const values: Record<string, number> = {};
          let other = 0;
          for (const [m, v] of Object.entries(d.by_model)) {
            if (topModels.includes(m)) values[m] = v;
            else other += v;
          }
          if (other > 0) values["Other"] = other;
          return { date: d.date, values };
        });

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel title="Cost Over Time (stacked by model)">
              <StackedTimeChart days={days} series={series} valueFmt={fmtUSD} />
            </Panel>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
              <Panel title="Share of Cost">
                <Donut
                  data={rows.slice(0, 8).map((r, i) => ({
                    label: r.model, value: r.cost_usd, color: SERIES_COLORS[i % SERIES_COLORS.length],
                  }))}
                  valueFmt={fmtUSD}
                />
              </Panel>
              <Panel title="Per Model" count={rows.length}>
                {rows.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>No costs in this range.</div>
                ) : rows.map((m) => (
                  <BarRow
                    key={m.model}
                    label={m.model}
                    value={m.cost_usd}
                    max={max}
                    formatted={fmtUSD(m.cost_usd)}
                    sub={`${m.count} calls`}
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
