"use client";

// D3 chart drawing functions for eval visualizations.
// These operate on DOM refs and are called inside useEffect hooks.

import * as d3 from "d3";
import { SCORE_COLORS, SCORE_LABELS } from "@/lib/constants";

function formatDuration(secs: number): string {
  if (secs < 60) return Math.round(secs) + "s";
  if (secs < 3600) return Math.round(secs / 60) + "m";
  return (secs / 3600).toFixed(1) + "h";
}

// ---- Score Radar ----
export function drawScoreRadar(
  el: HTMLElement,
  scores: Record<string, number | null>
) {
  const keys = Object.keys(scores).filter((k) => scores[k] != null);
  if (keys.length < 3) {
    el.innerHTML =
      '<div style="color:#475569;font-size:11px;text-align:center;padding:40px">Not enough scores for radar</div>';
    return;
  }
  const W = 280,
    H = 280,
    cx = W / 2,
    cy = H / 2,
    R = 100;
  const svg = d3
    .select(el)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const n = keys.length,
    angleSlice = (2 * Math.PI) / n;

  // Grid circles
  [0.25, 0.5, 0.75, 1.0].forEach((lv) => {
    svg
      .append("circle")
      .attr("cx", cx)
      .attr("cy", cy)
      .attr("r", R * lv)
      .attr("fill", "none")
      .attr("stroke", "#334155")
      .attr("stroke-dasharray", lv < 1 ? "2,3" : "none")
      .attr("stroke-width", lv === 1 ? 1.5 : 0.8);
    if (lv < 1)
      svg
        .append("text")
        .attr("x", cx + 4)
        .attr("y", cy - R * lv + 3)
        .text(Math.round(lv * 100) + "%")
        .attr("fill", "#475569")
        .attr("font-size", "8px");
  });

  // Axis lines and labels
  keys.forEach((k, i) => {
    const a = angleSlice * i - Math.PI / 2;
    const lx = cx + Math.cos(a) * R,
      ly = cy + Math.sin(a) * R;
    svg
      .append("line")
      .attr("x1", cx)
      .attr("y1", cy)
      .attr("x2", lx)
      .attr("y2", ly)
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1);
    const tx = cx + Math.cos(a) * (R + 18),
      ty = cy + Math.sin(a) * (R + 18);
    svg
      .append("text")
      .attr("x", tx)
      .attr("y", ty)
      .text(SCORE_LABELS[k] || k)
      .attr("fill", "#94a3b8")
      .attr("font-size", "9px")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle");
  });

  // Data polygon
  const pts = keys
    .map((k, i) => {
      const a = angleSlice * i - Math.PI / 2;
      const v = (scores[k] as number) || 0;
      return `${cx + Math.cos(a) * R * v},${cy + Math.sin(a) * R * v}`;
    })
    .join(" ");
  svg
    .append("polygon")
    .attr("points", pts)
    .attr("fill", "rgba(129,140,248,0.12)")
    .attr("stroke", "#818cf8")
    .attr("stroke-width", 2);

  // Data dots with values
  keys.forEach((k, i) => {
    const a = angleSlice * i - Math.PI / 2;
    const v = (scores[k] as number) || 0;
    const dx = cx + Math.cos(a) * R * v,
      dy = cy + Math.sin(a) * R * v;
    svg
      .append("circle")
      .attr("cx", dx)
      .attr("cy", dy)
      .attr("r", 4)
      .attr("fill", SCORE_COLORS[k] || "#818cf8")
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 1.5);
    svg
      .append("text")
      .attr("x", dx)
      .attr("y", dy - 10)
      .text(Math.round(v * 100) + "%")
      .attr("fill", SCORE_COLORS[k] || "#e2e8f0")
      .attr("font-size", "9px")
      .attr("font-weight", "700")
      .attr("text-anchor", "middle");
  });
}

// ---- Capsule Durations ----
interface CapsuleDurationData {
  capsuleName: string;
  totalDuration: number;
  subject: string;
}

