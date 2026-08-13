"use client";

import { useEffect, useRef } from "react";
import type { DashboardSummary } from "@/lib/images/types";
import type { ImageVariant } from "@/lib/images/types";
import { JUDGE_CONTROLS } from "@/lib/images/constants";

// --- Decision Donut (SHIP / REVIEW / REGENERATE) ---
function DecisionDonut({ summary }: { summary: DashboardSummary }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      const el = ref.current;
      if (!el) return;
      el.innerHTML = "";
      const d3 = await import("d3");
      if (cancelled) return;

      const slices = [
        { label: "SHIP", value: summary.ship, color: "#22c55e" },
        { label: "REVIEW", value: summary.review, color: "#f59e0b" },
        { label: "REGENERATE", value: summary.regenerate, color: "#ef4444" },
        { label: "Unevaluated", value: Math.max(0, summary.total - summary.ship - summary.review - summary.regenerate), color: "#475569" },
      ].filter((s) => s.value > 0);

      if (!slices.length) {
        el.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px">No data</div>';
        return;
      }

      const size = 180;
      const radius = size / 2 - 10;
      const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${size} ${size}`);
      const g = svg.append("g").attr("transform", `translate(${size / 2},${size / 2})`);

      const pie = d3.pie<(typeof slices)[0]>().value((d) => d.value).sort(null);
      const arc = d3.arc<d3.PieArcDatum<(typeof slices)[0]>>().innerRadius(radius * 0.55).outerRadius(radius);

      g.selectAll("path")
        .data(pie(slices))
        .join("path")
        .attr("d", arc as any)
        .attr("fill", (d) => d.data.color)
        .attr("stroke", "#1a1a2e")
        .attr("stroke-width", 2);

      // Center text
      g.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.2em")
        .attr("fill", "#e2e8f0")
        .attr("font-size", "22px")
        .attr("font-weight", "700")
        .text(String(summary.total));
      g.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "1.2em")
        .attr("fill", "#94a3b8")
        .attr("font-size", "10px")
        .text("total");

      // Legend
      const legend = d3.select(el).append("div").style("display", "flex").style("gap", "10px").style("justify-content", "center").style("margin-top", "6px");
      for (const s of slices) {
        const item = legend.append("span").style("font-size", "10px").style("color", "#94a3b8").style("display", "flex").style("align-items", "center").style("gap", "3px");
        item.append("span").style("width", "8px").style("height", "8px").style("border-radius", "50%").style("background", s.color).style("display", "inline-block");
        item.append("span").text(`${s.label}: ${s.value}`);
      }
    };
    draw();
    return () => { cancelled = true; };
  }, [summary]);

  return <div ref={ref} />;
}

// --- Per-Judge Bar Chart ---
function JudgeScoreChart({ variants }: { variants: ImageVariant[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      const el = ref.current;
      if (!el) return;
      el.innerHTML = "";
      const d3 = await import("d3");
      if (cancelled) return;

      const judgeAvgs: { name: string; label: string; avg: number }[] = [];
      for (const { key, label } of JUDGE_CONTROLS) {
        const scores = variants
          .map((v) => v.judges?.[key]?.score)
          .filter((s): s is number => s !== undefined);
        const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        judgeAvgs.push({ name: key, label, avg });
      }

      if (!judgeAvgs.some((j) => j.avg > 0)) {
        el.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px">No judge scores</div>';
        return;
      }

      const margin = { top: 10, right: 40, bottom: 10, left: 140 };
      const barH = 22;
      const height = judgeAvgs.length * barH;
      const width = (el.clientWidth || 300) - margin.left - margin.right;

      const svg = d3.select(el).append("svg")
        .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`);
      const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

      const x = d3.scaleLinear().domain([0, 1]).range([0, width]);
      const y = d3.scaleBand().domain(judgeAvgs.map((j) => j.label)).range([0, height]).padding(0.2);

      // Bars
      g.selectAll("rect")
        .data(judgeAvgs)
        .join("rect")
        .attr("x", 0)
        .attr("y", (d) => y(d.label) || 0)
        .attr("width", (d) => x(d.avg))
        .attr("height", y.bandwidth())
        .attr("rx", 3)
        .attr("fill", (d) => d.avg >= 0.85 ? "#22c55e" : d.avg >= 0.5 ? "#f59e0b" : "#ef4444");

      // Labels
      g.selectAll(".label")
        .data(judgeAvgs)
        .join("text")
        .attr("x", -4)
        .attr("y", (d) => (y(d.label) || 0) + y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .attr("fill", "#94a3b8")
        .attr("font-size", "10px")
        .text((d) => d.label);

      // Score values
      g.selectAll(".val")
        .data(judgeAvgs)
        .join("text")
        .attr("x", (d) => x(d.avg) + 4)
        .attr("y", (d) => (y(d.label) || 0) + y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .attr("fill", "#cbd5e1")
        .attr("font-size", "10px")
        .attr("font-weight", "600")
        .text((d) => d.avg.toFixed(2));
    };
    draw();
    return () => { cancelled = true; };
  }, [variants]);

  return <div ref={ref} />;
}

// --- Human Review Status Breakdown ---
function HumanReviewStats({ summary }: { summary: DashboardSummary }) {
  return (
    <div style={{ display: "grid", gap: "6px", fontSize: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
        <span>Pending Human Review</span>
        <span style={{ color: "#f59e0b", fontWeight: 600 }}>{summary.pendingHuman}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
        <span>Needs Work</span>
        <span style={{ color: "#ef4444", fontWeight: 600 }}>{summary.needsWorkHuman}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
        <span>Approved</span>
        <span style={{ color: "#22c55e", fontWeight: 600 }}>{summary.approvedHuman}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", borderTop: "1px solid #334155", paddingTop: "4px" }}>
        <span>Combo Configurations</span>
        <span style={{ color: "#60a5fa", fontWeight: 600 }}>{Object.keys(summary.byCombo).length}</span>
      </div>
    </div>
  );
}

// --- Exported composite ---
export function ImageDashboardCharts({
  summary,
  variants,
}: {
  summary: DashboardSummary | null;
  variants: ImageVariant[];
}) {
  if (!summary) return null;

  return (
    <div className="images-charts">
      <div className="images-chart-card">
        <h3>Decision Distribution</h3>
        <DecisionDonut summary={summary} />
      </div>
      <div className="images-chart-card">
        <h3>Average Judge Scores</h3>
        <JudgeScoreChart variants={variants} />
      </div>
      <div className="images-chart-card">
        <h3>Human Review Status</h3>
        <HumanReviewStats summary={summary} />
      </div>
    </div>
  );
}
