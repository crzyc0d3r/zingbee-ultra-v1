"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Subject color palette matching the original
const SUBJ_COLORS: Record<string, string> = {
  Biology: "#22c55e",
  Chemistry: "#f59e0b",
  English: "#3b82f6",
  Math: "#ef4444",
  Physics: "#a855f7",
};

function getSubjColor(name: string): string {
  return SUBJ_COLORS[name] || "#64748b";
}

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Types for dashboard data ---
interface DashCounts {
  students: number;
  students_with_mastery: number;
  curriculum_facts: number;
  facts_mastered: number;
  subjects: number;
  sessions: number;
  completed_capsules: number;
}

interface StudentProgress {
  name: string;
  student_id: string;
  total: number;
  mastered: number;
  taught: number;
}

interface CapsuleCompletion {
  student: string;
  student_id: string;
  subject: string;
  completed: number;
}

interface FeedbackData {
  label: string;
  value: number;
}

interface CurriculumNode {
  name: string;
  id?: string;
  value?: number;
  children?: CurriculumNode[];
}

interface DashboardStats {
  counts: DashCounts;
  student_progress: StudentProgress[];
  capsule_completion: CapsuleCompletion[];
  feedback: FeedbackData[];
  curriculum_tree: CurriculumNode;
}

interface DashboardViewProps {
  stats: DashboardStats | null;
  loading: boolean;
  onDrill: (table: string, filterCol: string | null, filterVal: string | null, label: string | null) => void;
}