export function drawCapsuleDurations(
  el: HTMLElement,
  capsules: CapsuleDurationData[]
) {
  if (!capsules.length) {
    el.innerHTML =
      '<div style="color:#475569;font-size:11px;text-align:center;padding:40px">No data</div>';
    return;
  }
  const data = capsules.map((c) => ({
    label:
      c.capsuleName.length > 20
        ? c.capsuleName.substring(0, 18) + ".."
        : c.capsuleName,
    value: c.totalDuration || 0,
    subject: c.subject,
  }));
  const margin = { top: 10, right: 60, bottom: 10, left: 120 },
    W = 500,
    barH = 22,
    gap = 4;
  const H = margin.top + margin.bottom + data.length * (barH + gap);
  const svg = d3
    .select(el)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W + margin.left + margin.right} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const maxVal = d3.max(data, (d) => d.value) || 1;
  const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, W]);

  const subjectColors: Record<string, string> = {};
  const palette = [
    "#818cf8",
    "#2dd4bf",
    "#fb923c",
    "#f472b6",
    "#a78bfa",
    "#38bdf8",
    "#34d399",
  ];
  const subjects: string[] = [];
  data.forEach((d) => {
    if (subjects.indexOf(d.subject) < 0) subjects.push(d.subject);
  });
  subjects.forEach((s, i) => {
    subjectColors[s] = palette[i % palette.length];
  });

  data.forEach((d, i) => {
    const y = i * (barH + gap);
    g.append("text")
      .attr("x", -6)
      .attr("y", y + barH / 2)
      .text(d.label)
      .attr("fill", "#cbd5e1")
      .attr("font-size", "10px")
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle");
    g.append("rect")
      .attr("x", 0)
      .attr("y", y)
      .attr("width", xScale(d.value))
      .attr("height", barH)
      .attr("rx", 6)
      .attr("fill", subjectColors[d.subject] || "#818cf8")
      .attr("opacity", 0.85);
    g.append("text")
      .attr("x", xScale(d.value) + 6)
      .attr("y", y + barH / 2)
      .text(formatDuration(d.value))
      .attr("fill", "#94a3b8")
      .attr("font-size", "10px")
      .attr("dominant-baseline", "middle");
  });

  // Legend
  const legend = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${H - 2})`);
  subjects.forEach((s, i) => {
    const lx = i * 90;
    legend
      .append("rect")
      .attr("x", lx)
      .attr("y", 0)
      .attr("width", 10)
      .attr("height", 10)
      .attr("rx", 2)
      .attr("fill", subjectColors[s]);
    legend
      .append("text")
      .attr("x", lx + 14)
      .attr("y", 9)
      .text(s)
      .attr("fill", "#94a3b8")
      .attr("font-size", "9px");
  });
}

// ---- Score Comparison ----
interface ScoreCompData {
  capsuleName: string;
  scores: Record<string, number | null>;
}

export function drawScoreComparison(
  el: HTMLElement,
  capsules: ScoreCompData[],
  scoreKeys: string[]
) {
  if (!capsules.length) {
    el.innerHTML =
      '<div style="color:#475569;font-size:11px;text-align:center;padding:40px">No data</div>';
    return;
  }
  const margin = { top: 20, right: 20, bottom: 80, left: 40 },
    W = 500,
    H = 260;
  const iW = W - margin.left - margin.right,
    iH = H - margin.top - margin.bottom;
  const svg = d3
    .select(el)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const labels = capsules.map((c) =>
    c.capsuleName.length > 12
      ? c.capsuleName.substring(0, 10) + ".."
      : c.capsuleName
  );
  const x0 = d3.scaleBand().domain(labels).range([0, iW]).padding(0.2);
  const x1 = d3
    .scaleBand()
    .domain(scoreKeys)
    .range([0, x0.bandwidth()])
    .padding(0.05);
  const y = d3.scaleLinear().domain([0, 1]).range([iH, 0]);

  // Y axis
  [0, 0.25, 0.5, 0.75, 1.0].forEach((v) => {
    g.append("line")
      .attr("x1", 0)
      .attr("y1", y(v))
      .attr("x2", iW)
      .attr("y2", y(v))
      .attr("stroke", "#1e293b")
      .attr("stroke-dasharray", v > 0 ? "2,3" : "none");
    g.append("text")
      .attr("x", -6)
      .attr("y", y(v) + 3)
      .text(Math.round(v * 100) + "%")
      .attr("fill", "#475569")
      .attr("font-size", "8px")
      .attr("text-anchor", "end");
  });

  // Bars
  capsules.forEach((c, ci) => {
    const lbl = labels[ci];
    scoreKeys.forEach((k) => {
      const v = c.scores && c.scores[k] != null ? (c.scores[k] as number) : 0;
      g.append("rect")
        .attr("x", (x0(lbl) || 0) + (x1(k) || 0))
        .attr("y", y(v))
        .attr("width", x1.bandwidth())
        .attr("height", iH - y(v))
        .attr("rx", 3)
        .attr("fill", SCORE_COLORS[k] || "#818cf8")
        .attr("opacity", 0.9);
    });
    // X label
    g.append("text")
      .attr("x", (x0(lbl) || 0) + x0.bandwidth() / 2)
      .attr("y", iH + 12)
      .text(lbl)
      .attr("fill", "#94a3b8")
      .attr("font-size", "8px")
      .attr("text-anchor", "middle")
      .attr(
        "transform",
        `rotate(-35,${(x0(lbl) || 0) + x0.bandwidth() / 2},${iH + 12})`
      );
  });

  // Legend
  const legend = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${H - 14})`);
  scoreKeys.forEach((k, i) => {
    const lx = i * 80;
    legend
      .append("rect")
      .attr("x", lx)
      .attr("y", 0)
      .attr("width", 10)
      .attr("height", 10)
      .attr("rx", 2)
      .attr("fill", SCORE_COLORS[k]);
    legend
      .append("text")
      .attr("x", lx + 14)
      .attr("y", 9)
      .text(SCORE_LABELS[k] || k)
      .attr("fill", "#94a3b8")
      .attr("font-size", "8px");
  });
}

