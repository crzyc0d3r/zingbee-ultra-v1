"use client";

import { useEffect, useRef, useCallback } from "react";
import type { SessionDetail, LearningSessionMessage, ExecStep, InteractionItem } from "@/lib/types";

type SessionDetailExt = SessionDetail;
import {
  fmtDuration,
  accuracyClass,
  extractImages,
  extractLatencies,
  extractAssessments,
  summarizeFacts,
  type LatencyData,
  type AssessmentData,
  type FactSummary,

} from "./helpers";

interface DashboardTabProps {
  session: SessionDetailExt;
  onImageClick: (url: string) => void;
}

// Step colors for the phase timeline
const STEP_COLORS: Record<string, string> = {
  RECALL: "#818cf8",
  TEACH: "#2dd4bf",
  TRY: "#fbbf24",
  CHECK: "#f472b6",
  EVIDENCE: "#c084fc",
  "NEXT STEPS": "#94a3b8",
};

export default function DashboardTab({
  session,
  onImageClick,
}: DashboardTabProps) {
  const latencyRef = useRef<HTMLDivElement>(null);
  const assessmentRef = useRef<HTMLDivElement>(null);
  const factsRef = useRef<HTMLDivElement>(null);
  const tokensRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const accuracyRef = useRef<HTMLDivElement>(null);
  const engagementRef = useRef<HTMLDivElement>(null);
  const factProgressRef = useRef<HTMLDivElement>(null);

  const d = session;
  const images = extractImages(d.execution_log);

  // Calculate session cost breakdown: input tokens, output tokens, images
  // Model rates ($/1M tokens) — read from PRICING_SNAPSHOT if available, else defaults
  const defaultRates: Record<string, {input: number; output: number}> = {
    "grok-4-1-fast-reasoning": {input: 0.20, output: 0.50},
    "grok-4-1-fast-non-reasoning": {input: 0.20, output: 0.50},
    "grok-3": {input: 3.00, output: 15.00},
    "grok-3-mini": {input: 0.30, output: 0.50},
  };
  let modelRates = defaultRates;
  const pricingEntry = (d.execution_log || []).find((e: any) => e.step === "PRICING_SNAPSHOT");
  if (pricingEntry) {
    const pr = typeof pricingEntry.details === "string" ? {} : (pricingEntry.details || {});
    if (pr.model_rates) modelRates = { ...defaultRates, ...pr.model_rates };
  }

  const costBreakdown = { input: 0, output: 0, images: 0, tts: 0, stt: 0 };
  (d.execution_log || []).forEach((e: any) => {
    const det = typeof e.details === "string" ? {} : (e.details || {});
    if (e.step === "LLM_RESPONSE" || e.step === "ASSESSMENT_LLM_RESPONSE" || e.step === "CLASSIFIER") {
      const pt = det.prompt_tokens || 0;
      const ct = det.completion_tokens || 0;
      if (pt === 0 && ct === 0) return; // e.g. skip-rule classifier runs
      const model = det.model || "grok-4-1-fast-reasoning";
      const rate = modelRates[model] || {input: 0.20, output: 0.50};
      costBreakdown.input += (pt * rate.input) / 1_000_000;
      costBreakdown.output += (ct * rate.output) / 1_000_000;
    } else if (e.step === "IMAGE_GENERATE_RESULT" && det.success) {
      costBreakdown.images += det.cost_usd || 0.02;
    } else if (e.step === "TTS_REQUEST") {
      costBreakdown.tts += det.cost_usd || 0;
    } else if (e.step === "STT_REQUEST") {
      costBreakdown.stt += det.cost_usd || 0;
    }
  });
  const totalCost = costBreakdown.input + costBreakdown.output + costBreakdown.images + costBreakdown.tts + costBreakdown.stt;
  const costPieRef = useRef<HTMLDivElement>(null);
  const costByAgentRef = useRef<HTMLDivElement>(null);

  // Cost by agent: tutor, assessor, classifier, images, tts, stt
  const agentCosts = { tutor: 0, assessor: 0, classifier: 0, images: 0, tts: 0, stt: 0 };
  (d.execution_log || []).forEach((e: any) => {
    const det = typeof e.details === "string" ? {} : (e.details || {});
    if (e.step === "LLM_RESPONSE") {
      agentCosts.tutor += det.cost_usd || 0;
    } else if (e.step === "ASSESSMENT_LLM_RESPONSE") {
      agentCosts.assessor += det.cost_usd || 0;
    } else if (e.step === "CLASSIFIER") {
      agentCosts.classifier += det.cost_usd || 0;
    } else if (e.step === "IMAGE_GENERATE_RESULT" && det.success) {
      agentCosts.images += det.cost_usd || 0;
    } else if (e.step === "TTS_REQUEST") {
      agentCosts.tts += det.cost_usd || 0;
    } else if (e.step === "STT_REQUEST") {
      agentCosts.stt += det.cost_usd || 0;
    }
  });

  // D3 chart rendering
  const drawCharts = useCallback(async () => {
    const d3 = await import("d3");
    if (latencyRef.current)
      drawLatencyChart(d3, latencyRef.current, d.execution_log);
    if (assessmentRef.current)
      drawAssessmentDonut(d3, assessmentRef.current, d.execution_log);
    if (factsRef.current)
      drawFactDonut(d3, factsRef.current, d.execution_log);
    if (tokensRef.current)
      drawTokenChart(d3, tokensRef.current, d.execution_log);
    if (stepsRef.current)
      drawStepTimeline(d3, stepsRef.current, d.execution_log);
    if (accuracyRef.current)
      drawAccuracyOverTime(d3, accuracyRef.current, d.execution_log);
    if (engagementRef.current)
      drawEngagementChart(d3, engagementRef.current, d.messages);
    if (factProgressRef.current)
      drawFactProgress(d3, factProgressRef.current, d.execution_log);
    if (costPieRef.current)
      drawCostPie(d3, costPieRef.current, costBreakdown);
    if (costByAgentRef.current)
      drawAgentCostPie(d3, costByAgentRef.current, agentCosts);
  }, [d.messages, d.execution_log, d.interactions, costBreakdown]);

  useEffect(() => {
    const timer = setTimeout(drawCharts, 50);
    return () => clearTimeout(timer);
  }, [drawCharts]);

  return (
    <div>
      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Duration</div>
          <div className="value">{fmtDuration(d.duration_seconds)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Questions</div>
          <div className="value">{d.questions_asked}</div>
        </div>
        <div className="stat-card">
          <div className="label">Correct</div>
          <div className="value">{d.correct_answers}</div>
        </div>
        <div className="stat-card">
          <div className="label">Accuracy</div>
          <div
            className={`value${d.accuracy != null ? " " + accuracyClass(d.accuracy) : ""}`}
          >
            {d.accuracy != null ? d.accuracy.toFixed(0) + "%" : "-"}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Tokens</div>
          <div className="value">
            {(d.total_tokens || 0).toLocaleString()}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Facts Taught</div>
          <div className="value">{d.facts_taught_count ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Cost</div>
          <div className="value">${totalCost > 0 ? totalCost.toFixed(2) : "—"}</div>
        </div>
      </div>

      {/* Chart row 1: Accuracy Over Time + Fact Status */}
      <div className="chart-row">
        <div className="chart-panel">
          <h3>Accuracy Over Time</h3>
          <div ref={accuracyRef} id="chartAccuracy" />
        </div>
        <div className="chart-panel">
          <h3>Fact Status</h3>
          <div
            ref={factsRef}
            id="chartFacts"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          />
        </div>
      </div>

      {/* Chart row: Cost by Type + Cost by Agent */}
      <div className="chart-row">
        <div className="chart-panel">
          <h3>Cost by Type</h3>
          <div
            ref={costPieRef}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          />
        </div>
        <div className="chart-panel">
          <h3>Cost by Agent</h3>
          <div
            ref={costByAgentRef}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          />
        </div>
      </div>

      {/* Chart row 2: Fact Progress + Assessment Results */}
      <div className="chart-row">
        <div className="chart-panel">
          <h3>Fact Mastery Progress</h3>
          <div ref={factProgressRef} id="chartFactProgress" />
        </div>
        <div className="chart-panel">
          <h3>Assessment Results</h3>
          <div
            ref={assessmentRef}
            id="chartAssessment"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          />
        </div>
      </div>

      {/* Chart row 3: LLM Latency + Student Engagement */}
      <div className="chart-row">
        <div className="chart-panel">
          <h3>LLM Latency (ms)</h3>
          <div ref={latencyRef} id="chartLatency" />
        </div>
        <div className="chart-panel">
          <h3>Student Engagement</h3>
          <div ref={engagementRef} id="chartEngagement" />
        </div>
      </div>

      {/* Chart row 4: Cumulative Tokens + Step Timeline */}
      <div className="chart-row">
        <div className="chart-panel">
          <h3>Token Impact Timeline</h3>
          <div ref={tokensRef} id="chartTokens" />
        </div>
        <div className="chart-panel">
          <h3>Step Timeline</h3>
          <div ref={stepsRef} id="chartSteps" />
        </div>
      </div>

      {/* Per-fact charts */}
      <FactCharts execLog={d.execution_log} />

      {/* Image gallery */}
      {images.length > 0 && (
        <div className="chart-panel" style={{ marginBottom: 14 }}>
          <h3>Generated Images ({images.length})</h3>
          <div className="img-gallery">
            {images.map((img, i) => (
              <div
                key={i}
                className="gallery-item"
                onClick={() => onImageClick(img.url)}
              >
                <img src={img.url} alt={img.topic} loading="lazy" />
                <div className="gallery-label">{img.topic}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================
// PER-FACT DETAIL TABLE
// =============================================

interface FactStats {
  fact: string;
  timeMs: number;
  tokens: number;
  tutorTokens: number;
  assessorTokens: number;
  imageTokens: number;
  tutorCost: number;
  assessorCost: number;
  imageCost: number;
  images: number;
  teachTurns: number;
  tryTurns: number;
  checkTurns: number;
  evidenceTurns: number;
  confusionCount: number;
  correctCount: number;
  incorrectCount: number;
  partialCount: number;
  status: string;
}

function extractFactStats(log: ExecStep[] | null | undefined): FactStats[] {
  if (!log || !log.length) return [];

  const facts = new Map<string, FactStats>();
  let currentFact = "";
  let currentFactStart = 0;

  const normTs = (ts: string | undefined): number => {
    if (!ts) return 0;
    let s = ts;
    if (s && !s.endsWith("Z") && !s.includes("+")) s += "Z";
    return new Date(s).getTime() || 0;
  };

  const ensure = (fact: string): FactStats => {
    if (!facts.has(fact)) {
      facts.set(fact, {
        fact, timeMs: 0, tokens: 0, tutorTokens: 0, assessorTokens: 0, imageTokens: 0,
        tutorCost: 0, assessorCost: 0, imageCost: 0,
        images: 0, teachTurns: 0, tryTurns: 0, checkTurns: 0, evidenceTurns: 0,
        confusionCount: 0, correctCount: 0, incorrectCount: 0, partialCount: 0,
        status: "TEACH",
      });
    }
    return facts.get(fact)!;
  };

  log.forEach((entry) => {
    const d = entry.details || {};
    const ts = normTs(entry.timestamp);

    if (entry.step === "V6_TRANSITION" && d.fact) {
      // Close time for previous fact
      if (currentFact && ts > currentFactStart) {
        const prev = ensure(currentFact);
        prev.timeMs += ts - currentFactStart;
      }
      currentFact = d.fact;
      currentFactStart = ts;
      const f = ensure(d.fact);
      const phase = d.to_phase || "";
      if (phase === "TEACH") f.teachTurns++;
      else if (phase === "TRY") f.tryTurns++;
      else if (phase === "CHECK") f.checkTurns++;
      else if (phase === "EVIDENCE") f.evidenceTurns++;
      f.status = phase || f.status;
    }

    // Count tokens and costs per fact by category
    if (entry.step === "LLM_RESPONSE" && currentFact) {
      const f = ensure(currentFact);
      const t = d.tokens_used || 0;
      f.tokens += t;
      f.tutorTokens += t;
      // Use stored cost_usd if available, else estimate
      f.tutorCost += d.cost_usd || (t / 1000 * 0.003);
    }
    if (entry.step === "ASSESSMENT_LLM_RESPONSE" && currentFact) {
      const f = ensure(currentFact);
      const t = d.tokens_used || 0;
      f.tokens += t;
      f.assessorTokens += t;
      f.assessorCost += d.cost_usd || (t / 1000 * 0.001);
    }

    // Count images per fact
    if (entry.step === "IMAGE_GENERATE_RESULT" && d.success && currentFact) {
      const f = ensure(currentFact);
      f.images++;
      f.imageTokens += d.tokens_used || 0;
      f.imageCost += d.cost_usd || 0.04;
    }

    // Count assessment outcomes per fact
    if (entry.step === "ASSESSMENT_LLM_RESPONSE" && currentFact) {
      let resp = d.full_response;
      if (typeof resp === "string") {
        try { resp = JSON.parse(resp); } catch { resp = {}; }
      }
      if (resp) {
        const itype = resp.interaction_type || "";
        const f = ensure(currentFact);
        if (itype === "student_correct" || itype === "student_understands") f.correctCount++;
        else if (itype === "student_incorrect") f.incorrectCount++;
        else if (itype === "student_partially_correct") f.partialCount++;
        if (resp.student_is_confused) f.confusionCount++;
      }
    }
  });

  // Close last fact
  if (currentFact && log.length > 0) {
    const lastTs = normTs(log[log.length - 1].timestamp);
    if (lastTs > currentFactStart) {
      ensure(currentFact).timeMs += lastTs - currentFactStart;
    }
  }

  return Array.from(facts.values());
}

function FactCharts({ execLog }: { execLog: ExecStep[] | null | undefined }) {
  const chartRefs = {
    time: useRef<HTMLDivElement>(null),
    tokens: useRef<HTMLDivElement>(null),
    cost: useRef<HTMLDivElement>(null),
    understanding: useRef<HTMLDivElement>(null),
    confusion: useRef<HTMLDivElement>(null),
    images: useRef<HTMLDivElement>(null),
  };

  const stats = extractFactStats(execLog);

  const draw = useCallback(async () => {
    if (!stats.length) return;
    const d3 = await import("d3");
    const labels = stats.map(f => f.fact.length > 30 ? f.fact.slice(0, 28) + "..." : f.fact);

    const drawHBar = (container: HTMLElement, title: string, values: number[], color: string, fmt: (v: number) => string) => {
      const W = 400, barH = 22, gap = 4;
      const margin = { top: 4, right: 50, bottom: 4, left: 160 };
      const H = margin.top + margin.bottom + stats.length * (barH + gap);
      const iW = W - margin.left - margin.right;
      const maxVal = d3.max(values) || 1;

      const svg = d3.select(container).html("").append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
      const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

      const x = d3.scaleLinear().domain([0, maxVal * 1.1]).range([0, iW]);

      stats.forEach((_, i) => {
        const y = i * (barH + gap);
        // Label
        g.append("text").attr("x", -6).attr("y", y + barH / 2 + 3)
          .attr("text-anchor", "end").attr("fill", "#94a3b8").attr("font-size", "8px")
          .text(labels[i]);
        // Bar
        g.append("rect").attr("x", 0).attr("y", y).attr("width", x(values[i]))
          .attr("height", barH).attr("rx", 3).attr("fill", color).attr("opacity", 0.8);
        // Value
        g.append("text").attr("x", x(values[i]) + 4).attr("y", y + barH / 2 + 3)
          .attr("fill", "#e2e8f0").attr("font-size", "9px").text(fmt(values[i]));
      });
    };

    if (chartRefs.time.current) {
      drawHBar(chartRefs.time.current, "Time per Fact",
        stats.map(f => f.timeMs / 1000), "#818cf8",
        v => v >= 60 ? `${Math.floor(v/60)}m ${Math.round(v%60)}s` : `${Math.round(v)}s`);
    }
    if (chartRefs.tokens.current) {
      drawHBar(chartRefs.tokens.current, "Tokens per Fact",
        stats.map(f => f.tokens), "#2dd4bf",
        v => v.toLocaleString());
    }
    if (chartRefs.understanding.current) {
      // Stacked bar: correct (green) + partial (yellow) + incorrect (red) + confused (orange)
      const container = chartRefs.understanding.current;
      const W = 400, barH = 22, gap = 4;
      const margin = { top: 4, right: 50, bottom: 20, left: 160 };
      const H = margin.top + margin.bottom + stats.length * (barH + gap);
      const iW = W - margin.left - margin.right;
      const maxVal = d3.max(stats, (f: FactStats) => f.correctCount + f.incorrectCount + f.partialCount + f.confusionCount) || 1;

      const svg = d3.select(container).html("").append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
      const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
      const x = d3.scaleLinear().domain([0, maxVal * 1.1]).range([0, iW]);

      stats.forEach((f, i) => {
        const y = i * (barH + gap);
        g.append("text").attr("x", -6).attr("y", y + barH / 2 + 3)
          .attr("text-anchor", "end").attr("fill", "#94a3b8").attr("font-size", "8px")
          .text(labels[i]);
        let offset = 0;
        const segments = [
          { val: f.correctCount, color: "#22c55e" },
          { val: f.partialCount, color: "#f59e0b" },
          { val: f.incorrectCount, color: "#ef4444" },
          { val: f.confusionCount, color: "#f472b6" },
        ];
        segments.forEach(s => {
          if (s.val > 0) {
            g.append("rect").attr("x", x(offset)).attr("y", y).attr("width", x(s.val))
              .attr("height", barH).attr("fill", s.color).attr("opacity", 0.85);
            offset += s.val;
          }
        });
      });

      // Legend
      const leg = g.append("g").attr("transform", `translate(0,${stats.length * (barH + gap) + 4})`);
      [
        { label: "Correct", color: "#22c55e" },
        { label: "Partial", color: "#f59e0b" },
        { label: "Incorrect", color: "#ef4444" },
        { label: "Confused", color: "#f472b6" },
      ].forEach((item, i) => {
        const gx = i * 60;
        leg.append("rect").attr("x", gx).attr("y", 0).attr("width", 8).attr("height", 8).attr("rx", 2).attr("fill", item.color);
        leg.append("text").attr("x", gx + 11).attr("y", 8).text(item.label).attr("fill", "#94a3b8").attr("font-size", "8px");
      });
    }
    if (chartRefs.cost.current) {
      // Stacked bar: tutor cost + assessor cost + image cost (from stored cost_usd)
      const container = chartRefs.cost.current;
      const W = 400, barH = 22, gap = 4;
      const margin = { top: 4, right: 60, bottom: 20, left: 160 };
      const H = margin.top + margin.bottom + stats.length * (barH + gap);
      const iW = W - margin.left - margin.right;

      const costData = stats.map(f => ({
        tutor: f.tutorCost,
        assessor: f.assessorCost,
        image: f.imageCost,
      }));
      const maxCost = d3.max(costData, (c: any) => c.tutor + c.assessor + c.image) || 0.01;

      const svg = d3.select(container).html("").append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
      const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
      const x = d3.scaleLinear().domain([0, maxCost * 1.1]).range([0, iW]);

      stats.forEach((f, i) => {
        const y = i * (barH + gap);
        const c = costData[i];
        g.append("text").attr("x", -6).attr("y", y + barH / 2 + 3)
          .attr("text-anchor", "end").attr("fill", "#94a3b8").attr("font-size", "8px")
          .text(labels[i]);
        let offset = 0;
        const segs = [
          { val: c.tutor, color: "#2dd4bf" },
          { val: c.assessor, color: "#818cf8" },
          { val: c.image, color: "#fbbf24" },
        ];
        segs.forEach(s => {
          if (s.val > 0) {
            g.append("rect").attr("x", x(offset)).attr("y", y).attr("width", x(s.val))
              .attr("height", barH).attr("fill", s.color).attr("opacity", 0.85);
            offset += s.val;
          }
        });
        const total = c.tutor + c.assessor + c.image;
        g.append("text").attr("x", x(offset) + 4).attr("y", y + barH / 2 + 3)
          .attr("fill", "#e2e8f0").attr("font-size", "9px").text("$" + total.toFixed(3));
      });
      // Legend
      const leg = g.append("g").attr("transform", `translate(0,${stats.length * (barH + gap) + 4})`);
      [
        { label: "Tutor", color: "#2dd4bf" },
        { label: "Assessor", color: "#818cf8" },
        { label: "Images", color: "#fbbf24" },
      ].forEach((item, i) => {
        const gx = i * 60;
        leg.append("rect").attr("x", gx).attr("y", 0).attr("width", 8).attr("height", 8).attr("rx", 2).attr("fill", item.color);
        leg.append("text").attr("x", gx + 11).attr("y", 8).text(item.label).attr("fill", "#94a3b8").attr("font-size", "8px");
      });
    }
    if (chartRefs.confusion.current) {
      // Confusion ratio: confused / total interactions
      drawHBar(chartRefs.confusion.current, "Confusion Ratio",
        stats.map(f => {
          const total = f.correctCount + f.incorrectCount + f.partialCount + f.confusionCount;
          return total > 0 ? f.confusionCount / total : 0;
        }), "#ef4444",
        v => (v * 100).toFixed(0) + "%");
    }
    if (chartRefs.images.current) {
      drawHBar(chartRefs.images.current, "Images per Fact",
        stats.map(f => f.images), "#fbbf24",
        v => String(v));
    }
  }, [stats, execLog]);

  useEffect(() => {
    const t = setTimeout(draw, 60);
    return () => clearTimeout(t);
  }, [draw]);

  if (!stats.length) return null;

  return (
    <>
      <div className="chart-row">
        <div className="chart-panel">
          <h3>Time per Fact</h3>
          <div ref={chartRefs.time} />
        </div>
        <div className="chart-panel">
          <h3>Tokens per Fact</h3>
          <div ref={chartRefs.tokens} />
        </div>
      </div>
      <div className="chart-row">
        <div className="chart-panel">
          <h3>Cost per Fact</h3>
          <div ref={chartRefs.cost} />
        </div>
        <div className="chart-panel">
          <h3>Images per Fact</h3>
          <div ref={chartRefs.images} />
        </div>
      </div>
      <div className="chart-row">
        <div className="chart-panel">
          <h3>Understanding Depth</h3>
          <div ref={chartRefs.understanding} />
        </div>
        <div className="chart-panel">
          <h3>Confusion Ratio</h3>
          <div ref={chartRefs.confusion} />
        </div>
      </div>
    </>
  );
}

// =============================================
// D3 CHART FUNCTIONS
// =============================================

function drawLatencyChart(
  d3: any,
  container: HTMLElement,
  log: ExecStep[]
) {
  const lat = extractLatencies(log);
  if (!lat.tutor.length) {
    container.innerHTML =
      '<div class="empty" style="padding:20px">No latency data</div>';
    return;
  }

  const W = 400;
  const margin = { top: 10, right: 10, bottom: 30, left: 50 };
  const iW = W - margin.left - margin.right;
  const iH = 180;
  const H = iH + margin.top + margin.bottom;
  const allPoints = lat.tutor.concat(lat.assess);
  const maxMs = d3.max(allPoints, (d: any) => d.ms) || 1;
  const maxTurn = d3.max(allPoints, (d: any) => d.turn) || 1;

  const svg = d3
    .select(container)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([1, maxTurn]).range([0, iW]);
  const y = d3
    .scaleLinear()
    .domain([0, maxMs * 1.1])
    .range([iH, 0]);

  // Grid
  g.selectAll(".grid")
    .data(y.ticks(4))
    .enter()
    .append("line")
    .attr("x1", 0)
    .attr("x2", iW)
    .attr("y1", (d: number) => y(d))
    .attr("y2", (d: number) => y(d))
    .attr("stroke", "#1e293b")
    .attr("stroke-dasharray", "2,3");

  // Tutor line
  const tutorLine = d3
    .line()
    .x((d: any) => x(d.turn))
    .y((d: any) => y(d.ms))
    .curve(d3.curveMonotoneX);
  if (lat.tutor.length > 1)
    g.append("path")
      .datum(lat.tutor)
      .attr("d", tutorLine)
      .attr("fill", "none")
      .attr("stroke", "#2dd4bf")
      .attr("stroke-width", 2);
  g.selectAll(".tutor-dot")
    .data(lat.tutor)
    .enter()
    .append("circle")
    .attr("cx", (d: any) => x(d.turn))
    .attr("cy", (d: any) => y(d.ms))
    .attr("r", 3.5)
    .attr("fill", "#2dd4bf")
    .attr("stroke", "#0f172a")
    .attr("stroke-width", 1);

  // Assessment line
  const assessLine = d3
    .line()
    .x((d: any) => x(d.turn))
    .y((d: any) => y(d.ms))
    .curve(d3.curveMonotoneX);
  if (lat.assess.length > 1)
    g.append("path")
      .datum(lat.assess)
      .attr("d", assessLine)
      .attr("fill", "none")
      .attr("stroke", "#f472b6")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4,3");
  g.selectAll(".assess-dot")
    .data(lat.assess)
    .enter()
    .append("circle")
    .attr("cx", (d: any) => x(d.turn))
    .attr("cy", (d: any) => y(d.ms))
    .attr("r", 3)
    .attr("fill", "#f472b6")
    .attr("stroke", "#0f172a")
    .attr("stroke-width", 1);

  // Axes
  g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(Math.min(maxTurn, 8))
        .tickFormat((d: number) => "T" + d)
    )
    .selectAll("text")
    .attr("fill", "#64748b")
    .attr("font-size", "9px");
  g.append("g")
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickFormat((d: number) =>
          d >= 1000 ? ((d / 1000) | 0) + "s" : d + "ms"
        )
    )
    .selectAll("text")
    .attr("fill", "#64748b")
    .attr("font-size", "9px");
  g.selectAll(".domain,.tick line").attr("stroke", "#334155");

  // Legend
  const leg = g
    .append("g")
    .attr("transform", `translate(${iW - 140},0)`);
  leg
    .append("line")
    .attr("x1", 0)
    .attr("x2", 14)
    .attr("y1", 4)
    .attr("y2", 4)
    .attr("stroke", "#2dd4bf")
    .attr("stroke-width", 2);
  leg
    .append("text")
    .attr("x", 18)
    .attr("y", 8)
    .text("Tutor")
    .attr("fill", "#94a3b8")
    .attr("font-size", "9px");
  leg
    .append("line")
    .attr("x1", 55)
    .attr("x2", 69)
    .attr("y1", 4)
    .attr("y2", 4)
    .attr("stroke", "#f472b6")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "4,3");
  leg
    .append("text")
    .attr("x", 73)
    .attr("y", 8)
    .text("Assessment")
    .attr("fill", "#94a3b8")
    .attr("font-size", "9px");
}

function drawCostPie(
  d3: any,
  container: HTMLElement,
  breakdown: { input: number; output: number; images: number; tts: number; stt: number }
) {
  const total = breakdown.input + breakdown.output + breakdown.images + breakdown.tts + breakdown.stt;
  if (total <= 0) {
    container.innerHTML = '<div class="empty" style="padding:20px">No cost data</div>';
    return;
  }

  let data: { label: string; value: number; color: string }[] = [
    { label: "Input Tokens", value: breakdown.input, color: "#818cf8" },
    { label: "Output Tokens", value: breakdown.output, color: "#2dd4bf" },
    { label: "Images", value: breakdown.images, color: "#fbbf24" },
    { label: "TTS", value: breakdown.tts, color: "#f472b6" },
    { label: "STT", value: breakdown.stt, color: "#a78bfa" },
  ].filter(d => d.value > 0);
  if (!data.length) data = [{ label: "No data", value: 1, color: "#334155" }];

  drawCostDonut(d3, container, data, total);
}

function drawAgentCostPie(
  d3: any,
  container: HTMLElement,
  costs: { tutor: number; assessor: number; classifier: number; images: number; tts: number; stt: number }
) {
  const total = costs.tutor + costs.assessor + costs.classifier + costs.images + costs.tts + costs.stt;
  if (total <= 0) {
    container.innerHTML = '<div class="empty" style="padding:20px">No cost data</div>';
    return;
  }

  let data: { label: string; value: number; color: string }[] = [
    { label: "Tutor LLM", value: costs.tutor, color: "#2dd4bf" },
    { label: "Assessor LLM", value: costs.assessor, color: "#818cf8" },
    { label: "Classifier LLM", value: costs.classifier, color: "#34d399" },
    { label: "Image Gen", value: costs.images, color: "#fbbf24" },
    { label: "TTS", value: costs.tts, color: "#f472b6" },
    { label: "STT", value: costs.stt, color: "#a78bfa" },
  ].filter(d => d.value > 0);
  if (!data.length) data = [{ label: "No data", value: 1, color: "#334155" }];

  drawCostDonut(d3, container, data, total);
}

// Shared donut renderer with wrapping legend.
//
// Layout strategy:
// - Pie center Y is FIXED so the donut never drifts as the legend grows.
// - Legend uses tabular-nums so currency values don't jitter on update.
// - Items per row is computed from the actual visible data, balancing
//   trailing rows so 5 items render as 3+2 (not 4+1 orphan).
// - Long labels truncate via SVG <title> tooltip rather than overflow.
function drawCostDonut(
  d3: any,
  container: HTMLElement,
  data: { label: string; value: number; color: string }[],
  total: number
) {
  const W = 400, R = 80, r = 45;
  const ITEM_WIDTH = 130;       // wider per-item slot for labels like "Output Tokens $0.123"
  const ROW_HEIGHT = 16;
  const FONT_PX = 11;           // bumped from 9 for legibility
  const PIE_CY = 110;           // pinned pie center
  const LEGEND_GAP = 14;
  const MAX_PER_ROW = Math.max(1, Math.floor(W / ITEM_WIDTH)); // 3 at W=400

  // Balance trailing rows: e.g. 5 items → 3 + 2, not 4 + 1.
  // Pick the smallest items_per_row in [1..MAX_PER_ROW] that produces a
  // balanced last row (last row count >= ceil(items_per_row / 2)).
  const balanceRows = (n: number): number => {
    for (let perRow = MAX_PER_ROW; perRow >= 1; perRow--) {
      const lastRow = n % perRow || perRow;
      if (lastRow >= Math.ceil(perRow / 2) || perRow === 1) return perRow;
    }
    return MAX_PER_ROW;
  };
  const ITEMS_PER_ROW = balanceRows(data.length);
  const numRows = Math.ceil(data.length / ITEMS_PER_ROW);
  const legendTop = PIE_CY + R + LEGEND_GAP;
  const H = legendTop + numRows * ROW_HEIGHT + 6;

  const svg = d3.select(container).html("").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g").attr("transform", `translate(${W / 2},${PIE_CY})`);

  const pie = d3.pie().value((d: any) => d.value).sort(null);
  const arc = d3.arc().innerRadius(r).outerRadius(R);

  g.selectAll("path").data(pie(data)).enter().append("path")
    .attr("d", arc).attr("fill", (d: any) => d.data.color)
    .attr("stroke", "#16213e").attr("stroke-width", 2);

  g.append("text").attr("text-anchor", "middle").attr("dy", "0.1em")
    .text("$" + total.toFixed(2))
    .attr("fill", "#f1f5f9").attr("font-size", "18px").attr("font-weight", "700")
    .attr("font-variant-numeric", "tabular-nums");
  g.append("text").attr("text-anchor", "middle").attr("dy", "1.5em")
    .text("total").attr("fill", "#64748b").attr("font-size", "9px");

  data.forEach((dd, i) => {
    const row = Math.floor(i / ITEMS_PER_ROW);
    const col = i % ITEMS_PER_ROW;
    const itemsInRow = row === numRows - 1
      ? data.length - row * ITEMS_PER_ROW
      : ITEMS_PER_ROW;
    const rowOffsetX = (W - itemsInRow * ITEM_WIDTH) / 2;
    const x = rowOffsetX + col * ITEM_WIDTH;
    const y = legendTop + row * ROW_HEIGHT;
    svg.append("rect").attr("x", x).attr("y", y).attr("width", 9).attr("height", 9)
      .attr("rx", 2).attr("fill", dd.color);
    const label = dd.label + " $" + dd.value.toFixed(3);
    const text = svg.append("text").attr("x", x + 14).attr("y", y + 9)
      .text(label)
      .attr("fill", "#cbd5e1").attr("font-size", FONT_PX + "px")
      .attr("font-variant-numeric", "tabular-nums");
    // Add a <title> for hover tooltip in case label gets clipped.
    text.append("title").text(label);
  });
}

function drawAssessmentDonut(
  d3: any,
  container: HTMLElement,
  log: ExecStep[]
) {
  const a = extractAssessments(log);
  const total = a.correct + a.incorrect;
  if (total === 0) {
    container.innerHTML =
      '<div class="empty" style="padding:20px">No assessments</div>';
    return;
  }

  const W = 400;
  const H = 240;
  const R = 80;
  const r = 45;
  const svg = d3
    .select(container)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg
    .append("g")
    .attr("transform", `translate(${W / 2},${H / 2 - 10})`);

  const data: { label: string; value: number; color: string }[] = [
    { label: "Correct", value: a.correct, color: "#22c55e" },
    { label: "Incorrect", value: a.incorrect, color: "#ef4444" },
  ];
  if (a.confused > 0)
    data.push({ label: "Confused", value: a.confused, color: "#f59e0b" });

  const pie = d3
    .pie()
    .value((d: any) => d.value)
    .sort(null);
  const arc = d3.arc().innerRadius(r).outerRadius(R);

  g.selectAll("path")
    .data(pie(data))
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", (d: any) => d.data.color)
    .attr("stroke", "#16213e")
    .attr("stroke-width", 2);

  // Center text
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.1em")
    .text(total === 0 ? "-" : Math.round((a.correct / total) * 100) + "%")
    .attr("fill", "#f1f5f9")
    .attr("font-size", "18px")
    .attr("font-weight", "700");
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "1.5em")
    .text("accuracy")
    .attr("fill", "#64748b")
    .attr("font-size", "9px");

  // Legend
  const leg = svg
    .append("g")
    .attr("transform", `translate(${W / 2 - data.length * 40},${H - 10})`);
  data.forEach((dd, i) => {
    const gx = i * 80;
    leg
      .append("rect")
      .attr("x", gx)
      .attr("y", 0)
      .attr("width", 8)
      .attr("height", 8)
      .attr("rx", 2)
      .attr("fill", dd.color);
    leg
      .append("text")
      .attr("x", gx + 12)
      .attr("y", 8)
      .text(dd.label + " (" + dd.value + ")")
      .attr("fill", "#94a3b8")
      .attr("font-size", "9px");
  });
}

function drawFactDonut(
  d3: any,
  container: HTMLElement,
  log: ExecStep[]
) {
  if (!log || !log.length) {
    container.innerHTML =
      '<div class="empty" style="padding:20px">No fact data</div>';
    return;
  }

  // Count unique facts that reached each stage from V6_TRANSITION events
  const taughtFacts = new Set<string>();
  const assessedFacts = new Set<string>();
  const masteredFacts = new Set<string>();
  log.forEach((entry) => {
    if (entry.step !== "V6_TRANSITION") return;
    const d = entry.details || {};
    const fact = d.fact || "";
    const action = d.action || "";
    if (!fact) return;
    if (action === "advance_fact" || action === "scaffold_to_try") taughtFacts.add(fact);
    if (action === "check_next" || action === "start_check") assessedFacts.add(fact);
    if (action === "start_evidence" || action === "evidence_next") masteredFacts.add(fact);
  });
  // Also count legacy events
  log.forEach((entry) => {
    const d = entry.details || {};
    const fact = d.fact || "";
    if (entry.step === "FACT_TAUGHT" && fact) taughtFacts.add(fact);
    if (entry.step === "FACT_ASSESSED" && fact) assessedFacts.add(fact);
    if (entry.step === "FACT_MASTERED" && fact) masteredFacts.add(fact);
  });

  const taught = taughtFacts.size;
  const assessed = assessedFacts.size;
  const mastered = masteredFacts.size;
  const total = Math.max(taught, assessed, mastered, 1);

  const W = 400;
  const H = 240;
  const R = 80;
  const r = 45;
  const svg = d3
    .select(container)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg
    .append("g")
    .attr("transform", `translate(${W / 2},${H / 2 - 10})`);

  let data: { label: string; value: number; color: string }[] = [
    { label: "Taught", value: taught, color: "#818cf8" },
    { label: "Assessed", value: assessed, color: "#fbbf24" },
    { label: "Mastered", value: mastered, color: "#2dd4bf" },
  ].filter((d) => d.value > 0);
  if (!data.length) data = [{ label: "No data", value: 1, color: "#334155" }];

  const pie = d3
    .pie()
    .value((d: any) => d.value)
    .sort(null);
  const arc = d3.arc().innerRadius(r).outerRadius(R);

  g.selectAll("path")
    .data(pie(data))
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", (d: any) => d.data.color)
    .attr("stroke", "#16213e")
    .attr("stroke-width", 2);

  g.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.1em")
    .text(String(total))
    .attr("fill", "#f1f5f9")
    .attr("font-size", "22px")
    .attr("font-weight", "700");
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "1.5em")
    .text("facts")
    .attr("fill", "#64748b")
    .attr("font-size", "9px");

  const leg = svg
    .append("g")
    .attr("transform", `translate(${W / 2 - data.length * 45},${H - 10})`);
  data.forEach((dd, i) => {
    const gx = i * 90;
    leg
      .append("rect")
      .attr("x", gx)
      .attr("y", 0)
      .attr("width", 8)
      .attr("height", 8)
      .attr("rx", 2)
      .attr("fill", dd.color);
    leg
      .append("text")
      .attr("x", gx + 12)
      .attr("y", 8)
      .text(dd.label + " (" + dd.value + ")")
      .attr("fill", "#94a3b8")
      .attr("font-size", "9px");
  });
}

function drawTokenChart(
  d3: any,
  container: HTMLElement,
  log: ExecStep[]
) {
  if (!log) {
    container.innerHTML = '<div class="empty" style="padding:20px">No data</div>';
    return;
  }

  // Show completion_tokens (actual new output) per LLM call.
  // tokens_used includes prompt tokens (resent context) which grows every turn — not useful per-turn.
  interface CallEntry { index: number; type: "tutor" | "assess"; tokens: number }
  const calls: CallEntry[] = [];
  let idx = 0;

  log.forEach((entry) => {
    const d = entry.details || {};
    if (entry.step === "LLM_RESPONSE" && (d.completion_tokens || d.tokens_used)) {
      calls.push({ index: idx++, type: "tutor", tokens: d.completion_tokens || d.tokens_used });
    } else if (entry.step === "ASSESSMENT_LLM_RESPONSE" && (d.completion_tokens || d.tokens_used)) {
      calls.push({ index: idx++, type: "assess", tokens: d.completion_tokens || d.tokens_used });
    }
  });

  if (calls.length < 2) {
    container.innerHTML = '<div class="empty" style="padding:20px">Not enough token data</div>';
    return;
  }

  const totalTokens = calls.reduce((s, c) => s + c.tokens, 0);
  const maxTokens = d3.max(calls, (d: any) => d.tokens) || 1;

  const W = 400, margin = { top: 14, right: 10, bottom: 40, left: 45 };
  const iW = W - margin.left - margin.right, iH = 160;
  const H = iH + margin.top + margin.bottom;

  const svg = d3.select(container).html("").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(calls.map((_: any, i: number) => i)).range([0, iW]).padding(0.08);
  const y = d3.scaleLinear().domain([0, maxTokens * 1.05]).range([iH, 0]);

  // Grid
  y.ticks(4).forEach((v: number) => {
    g.append("line").attr("x1", 0).attr("x2", iW)
      .attr("y1", y(v)).attr("y2", y(v))
      .attr("stroke", "#1e293b").attr("stroke-width", 1);
    g.append("text").attr("x", -6).attr("y", y(v) + 3)
      .text(v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(v))
      .attr("fill", "#475569").attr("font-size", "8px").attr("text-anchor", "end");
  });

  // Bars — color by call type
  const barW = x.bandwidth();
  calls.forEach((c, i) => {
    const bx = x(i as any)!;
    const color = c.type === "tutor" ? "#818cf8" : "#f472b6";
    g.append("rect").attr("x", bx).attr("y", y(c.tokens))
      .attr("width", barW).attr("height", iH - y(c.tokens))
      .attr("rx", 1.5).attr("fill", color).attr("opacity", 0.85);
  });

  // X axis baseline
  g.append("line").attr("x1", 0).attr("x2", iW)
    .attr("y1", iH).attr("y2", iH).attr("stroke", "#334155").attr("stroke-width", 1);

  // Footer
  const fmtK = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  const foot = g.append("g").attr("transform", `translate(0,${iH + 10})`);
  foot.append("text").attr("x", iW / 2).attr("y", 8)
    .text(`${calls.length} LLM calls — ${fmtK(totalTokens)} total tokens`)
    .attr("fill", "#64748b").attr("font-size", "9px").attr("text-anchor", "middle");

  // Legend
  const leg = foot.append("g").attr("transform", `translate(${iW / 2 - 70},16)`);
  leg.append("rect").attr("width", 8).attr("height", 8).attr("rx", 2).attr("fill", "#818cf8");
  leg.append("text").attr("x", 12).attr("y", 8).text("Tutor").attr("fill", "#94a3b8").attr("font-size", "9px");
  leg.append("rect").attr("x", 60).attr("width", 8).attr("height", 8).attr("rx", 2).attr("fill", "#f472b6");
  leg.append("text").attr("x", 72).attr("y", 8).text("Assessment").attr("fill", "#94a3b8").attr("font-size", "9px");
}

function drawStepTimeline(
  d3: any,
  container: HTMLElement,
  log: ExecStep[]
) {
  if (!log) {
    container.innerHTML =
      '<div class="empty" style="padding:20px">No data</div>';
    return;
  }

  // Build segments: each segment is a step with start/end times
  interface Segment { step: string; startMs: number; endMs: number }
  const segments: Segment[] = [];
  let currentStep = "";
  let currentStart = 0;

  const normTs = (ts: string | undefined): number => {
    if (!ts) return 0;
    let s = ts;
    if (s && !s.endsWith("Z") && !s.includes("+") && !/\d{2}:\d{2}$/.test(s.slice(-6))) s += "Z";
    return new Date(s).getTime() || 0;
  };

  log.forEach((entry) => {
    if (entry.step === "STEP_TRANSITION" || entry.step === "STEP_UPDATE" || entry.step === "CYCLE_ADVANCE" || entry.step === "V6_TRANSITION") {
      const d = entry.details || {};
      const name = (d.to_phase || d.to || d.to_step || d.step_name || d.new_step || d.step || "").toUpperCase();
      if (!name) return;
      const t = normTs(entry.timestamp);
      if (currentStep && t > currentStart) {
        segments.push({ step: currentStep, startMs: currentStart, endMs: t });
      }
      currentStep = name;
      currentStart = t;
    }
  });
  // Close last segment with session end or last log entry
  if (currentStep) {
    const lastTs = log.length > 0 ? normTs(log[log.length - 1].timestamp) : currentStart;
    const endMs = lastTs > currentStart ? lastTs : currentStart + 60000;
    segments.push({ step: currentStep, startMs: currentStart, endMs });
  }

  if (!segments.length) {
    container.innerHTML =
      '<div class="empty" style="padding:20px">No step transitions</div>';
    return;
  }

  // Aggregate: count visits and total time per step
  const STEP_ORDER = ["RECALL", "TEACH", "TRY", "CHECK", "EVIDENCE", "NEXT STEPS"];
  const stats: Record<string, { visits: number; totalMs: number }> = {};
  segments.forEach((seg) => {
    if (!stats[seg.step]) stats[seg.step] = { visits: 0, totalMs: 0 };
    stats[seg.step].visits++;
    stats[seg.step].totalMs += seg.endMs - seg.startMs;
  });

  // Sort by defined order, then alphabetical for unknowns
  const stepKeys = Object.keys(stats).sort((a, b) => {
    const ia = STEP_ORDER.indexOf(a), ib = STEP_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const totalMs = Object.values(stats).reduce((s, v) => s + v.totalMs, 0) || 1;

  const W = 400, H = 200;
  const margin = { top: 10, right: 10, bottom: 10, left: 10 };
  const iW = W - margin.left - margin.right;

  const svg = d3.select(container).html("").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // --- Top: horizontal stacked bar showing time proportion ---
  const barY = 0, barH = 28;
  let xOff = 0;
  stepKeys.forEach((step) => {
    const pct = stats[step].totalMs / totalMs;
    const w = Math.max(pct * iW, 2);
    const color = STEP_COLORS[step] || "#64748b";
    g.append("rect")
      .attr("x", xOff).attr("y", barY).attr("width", w).attr("height", barH)
      .attr("rx", step === stepKeys[0] ? 4 : 0)
      .attr("fill", color).attr("opacity", 0.85);
    // Label inside bar if wide enough
    if (w > 30) {
      g.append("text")
        .attr("x", xOff + w / 2).attr("y", barY + barH / 2 + 1)
        .text(step).attr("fill", "#fff").attr("font-size", "9px")
        .attr("font-weight", "600").attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle");
    }
    xOff += w;
  });

  // --- Bottom: step detail rows ---
  const rowY = barY + barH + 16;
  const rowH = 24;
  stepKeys.forEach((step, i) => {
    const y = rowY + i * rowH;
    const color = STEP_COLORS[step] || "#64748b";
    const s = stats[step];
    const pct = Math.round((s.totalMs / totalMs) * 100);
    const durSec = Math.round(s.totalMs / 1000);
    const durStr = durSec >= 60 ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : `${durSec}s`;

    // Color dot
    g.append("circle").attr("cx", 6).attr("cy", y + 8).attr("r", 5)
      .attr("fill", color).attr("stroke", "#0f172a").attr("stroke-width", 1);

    // Step name
    g.append("text").attr("x", 18).attr("y", y + 12)
      .text(step).attr("fill", "#e2e8f0").attr("font-size", "12px").attr("font-weight", "600");

    // Visits badge
    g.append("text").attr("x", 110).attr("y", y + 12)
      .text(`${s.visits}x`).attr("fill", "#94a3b8").attr("font-size", "10px");

    // Duration
    g.append("text").attr("x", 145).attr("y", y + 12)
      .text(durStr).attr("fill", "#94a3b8").attr("font-size", "10px");

    // Mini bar
    const miniBarW = 120, miniBarX = 195;
    g.append("rect").attr("x", miniBarX).attr("y", y + 3).attr("width", miniBarW).attr("height", 10)
      .attr("rx", 3).attr("fill", "#1e293b");
    g.append("rect").attr("x", miniBarX).attr("y", y + 3)
      .attr("width", Math.max((pct / 100) * miniBarW, 2)).attr("height", 10)
      .attr("rx", 3).attr("fill", color).attr("opacity", 0.7);

    // Percentage
    g.append("text").attr("x", miniBarX + miniBarW + 8).attr("y", y + 12)
      .text(`${pct}%`).attr("fill", "#64748b").attr("font-size", "10px");
  });
}

// =============================================
// Accuracy Over Time — running correct/total %
// =============================================
function drawAccuracyOverTime(
  d3: any,
  container: HTMLElement,
  log: ExecStep[]
) {
  if (!log) {
    container.innerHTML = '<div class="empty" style="padding:20px">No data</div>';
    return;
  }

  // Build running accuracy from ASSESSMENT_LLM_RESPONSE events
  const points: { turn: number; accuracy: number; correct: number; total: number }[] = [];
  let correct = 0;
  let total = 0;
  log.forEach((entry) => {
    if (entry.step !== "ASSESSMENT_LLM_RESPONSE" || !entry.details) return;
    const d = typeof entry.details === "string"
      ? (() => { try { return JSON.parse(entry.details); } catch { return {}; } })()
      : entry.details;
    const resp = d.full_response
      ? (typeof d.full_response === "string" ? (() => { try { return JSON.parse(d.full_response); } catch { return {}; } })() : d.full_response)
      : d;
    const itype = resp.interaction_type || "";
    if (itype === "student_correct") { correct++; total++; }
    else if (itype === "student_incorrect") { total++; }
    else return;
    points.push({ turn: total, accuracy: total > 0 ? (correct / total) * 100 : 0, correct, total });
  });

  if (points.length < 2) {
    container.innerHTML = '<div class="empty" style="padding:20px">Not enough assessment data</div>';
    return;
  }

  const finalAcc = points[points.length - 1].accuracy;
  const accColor = finalAcc >= 70 ? "#22c55e" : finalAcc >= 40 ? "#f59e0b" : "#ef4444";

  const W = 400, margin = { top: 20, right: 50, bottom: 40, left: 40 };
  const iW = W - margin.left - margin.right, iH = 160;
  const H = iH + margin.top + margin.bottom;

  const svg = d3.select(container).html("").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([1, points.length]).range([0, iW]);
  const y = d3.scaleLinear().domain([0, 100]).range([iH, 0]);

  // Subtle grid lines (no axis clutter)
  [25, 50, 75, 100].forEach((v) => {
    g.append("line").attr("x1", 0).attr("x2", iW)
      .attr("y1", y(v)).attr("y2", y(v))
      .attr("stroke", "#1e293b").attr("stroke-width", 1);
    g.append("text").attr("x", -6).attr("y", y(v) + 3)
      .text(v + "%").attr("fill", "#475569").attr("font-size", "8px").attr("text-anchor", "end");
  });

  // 70% threshold
  g.append("line").attr("x1", 0).attr("x2", iW)
    .attr("y1", y(70)).attr("y2", y(70))
    .attr("stroke", "#22c55e").attr("stroke-width", 1).attr("stroke-dasharray", "6,4").attr("opacity", 0.4);

  // Gradient fill under curve
  const gradId = "accGrad";
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", gradId)
    .attr("x1", "0").attr("y1", "0").attr("x2", "0").attr("y2", "1");
  grad.append("stop").attr("offset", "0%").attr("stop-color", accColor).attr("stop-opacity", 0.25);
  grad.append("stop").attr("offset", "100%").attr("stop-color", accColor).attr("stop-opacity", 0.02);

  const area = d3.area().x((_d: any, i: number) => x(i + 1)).y0(iH).y1((d: any) => y(d.accuracy)).curve(d3.curveMonotoneX);
  g.append("path").datum(points).attr("d", area).attr("fill", `url(#${gradId})`);

  // Main line
  const line = d3.line().x((_d: any, i: number) => x(i + 1)).y((d: any) => y(d.accuracy)).curve(d3.curveMonotoneX);
  g.append("path").datum(points).attr("d", line)
    .attr("fill", "none").attr("stroke", accColor).attr("stroke-width", 2.5);

  // Result strip along x-axis — small squares showing correct/incorrect per question
  const stripY = iH + 6, stripH = 6;
  const stripW = Math.min(iW / points.length - 1, 12);
  points.forEach((p, i) => {
    const wasCorrect = i === 0 ? p.correct > 0 : p.correct > points[i - 1].correct;
    g.append("rect")
      .attr("x", x(i + 1) - stripW / 2).attr("y", stripY)
      .attr("width", stripW).attr("height", stripH).attr("rx", 1.5)
      .attr("fill", wasCorrect ? "#22c55e" : "#ef4444").attr("opacity", 0.8);
  });

  // Final accuracy badge (right side)
  const lastX = x(points.length), lastY = y(finalAcc);
  g.append("circle").attr("cx", lastX).attr("cy", lastY).attr("r", 4)
    .attr("fill", accColor).attr("stroke", "#0f172a").attr("stroke-width", 1.5);
  g.append("text").attr("x", lastX + 10).attr("y", lastY + 4)
    .text(Math.round(finalAcc) + "%")
    .attr("fill", accColor).attr("font-size", "13px").attr("font-weight", "700");

  // Bottom label
  g.append("text").attr("x", iW / 2).attr("y", stripY + stripH + 14)
    .text(`${correct} correct / ${total} questions`)
    .attr("fill", "#64748b").attr("font-size", "9px").attr("text-anchor", "middle");

  // Baseline
  g.append("line").attr("x1", 0).attr("x2", iW)
    .attr("y1", iH).attr("y2", iH).attr("stroke", "#334155").attr("stroke-width", 1);
}

// =============================================
// Fact Mastery Progress — stacked area over turns
// =============================================
function drawFactProgress(
  d3: any,
  container: HTMLElement,
  log: ExecStep[]
) {
  if (!log) {
    container.innerHTML = '<div class="empty" style="padding:20px">No data</div>';
    return;
  }

  // Track taught/assessed/mastered counts over time
  const points: { turn: number; taught: number; assessed: number; mastered: number }[] = [];
  let taught = 0, assessed = 0, mastered = 0, turn = 0;
  const taughtFacts = new Set<string>();
  const assessedFacts = new Set<string>();
  const masteredFacts = new Set<string>();
  log.forEach((entry) => {
    let changed = false;
    const d = entry.details || {};
    // Legacy events
    if (entry.step === "FACT_TAUGHT") { taught++; changed = true; }
    if (entry.step === "FACT_ASSESSED") { assessed++; changed = true; }
    if (entry.step === "FACT_MASTERED") { mastered++; changed = true; }
    // V6 events — track unique facts per phase
    if (entry.step === "V6_TRANSITION") {
      const fact = d.fact || "";
      const action = d.action || "";
      if (action === "advance_fact" || action === "scaffold_to_try") {
        if (fact && !taughtFacts.has(fact)) { taughtFacts.add(fact); taught++; changed = true; }
      }
      if (action === "check_next" || action === "start_check") {
        if (fact && !assessedFacts.has(fact)) { assessedFacts.add(fact); assessed++; changed = true; }
      }
      if (action === "start_evidence" || action === "evidence_next") {
        if (fact && !masteredFacts.has(fact)) { masteredFacts.add(fact); mastered++; changed = true; }
      }
    }
    if (entry.step === "STEP_TRANSITION" || entry.step === "V6_TRANSITION" || entry.step === "LLM_RESPONSE") { turn++; }
    if (changed) points.push({ turn, taught, assessed, mastered });
  });

  if (points.length < 2) {
    container.innerHTML = '<div class="empty" style="padding:20px">Not enough fact data</div>';
    return;
  }

  const W = 400, margin = { top: 10, right: 10, bottom: 30, left: 40 };
  const iW = W - margin.left - margin.right, iH = 180;
  const H = iH + margin.top + margin.bottom;
  const maxVal = Math.max(taught, assessed, mastered, 1);

  const svg = d3.select(container).html("").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, points.length - 1]).range([0, iW]);
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([iH, 0]);

  // Grid
  g.selectAll(".grid").data(y.ticks(4)).enter().append("line")
    .attr("x1", 0).attr("x2", iW).attr("y1", (d: number) => y(d)).attr("y2", (d: number) => y(d))
    .attr("stroke", "#1e293b").attr("stroke-dasharray", "2,3");

  // Lines for each metric
  const metrics = [
    { key: "taught", color: "#818cf8", label: "Taught" },
    { key: "assessed", color: "#fbbf24", label: "Assessed" },
    { key: "mastered", color: "#2dd4bf", label: "Mastered" },
  ];

  metrics.forEach(({ key, color }) => {
    const line = d3.line().x((_d: any, i: number) => x(i)).y((d: any) => y(d[key])).curve(d3.curveStepAfter);
    g.append("path").datum(points).attr("d", line)
      .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);
  });

  // Axes
  g.append("g").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(Math.min(points.length, 6)).tickFormat(() => ""))
    .selectAll("text").attr("fill", "#64748b").attr("font-size", "9px");
  g.append("g")
    .call(d3.axisLeft(y).ticks(4).tickFormat((d: number) => String(Math.round(d))))
    .selectAll("text").attr("fill", "#64748b").attr("font-size", "9px");
  g.selectAll(".domain,.tick line").attr("stroke", "#334155");

  // Legend
  const leg = g.append("g").attr("transform", `translate(${iW - 190},0)`);
  metrics.forEach(({ color, label }, i) => {
    const gx = i * 70;
    leg.append("line").attr("x1", gx).attr("x2", gx + 14).attr("y1", 4).attr("y2", 4)
      .attr("stroke", color).attr("stroke-width", 2);
    leg.append("text").attr("x", gx + 18).attr("y", 8)
      .text(label).attr("fill", "#94a3b8").attr("font-size", "9px");
  });
}

// =============================================
// Student Engagement — message length ratio per turn
// =============================================
function drawEngagementChart(
  d3: any,
  container: HTMLElement,
  messages: LearningSessionMessage[]
) {
  if (!messages || messages.length < 4) {
    container.innerHTML = '<div class="empty" style="padding:20px">Not enough messages</div>';
    return;
  }

  // Group into turns: each turn = user msg length + assistant msg length
  const turns: { turn: number; student: number; tutor: number; ratio: number }[] = [];
  let turnNum = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      const studentLen = messages[i].content?.length || 0;
      // Find next assistant message
      let tutorLen = 0;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "assistant" && messages[j].content) {
          tutorLen = messages[j].content.length;
          break;
        }
      }
      if (tutorLen > 0) {
        turnNum++;
        const ratio = studentLen / (studentLen + tutorLen);
        turns.push({ turn: turnNum, student: studentLen, tutor: tutorLen, ratio });
      }
    }
  }

  if (turns.length < 2) {
    container.innerHTML = '<div class="empty" style="padding:20px">Not enough conversation turns</div>';
    return;
  }

  const W = 400, margin = { top: 10, right: 10, bottom: 30, left: 45 };
  const iW = W - margin.left - margin.right, iH = 180;
  const H = iH + margin.top + margin.bottom;
  const maxLen = d3.max(turns, (d: any) => Math.max(d.student, d.tutor)) || 1;

  const svg = d3.select(container).html("").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(turns.map((d: any) => d.turn)).range([0, iW]).padding(0.2);
  const y = d3.scaleLinear().domain([0, maxLen]).range([iH, 0]);

  // Grid
  g.selectAll(".grid").data(y.ticks(4)).enter().append("line")
    .attr("x1", 0).attr("x2", iW).attr("y1", (d: number) => y(d)).attr("y2", (d: number) => y(d))
    .attr("stroke", "#1e293b").attr("stroke-dasharray", "2,3");

  const barW = x.bandwidth() / 2;

  // Student bars
  g.selectAll(".bar-student").data(turns).enter().append("rect")
    .attr("x", (d: any) => x(d.turn)!)
    .attr("y", (d: any) => y(d.student))
    .attr("width", barW)
    .attr("height", (d: any) => iH - y(d.student))
    .attr("rx", 2).attr("fill", "#818cf8").attr("opacity", 0.85);

  // Tutor bars
  g.selectAll(".bar-tutor").data(turns).enter().append("rect")
    .attr("x", (d: any) => x(d.turn)! + barW)
    .attr("y", (d: any) => y(d.tutor))
    .attr("width", barW)
    .attr("height", (d: any) => iH - y(d.tutor))
    .attr("rx", 2).attr("fill", "#2dd4bf").attr("opacity", 0.85);

  // Axes
  g.append("g").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).tickFormat((d: number) => turns.length > 20 ? (d % 5 === 0 ? "T" + d : "") : "T" + d))
    .selectAll("text").attr("fill", "#64748b").attr("font-size", "9px");
  g.append("g")
    .call(d3.axisLeft(y).ticks(4).tickFormat((d: number) => d >= 1000 ? (d / 1000).toFixed(0) + "k" : String(d)))
    .selectAll("text").attr("fill", "#64748b").attr("font-size", "9px");
  g.selectAll(".domain,.tick line").attr("stroke", "#334155");

  // Legend
  const leg = g.append("g").attr("transform", `translate(${iW - 120},0)`);
  leg.append("rect").attr("width", 8).attr("height", 8).attr("rx", 2).attr("fill", "#818cf8");
  leg.append("text").attr("x", 12).attr("y", 8).text("Student").attr("fill", "#94a3b8").attr("font-size", "9px");
  leg.append("rect").attr("x", 60).attr("width", 8).attr("height", 8).attr("rx", 2).attr("fill", "#2dd4bf");
  leg.append("text").attr("x", 72).attr("y", 8).text("Tutor").attr("fill", "#94a3b8").attr("font-size", "9px");

  svg.append("text").attr("x", W / 2).attr("y", H - 4)
    .text("Turn").attr("fill", "#475569").attr("font-size", "9px").attr("text-anchor", "middle");
}