// --- Dashboard Cards ---
function DashCards({
  counts,
  onDrill,
}: {
  counts: DashCounts;
  onDrill: DashboardViewProps["onDrill"];
}) {
  const defs = [
    {
      label: "Students",
      value: counts.students,
      sub: counts.students_with_mastery + " with mastery",
      table: "students",
    },
    {
      label: "Curriculum Facts",
      value: counts.curriculum_facts.toLocaleString(),
      sub: counts.facts_mastered + " mastered across all students",
      table: "curriculum_facts",
    },
    { label: "Subjects", value: counts.subjects, sub: "", table: "subjects" },
    { label: "Sessions", value: counts.sessions, sub: "", table: "learning_sessions" },
    {
      label: "Capsules Completed",
      value: counts.completed_capsules,
      sub: "by all students",
      table: "students",
      key: "completed_capsules",
    },
    {
      label: "Facts Mastered",
      value: counts.facts_mastered,
      sub: "across all students",
      table: "students",
      key: "facts_mastered",
    },
  ];

  return (
    <div className="dash-cards">
      {defs.map((d) => (
        <div
          key={d.key || d.table}
          className="dash-card"
          style={{ cursor: "pointer" }}
          onClick={() => onDrill(d.table, null, null, null)}
        >
          <div className="label">{d.label}</div>
          <div className="value">{d.value}</div>
          {d.sub && <div className="sub">{d.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// --- Progress Bar Chart (D3) ---
function ProgressChart({
  data,
  onDrill,
}: {
  data: StudentProgress[];
  onDrill: DashboardViewProps["onDrill"];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const draw = async () => {
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = "";

      if (!data.length) {
        container.innerHTML =
          '<div class="empty" style="height:100%"><div>No progress data</div></div>';
        return;
      }

      const d3 = await import("d3");
      if (cancelled) return;

      const margin = { top: 20, right: 20, bottom: 30, left: 110 };
      const width = (container.clientWidth || 400) - margin.left - margin.right;
      const height = Math.max(data.length * 45, 120);

      container.innerHTML = "";
      const svg = d3
        .select(container)
        .append("svg")
        .attr(
          "viewBox",
          `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`
        );
      const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const maxVal = d3.max(data, (d: StudentProgress) => d.total) || 1;
      const x = d3.scaleLinear().domain([0, maxVal]).range([0, width]);
      const y = d3
        .scaleBand()
        .domain(data.map((d: StudentProgress) => d.name))
        .range([0, height])
        .padding(0.25);

      const rowGroups = g
        .selectAll(".student-row")
        .data(data)
        .join("g")
        .attr("class", "student-row")
        .style("cursor", "pointer")
        .on("click", (_ev: any, d: StudentProgress) => {
          onDrill("students", "student_id", d.student_id, d.name);
        });

      rowGroups
        .append("rect")
        .attr("x", 0)
        .attr("y", (d: StudentProgress) => y(d.name)!)
        .attr("width", (d: StudentProgress) => x(d.total))
        .attr("height", y.bandwidth())
        .attr("fill", "#1e293b")
        .attr("rx", 4);

      rowGroups
        .append("rect")
        .attr("x", 0)
        .attr("y", (d: StudentProgress) => y(d.name)!)
        .attr("width", (d: StudentProgress) => x(d.mastered))
        .attr("height", y.bandwidth())
        .attr("fill", "#22c55e")
        .attr("rx", 4)
        .attr("opacity", 0.9);

      rowGroups
        .append("rect")
        .attr("x", (d: StudentProgress) => x(d.mastered))
        .attr("y", (d: StudentProgress) => y(d.name)!)
        .attr("width", (d: StudentProgress) =>
          x(Math.max(0, d.taught - d.mastered))
        )
        .attr("height", y.bandwidth())
        .attr("fill", "#3b82f6")
        .attr("rx", 0)
        .attr("opacity", 0.7);

      g.selectAll(".bar-label")
        .data(data)
        .join("text")
        .attr("x", (d: StudentProgress) => x(d.total) + 6)
        .attr(
          "y",
          (d: StudentProgress) => y(d.name)! + y.bandwidth() / 2
        )
        .attr("dy", "0.35em")
        .style("fill", "#94a3b8")
        .style("font-size", "10px")
        .text((d: StudentProgress) => d.mastered + "/" + d.total);

      const yAxisP = g
        .append("g")
        .call(d3.axisLeft(y).tickSize(0).tickPadding(8));
      yAxisP.selectAll("text").style("fill", "#e2e8f0").style("font-size", "11px");
      yAxisP.select(".domain").style("stroke", "none");

      const legend = document.createElement("div");
      legend.style.cssText = "text-align:center;margin-top:8px;";
      legend.innerHTML =
        '<span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>Mastered</span>' +
        '<span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span>Taught</span>' +
        '<span class="legend-item"><span class="legend-dot" style="background:#1e293b"></span>Total touched</span>';
      container.appendChild(legend);
    };

    draw();
    return () => { cancelled = true; };
  }, [data, onDrill]);

  return <div className="chart-area" ref={containerRef} />;
}

// --- Capsule Completion Chart (D3) ---
function CapsuleChart({
  data,
  onDrill,
}: {
  data: CapsuleCompletion[];
  onDrill: DashboardViewProps["onDrill"];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const draw = async () => {
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = "";

      if (!data.length) {
        container.innerHTML =
          '<div class="empty" style="height:100%"><div>No completion data</div></div>';
        return;
      }

      const d3 = await import("d3");
      if (cancelled) return;

      const margin = { top: 20, right: 20, bottom: 50, left: 50 };
      const width = (container.clientWidth || 400) - margin.left - margin.right;

      const students: string[] = [];
      const studentMap: Record<string, Record<string, number>> = {};
      const allSubjects = new Set<string>();
      const studentIdMap: Record<string, string> = {};

      data.forEach((d) => {
        allSubjects.add(d.subject);
        studentIdMap[d.student] = d.student_id;
        if (!studentMap[d.student]) {
          studentMap[d.student] = {};
          students.push(d.student);
        }
        studentMap[d.student][d.subject] = d.completed;
      });
      const subjects = Array.from(allSubjects);
      const height = Math.max(students.length * 45, 120);

      container.innerHTML = "";
      const svg = d3
        .select(container)
        .append("svg")
        .attr(
          "viewBox",
          `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`
        );
      const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const maxVal =
        d3.max(students, (s: string) =>
          d3.sum(subjects, (subj: string) => studentMap[s][subj] || 0)
        ) || 1;

      const x = d3.scaleLinear().domain([0, maxVal]).range([0, width]);
      const y = d3
        .scaleBand()
        .domain(students)
        .range([0, height])
        .padding(0.25);

      students.forEach((student) => {
        const rowG = g
          .append("g")
          .style("cursor", "pointer")
          .on("click", () => {
            const sid = studentIdMap[student];
            if (sid) onDrill("students", "student_id", sid, student);
          });
        let cumX = 0;
        subjects.forEach((subj) => {
          const val = studentMap[student][subj] || 0;
          if (val > 0) {
            rowG
              .append("rect")
              .attr("x", x(cumX))
              .attr("y", y(student)!)
              .attr("width", x(val))
              .attr("height", y.bandwidth())
              .attr("fill", getSubjColor(subj))
              .attr("opacity", 0.85)
              .attr("rx", cumX === 0 ? 4 : 0)
              .append("title")
              .text(subj + ": " + val);
            cumX += val;
          }
        });
        rowG
          .append("text")
          .attr("x", x(cumX) + 6)
          .attr("y", y(student)! + y.bandwidth() / 2)
          .attr("dy", "0.35em")
          .style("fill", "#94a3b8")
          .style("font-size", "10px")
          .text(cumX);
      });

      const yAxis = g
        .append("g")
        .call(d3.axisLeft(y).tickSize(0).tickPadding(8));
      yAxis.selectAll("text").style("fill", "#e2e8f0").style("font-size", "11px");
      yAxis.select(".domain").style("stroke", "none");

      const xAxis = g
        .append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(5).tickSize(-height));
      xAxis.selectAll("text").style("fill", "#94a3b8").style("font-size", "10px");
      xAxis.selectAll(".tick line").style("stroke", "#1e293b");
      xAxis.select(".domain").style("stroke", "none");

      const legend = document.createElement("div");
      legend.style.cssText = "text-align:center;margin-top:8px;";
      subjects.forEach((s) => {
        legend.innerHTML +=
          '<span class="legend-item"><span class="legend-dot" style="background:' +
          getSubjColor(s) +
          '"></span>' +
          esc(s) +
          "</span>";
      });
      container.appendChild(legend);
    };

    draw();
    return () => { cancelled = true; };
  }, [data, onDrill]);

  return <div className="chart-area" ref={containerRef} />;
}

// --- Feedback Donut Chart (D3) ---
function FeedbackDonut({
  data,
  onDrill,
}: {
  data: FeedbackData[];
  onDrill: DashboardViewProps["onDrill"];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const draw = async () => {
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = "";

      if (!data.length) {
        container.innerHTML =
          '<div class="empty" style="height:100%"><div>No feedback data</div></div>';
        return;
      }

      const d3 = await import("d3");
      if (cancelled) return;

      const width = container.clientWidth || 300;
      const height = Math.max(container.clientHeight || 280, 240);
      const radius = Math.min(width, height) / 2 - 20;

      const sentimentColors: Record<string, string> = {
        positive: "#22c55e",
        negative: "#ef4444",
        question: "#f59e0b",
        neutral: "#64748b",
      };

      container.innerHTML = "";
      const svg = d3
        .select(container)
        .append("svg")
        .attr("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`);

      const pie = d3
        .pie()
        .value((d: any) => d.value)
        .sort(null)
        .padAngle(0.03);
      const arcGen = d3
        .arc()
        .innerRadius(radius * 0.55)
        .outerRadius(radius);

      const arcs = svg
        .selectAll("g.arc")
        .data(pie(data))
        .join("g")
        .attr("class", "arc");

      arcs
        .append("path")
        .attr("d", arcGen)
        .attr("fill", (d: any) => sentimentColors[d.data.label] || "#64748b")
        .attr("opacity", 0.9)
        .style("cursor", "pointer")
        .on("mouseover", function () {
          d3.select(this).attr("opacity", 1);
        })
        .on("mouseout", function () {
          d3.select(this).attr("opacity", 0.9);
        })
        .on("click", () => {
          onDrill("learning_session_feedback", null, null, null);
        });

      const labelArc = d3
        .arc()
        .innerRadius(radius * 0.78)
        .outerRadius(radius * 0.78);
      arcs
        .append("text")
        .attr("transform", (d: any) => `translate(${labelArc.centroid(d)})`)
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .style("fill", "#fff")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .text((d: any) => d.data.value);

      const total = d3.sum(data, (d: FeedbackData) => d.value);
      svg
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.2em")
        .style("fill", "#f1f5f9")
        .style("font-size", "22px")
        .style("font-weight", "700")
        .text(total);
      svg
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "1.2em")
        .style("fill", "#64748b")
        .style("font-size", "10px")
        .text("feedback");

      const legend = document.createElement("div");
      legend.style.cssText = "text-align:center;margin-top:8px;";
      data.forEach((d) => {
        const color = sentimentColors[d.label] || "#64748b";
        legend.innerHTML +=
          '<span class="legend-item"><span class="legend-dot" style="background:' +
          color +
          '"></span>' +
          esc(d.label) +
          " (" +
          d.value +
          ")</span>";
      });
      container.appendChild(legend);
    };

    draw();
    return () => { cancelled = true; };
  }, [data, onDrill]);

  return <div className="chart-area" ref={containerRef} />;
}

// --- Sunburst Chart (D3) ---
function SunburstChart({
  data,
  onDrill,
}: {
  data: CurriculumNode;
  onDrill: DashboardViewProps["onDrill"];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const draw = async () => {
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = "";

      const d3 = await import("d3");
      if (cancelled) return;

      const width = container.clientWidth || 400;
      const height = Math.min(Math.max(container.clientHeight || 300, 300), width);
      const radius = Math.min(width, height) / 2;

      container.innerHTML = "";
      const tip = document.createElement("div");
      tip.className = "sunburst-tip";
      container.appendChild(tip);

      const svg = d3
        .select(container)
        .append("svg")
        .attr("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`)
        .style("font", "10px sans-serif");

      const root = d3
        .hierarchy(data)
        .sum((d: any) => d.value || 0)
        .sort((a: any, b: any) => b.value - a.value);

      const partition = d3.partition().size([2 * Math.PI, radius]);
      partition(root);

      const arc = d3
        .arc()
        .startAngle((d: any) => d.x0)
        .endAngle((d: any) => d.x1)
        .padAngle((d: any) => Math.min((d.x1 - d.x0) / 2, 0.005))
        .padRadius(radius / 2)
        .innerRadius((d: any) => d.y0)
        .outerRadius((d: any) => d.y1 - 1);

      function getColor(d: any): string {
        if (d.depth === 0) return "#334155";
        let ancestor = d;
        while (ancestor.depth > 1) ancestor = ancestor.parent;
        const base = getSubjColor(ancestor.data.name);
        const hsl = d3.hsl(base);
        hsl.l = Math.min(0.7, hsl.l + d.depth * 0.08);
        hsl.s = Math.max(0.3, hsl.s - d.depth * 0.05);
        return hsl.toString();
      }

      svg
        .selectAll("path")
        .data(
          root.descendants().filter((d: any) => d.depth > 0)
        )
        .join("path")
        .attr("fill", getColor)
        .attr("d", arc)
        .style("cursor", "pointer")
        .style("opacity", 0.85)
        .on("mouseover", function (ev: any, d: any) {
          d3.select(this).style("opacity", 1);
          const pathArr: string[] = [];
          let node = d;
          while (node.depth > 0) {
            pathArr.unshift(node.data.name);
            node = node.parent;
          }
          const facts = d.value || 0;
          tip.style.display = "block";
          tip.innerHTML =
            "<strong>" +
            esc(pathArr.join(" > ")) +
            "</strong><br>" +
            facts +
            " facts" +
            '<br><span style="color:#60a5fa;font-size:10px">Click to view</span>';
        })
        .on("mousemove", function (ev: any) {
          const rect = container.getBoundingClientRect();
          tip.style.left = ev.clientX - rect.left + 12 + "px";
          tip.style.top = ev.clientY - rect.top - 10 + "px";
        })
        .on("mouseout", function () {
          d3.select(this).style("opacity", 0.85);
          tip.style.display = "none";
        })
        .on("click", function (ev: any, d: any) {
          tip.style.display = "none";
          const dd = d.data;
          if (d.depth === 1 && dd.id) {
            onDrill("subject_curriculum", "subject_id", dd.id, dd.name);
          } else if (d.depth === 2 && dd.id) {
            onDrill("curriculum_themes", "subject_curriculum_id", dd.id, dd.name);
          } else if (d.depth === 3 && dd.id) {
            onDrill("curriculum_capsules", "curriculum_theme_id", dd.id, dd.name);
          }
        });

      svg
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.2em")
        .style("fill", "#94a3b8")
        .style("font-size", "11px")
        .text("Curriculum");
      svg
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "1em")
        .style("fill", "#64748b")
        .style("font-size", "10px")
        .text(root.value + " facts");

      if (data.children) {
        const legend = document.createElement("div");
        legend.style.cssText = "text-align:center;margin-top:8px;";
        data.children.forEach((s) => {
          legend.innerHTML +=
            '<span class="legend-item"><span class="legend-dot" style="background:' +
            getSubjColor(s.name) +
            '"></span>' +
            esc(s.name) +
            "</span>";
        });
        container.appendChild(legend);
      }
    };

    draw();
    return () => { cancelled = true; };
  }, [data, onDrill]);

  return <div className="chart-area" ref={containerRef} />;
}

// --- Export Button ---
function ExportExcelButton() {
  return (
    <button
      className="export-excel-btn"
      onClick={() => { window.location.href = "/api/curriculum-export/excel"; }}
      title="Export full curriculum to Excel"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Export Excel
    </button>
  );
}

// --- Main Dashboard Component ---
export function DashboardView({ stats, loading, onDrill }: DashboardViewProps) {
  if (loading || !stats) {
    return (
      <div className="dashboard" style={{ display: "block" }}>
        <div className="empty" style={{ height: "100%" }}>
          <div>Loading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard" style={{ display: "block" }}>
      <div className="dash-toolbar">
        <ExportExcelButton />
      </div>
      <DashCards counts={stats.counts} onDrill={onDrill} />
      <div className="dash-row">
        <div className="dash-col">
          <div className="dash-panel compact">
            <h3>Student Fact Mastery</h3>
            <ProgressChart data={stats.student_progress} onDrill={onDrill} />
          </div>
          <div className="dash-panel compact">
            <h3>Capsule Completion by Subject</h3>
            <CapsuleChart data={stats.capsule_completion} onDrill={onDrill} />
          </div>
          <div className="dash-panel compact">
            <h3>Session Feedback</h3>
            <FeedbackDonut data={stats.feedback} onDrill={onDrill} />
          </div>
        </div>
        <div className="dash-panel">
          <h3>Curriculum Structure</h3>
          <SunburstChart data={stats.curriculum_tree} onDrill={onDrill} />
        </div>
      </div>
    </div>
  );
}