// ---- Fact Donut ----
export function drawFactDonut(
  el: HTMLElement,
  taught: number,
  mastered: number,
  assessed: number
) {
  const total = taught + mastered + assessed;
  if (total === 0) {
    el.innerHTML =
      '<div style="color:#475569;font-size:11px;text-align:center;padding:40px">No facts data</div>';
    return;
  }
  const W = 220,
    H = 220,
    R = 80,
    r = 50;
  const svg = d3
    .select(el)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g").attr("transform", `translate(${W / 2},${H / 2})`);

  const data = [
    { label: "Taught", value: taught, color: "#818cf8" },
    { label: "Mastered", value: mastered, color: "#2dd4bf" },
    { label: "Assessed", value: assessed, color: "#fbbf24" },
  ];
  const pieGen = d3
    .pie<{ label: string; value: number; color: string }>()
    .value((d) => d.value)
    .sort(null);
  const arcGen = d3.arc<d3.PieArcDatum<{ label: string; value: number; color: string }>>().innerRadius(r).outerRadius(R);

  g.selectAll("path")
    .data(pieGen(data))
    .enter()
    .append("path")
    .attr("d", arcGen)
    .attr("fill", (d) => d.data.color)
    .attr("stroke", "#16213e")
    .attr("stroke-width", 2);

  // Center text
  g.append("text")
    .attr("y", -4)
    .text(String(total))
    .attr("fill", "#f1f5f9")
    .attr("font-size", "22px")
    .attr("font-weight", "700")
    .attr("text-anchor", "middle");
  g.append("text")
    .attr("y", 12)
    .text("facts")
    .attr("fill", "#64748b")
    .attr("font-size", "10px")
    .attr("text-anchor", "middle");

  // Legend below
  const leg = svg
    .append("g")
    .attr("transform", `translate(${W / 2 - 60},${H - 8})`);
  data.forEach((d, i) => {
    const lx = i * 45;
    leg
      .append("rect")
      .attr("x", lx)
      .attr("y", 0)
      .attr("width", 8)
      .attr("height", 8)
      .attr("rx", 2)
      .attr("fill", d.color);
    leg
      .append("text")
      .attr("x", lx + 11)
      .attr("y", 8)
      .text(d.value + " " + d.label)
      .attr("fill", "#94a3b8")
      .attr("font-size", "7px");
  });
}

// ---- Conversation Timeline ----
interface ConvMessage {
  role: string;
  content?: string;
  turn?: number;
  step?: string;
}

export function drawConvTimeline(el: HTMLElement, conversation: ConvMessage[]) {
  if (!conversation || !conversation.length) {
    el.innerHTML =
      '<div style="color:#475569;font-size:11px;text-align:center;padding:40px">No conversation data</div>';
    return;
  }
  const margin = { top: 10, right: 20, bottom: 30, left: 40 },
    W = 600,
    H = 180;
  const iW = W - margin.left - margin.right,
    iH = H - margin.top - margin.bottom;
  const svg = d3
    .select(el)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const data = conversation.map((m, i) => ({
    idx: i,
    role: m.role,
    len: m.content ? m.content.length : 0,
    turn: m.turn || 0,
    step: m.step || "",
  }));
  const maxLen = d3.max(data, (d) => d.len) || 1;
  const x = d3
    .scaleBand()
    .domain(data.map((d) => String(d.idx)))
    .range([0, iW])
    .padding(0.15);
  const y = d3.scaleLinear().domain([0, maxLen]).range([iH, 0]);

  // Grid lines
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    const val = Math.round(maxLen * v);
    g.append("line")
      .attr("x1", 0)
      .attr("y1", y(val))
      .attr("x2", iW)
      .attr("y2", y(val))
      .attr("stroke", "#1e293b");
    g.append("text")
      .attr("x", -6)
      .attr("y", y(val) + 3)
      .text(String(val))
      .attr("fill", "#475569")
      .attr("font-size", "8px")
      .attr("text-anchor", "end");
  });

  // Bars
  data.forEach((d) => {
    g.append("rect")
      .attr("x", x(String(d.idx)) || 0)
      .attr("y", y(d.len))
      .attr("width", x.bandwidth())
      .attr("height", iH - y(d.len))
      .attr("rx", 3)
      .attr("fill", d.role === "assistant" ? "#818cf8" : "#2dd4bf")
      .attr("opacity", 0.85);
  });

  // Axis labels
  g.append("text")
    .attr("x", iW / 2)
    .attr("y", iH + 22)
    .text("Message #")
    .attr("fill", "#64748b")
    .attr("font-size", "9px")
    .attr("text-anchor", "middle");
  g.append("text")
    .attr("x", -26)
    .attr("y", iH / 2)
    .text("Chars")
    .attr("fill", "#64748b")
    .attr("font-size", "9px")
    .attr("text-anchor", "middle")
    .attr("transform", `rotate(-90,-26,${iH / 2})`);

  // Legend
  const leg = svg
    .append("g")
    .attr(
      "transform",
      `translate(${margin.left + iW / 2 - 50},${H - 6})`
    );
  leg
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", 8)
    .attr("height", 8)
    .attr("rx", 2)
    .attr("fill", "#818cf8");
  leg
    .append("text")
    .attr("x", 12)
    .attr("y", 8)
    .text("Assistant")
    .attr("fill", "#94a3b8")
    .attr("font-size", "9px");
  leg
    .append("rect")
    .attr("x", 65)
    .attr("y", 0)
    .attr("width", 8)
    .attr("height", 8)
    .attr("rx", 2)
    .attr("fill", "#2dd4bf");
  leg
    .append("text")
    .attr("x", 77)
    .attr("y", 8)
    .text("Student")
    .attr("fill", "#94a3b8")
    .attr("font-size", "9px");
}

// ---- Score Distribution Histogram ----
export function drawScoreDistribution(
  el: HTMLElement,
  capsules: ScoreCompData[],
  scoreKey: string
) {
  const vals = capsules
    .map((c) =>
      c.scores && c.scores[scoreKey] != null ? (c.scores[scoreKey] as number) : null
    )
    .filter((v): v is number => v !== null);
  if (!vals.length) {
    el.innerHTML =
      '<div style="color:#475569;font-size:11px;text-align:center;padding:40px">No data</div>';
    return;
  }
  const buckets = [
    { label: "0-20%", lo: 0, hi: 0.2, count: 0 },
    { label: "20-40%", lo: 0.2, hi: 0.4, count: 0 },
    { label: "40-60%", lo: 0.4, hi: 0.6, count: 0 },
    { label: "60-80%", lo: 0.6, hi: 0.8, count: 0 },
    { label: "80-100%", lo: 0.8, hi: 1.01, count: 0 },
  ];
  vals.forEach((v) => {
    buckets.forEach((b) => {
      if (v >= b.lo && v < b.hi) b.count++;
    });
  });

  const margin = { top: 10, right: 10, bottom: 25, left: 30 },
    W = 250,
    H = 140;
  const iW = W - margin.left - margin.right,
    iH = H - margin.top - margin.bottom;
  const svg = d3
    .select(el)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const maxC = d3.max(buckets, (b) => b.count) || 1;
  const x = d3
    .scaleBand()
    .domain(buckets.map((b) => b.label))
    .range([0, iW])
    .padding(0.2);
  const y = d3.scaleLinear().domain([0, maxC]).range([iH, 0]);
  const bucketColors = ["#f472b6", "#fb923c", "#fbbf24", "#a3e635", "#2dd4bf"];

  buckets.forEach((b, i) => {
    g.append("rect")
      .attr("x", x(b.label) || 0)
      .attr("y", y(b.count))
      .attr("width", x.bandwidth())
      .attr("height", iH - y(b.count))
      .attr("rx", 3)
      .attr("fill", bucketColors[i])
      .attr("opacity", 0.8);
    if (b.count > 0)
      g.append("text")
        .attr("x", (x(b.label) || 0) + x.bandwidth() / 2)
        .attr("y", y(b.count) - 4)
        .text(String(b.count))
        .attr("fill", "#e2e8f0")
        .attr("font-size", "9px")
        .attr("text-anchor", "middle")
        .attr("font-weight", "600");
    g.append("text")
      .attr("x", (x(b.label) || 0) + x.bandwidth() / 2)
      .attr("y", iH + 12)
      .text(b.label)
      .attr("fill", "#64748b")
      .attr("font-size", "7px")
      .attr("text-anchor", "middle");
  });
}
