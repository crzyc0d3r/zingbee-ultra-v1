"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { apiFetch } from "@/lib/api";
import { ScoreBarInline } from "./ScoreBar";
import { formatDuration, formatDate, scoreColor, SCORE_KEYS } from "./helpers";
import {
  drawScoreRadar,
  drawScoreComparison,
  drawCapsuleDurations,
  drawScoreDistribution,
  drawFactDonut,
  drawConvTimeline,
} from "./charts";

// --- Types matching the API response shape (HTML ref) ---

interface ConvMsg {
  role: string;
  content?: string;
  turn?: number;
  step?: string;
}

interface GradingDetail {
  check?: string;
  name?: string;
  score?: number | null;
  passed?: boolean;
  detail?: string;
  details?: string;
  reason?: string;
}

interface Capsule {
  capsuleName: string;
  subject: string;
  phase?: string;
  configName?: string;
  persona?: string;
  totalTurns: number;
  totalDuration: number;
  totalTokens: number;
  scores: Record<string, number | null>;
  conversation?: ConvMsg[];
  factsTaught: string[];
  factsMastered: string[];
  factsAssessed: string[];
  sessionCompleted?: boolean;
  capsuleAdvanced?: boolean;
  stepsCompleted: string[];
  gradingDetails?: GradingDetail[];
}

interface RunData {
  id: string;
  config: string;
  capsules: Capsule[];
}

interface RunDetailProps {
  runId: string;
  onBack: () => void;
}

// ====== Main RunDetail component ======

export function RunDetail({ runId, onBack }: RunDetailProps) {
  const [run, setRun] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedCapsule, setSelectedCapsule] = useState<Capsule | null>(null);

  const loadRun = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<RunData>(
        `/evals/api/runs/${encodeURIComponent(runId)}`
      );
      setRun(data);
      setError(false);
    } catch (e: any) {
      if (e.message !== "auth") setError(true);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  if (loading) {
    return (
      <div className="empty">
        <div className="ico">
          <Icon name="hourglass" size={32} />
        </div>
        <div>Loading run...</div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="empty">
        <div className="ico">
          <Icon name="warning" size={32} />
        </div>
        <div>Failed to load run</div>
      </div>
    );
  }

  if (selectedCapsule) {
    return (
      <CapsuleDetail
        run={run}
        capsule={selectedCapsule}
        onBack={() => setSelectedCapsule(null)}
      />
    );
  }

  return (
    <RunOverview
      run={run}
      onBack={onBack}
      onCapsuleClick={(c) => setSelectedCapsule(c)}
    />
  );
}

// Column definitions for capsule results table
const capsuleColumns: Column<Capsule>[] = [
  { key: "subject", header: "Subject", sortable: true },
  { key: "capsuleName", header: "Capsule", sortable: true },
  {
    key: "phase",
    header: "Phase",
    sortable: true,
    render: (c) => c.phase || "-",
  },
  { key: "totalTurns", header: "Turns", sortable: true },
  ...SCORE_KEYS.map(
    (k): Column<Capsule> => ({
      key: k,
      header:
        k === "age_appropriateness"
          ? "Age Approp."
          : k.charAt(0).toUpperCase() + k.slice(1),
      sortable: true,
      render: (c) => <ScoreBarInline value={c.scores[k]} />,
    }),
  ),
  {
    key: "totalTokens",
    header: "Tokens",
    sortable: true,
    render: (c) => (c.totalTokens || 0).toLocaleString(),
  },
  {
    key: "totalDuration",
    header: "Duration",
    sortable: true,
    render: (c) => formatDuration(c.totalDuration || 0),
  },
];

// ====== Run Overview ======

interface RunOverviewProps {
  run: RunData;
  onBack: () => void;
  onCapsuleClick: (c: Capsule) => void;
}

function RunOverview({ run, onBack, onCapsuleClick }: RunOverviewProps) {
  const capsules = run.capsules || [];
  const scoreCompRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef<HTMLDivElement>(null);
  const distAccRef = useRef<HTMLDivElement>(null);
  const distEngRef = useRef<HTMLDivElement>(null);

  // Compute aggregate stats
  const scoreSums: Record<string, number> = {};
  SCORE_KEYS.forEach((k) => (scoreSums[k] = 0));
  let scoreCount = 0,
    totalTokens = 0,
    totalDuration = 0,
    totalTurns = 0;

  capsules.forEach((c) => {
    totalTokens += c.totalTokens || 0;
    totalDuration += c.totalDuration || 0;
    totalTurns += c.totalTurns || 0;
    let has = false;
    SCORE_KEYS.forEach((k) => {
      if (c.scores[k] != null) {
        scoreSums[k] += c.scores[k] as number;
        has = true;
      }
    });
    if (has) scoreCount++;
  });

  const avgDuration = capsules.length ? totalDuration / capsules.length : 0;
  const avgTurns = capsules.length
    ? (totalTurns / capsules.length).toFixed(1)
    : "0";

  // Draw D3 charts after render
  useEffect(() => {
    if (!capsules.length) return;
    const timer = setTimeout(() => {
      if (scoreCompRef.current)
        drawScoreComparison(scoreCompRef.current, capsules, [...SCORE_KEYS]);
      if (durationRef.current)
        drawCapsuleDurations(durationRef.current, capsules);
      if (distAccRef.current)
        drawScoreDistribution(distAccRef.current, capsules, "accuracy");
      if (distEngRef.current)
        drawScoreDistribution(distEngRef.current, capsules, "engagement");
    }, 50);
    return () => clearTimeout(timer);
  }, [capsules]);

  return (
    <>
      <a className="back-link" onClick={onBack} role="button" tabIndex={0}>
        <Icon name="back" size={12} /> Back to Completed Runs
      </a>
      <h2 style={{ fontSize: 16, marginBottom: 4, color: "#f1f5f9" }}>
        {run.config} - {run.id}
      </h2>

      {capsules.length === 0 ? (
        <div className="empty">
          <div className="ico">
            <Icon name="note" size={32} />
          </div>
          <div>No capsule results</div>
        </div>
      ) : (
        <>
          {/* Metric grid */}
          <div className="metric-grid">
            <div className="metric-box">
              <div
                className="metric-icon"
                style={{ background: "#1e3a5f", color: "#60a5fa" }}
              >
                <Icon name="timer" size={20} />
              </div>
              <div>
                <div className="metric-val">
                  {formatDuration(totalDuration)}
                </div>
                <div className="metric-label">Total Duration</div>
              </div>
            </div>
            <div className="metric-box">
              <div
                className="metric-icon"
                style={{ background: "#1a3a2a", color: "#4ade80" }}
              >
                <Icon name="timer" size={20} />
              </div>
              <div>
                <div className="metric-val">{formatDuration(avgDuration)}</div>
                <div className="metric-label">Avg per Capsule</div>
              </div>
            </div>
            <div className="metric-box">
              <div
                className="metric-icon"
                style={{ background: "#3b1a3a", color: "#c084fc" }}
              >
                <Icon name="chat" size={20} />
              </div>
              <div>
                <div className="metric-val">{totalTurns}</div>
                <div className="metric-label">Total Turns</div>
              </div>
            </div>
            <div className="metric-box">
              <div
                className="metric-icon"
                style={{ background: "#3a2a1a", color: "#fb923c" }}
              >
                <Icon name="lightning" size={20} />
              </div>
              <div>
                <div className="metric-val">
                  {totalTokens.toLocaleString()}
                </div>
                <div className="metric-label">Total Tokens</div>
              </div>
            </div>
            <div className="metric-box">
              <div
                className="metric-icon"
                style={{ background: "#1a2a3a", color: "#38bdf8" }}
              >
                <Icon name="chart" size={20} />
              </div>
              <div>
                <div className="metric-val">{capsules.length}</div>
                <div className="metric-label">Capsules</div>
              </div>
            </div>
            <div className="metric-box">
              <div
                className="metric-icon"
                style={{ background: "#2a1a1a", color: "#f87171" }}
              >
                <Icon name="target" size={20} />
              </div>
              <div>
                <div className="metric-val">{avgTurns}</div>
                <div className="metric-label">Avg Turns/Capsule</div>
              </div>
            </div>
          </div>

          {/* Score cards */}
          <div className="score-cards">
            {SCORE_KEYS.map((k) => {
              const avg = scoreCount > 0 ? scoreSums[k] / scoreCount : 0;
              const pct = Math.round(avg * 100);
              const color = scoreColor(avg);
              return (
                <div className="score-card" key={k}>
                  <div className="label">{k.replace(/_/g, " ")}</div>
                  <div className="value" style={{ color }}>
                    {pct}%
                  </div>
                  <div className="sub">avg of {scoreCount}</div>
                </div>
              );
            })}
          </div>

          {/* Chart row: Score Comparison + Duration */}
          <div className="chart-row">
            <div className="chart-panel">
              <h3>Score Comparison</h3>
              <div ref={scoreCompRef} className="chart-area" />
            </div>
            <div className="chart-panel">
              <h3>Duration by Capsule</h3>
              <div ref={durationRef} className="chart-area" />
            </div>
          </div>

          {/* Chart row: Distribution */}
          <div className="chart-row">
            <div className="chart-panel">
              <h3>Accuracy Distribution</h3>
              <div ref={distAccRef} className="chart-area" />
            </div>
            <div className="chart-panel">
              <h3>Engagement Distribution</h3>
              <div ref={distEngRef} className="chart-area" />
            </div>
          </div>

          {/* Capsule results table */}
          <div className="detail-panel">
            <h3>Capsule Results</h3>
            <DataGrid
              columns={capsuleColumns}
              rows={capsules}
              rowKey={(c, i) => `${c.capsuleName}-${i}`}
              onRowClick={onCapsuleClick}
              pageSize={25}
              emptyMessage="No capsule results"
            />
          </div>
        </>
      )}
    </>
  );
}

// ====== Capsule Detail ======

interface CapsuleDetailProps {
  run: RunData;
  capsule: Capsule;
  onBack: () => void;
}

function CapsuleDetail({ run, capsule, onBack }: CapsuleDetailProps) {
  const radarRef = useRef<HTMLDivElement>(null);
  const factDonutRef = useRef<HTMLDivElement>(null);
  const convTimelineRef = useRef<HTMLDivElement>(null);

  const scoreKeys = Object.keys(capsule.scores);

  // Computed metrics
  const avgTimePerTurn =
    capsule.totalTurns > 0
      ? (capsule.totalDuration || 0) / capsule.totalTurns
      : 0;
  const tokensPerTurn =
    capsule.totalTurns > 0
      ? Math.round((capsule.totalTokens || 0) / capsule.totalTurns)
      : 0;

  const conversation = capsule.conversation || [];
  const assistantMsgs = conversation.filter(
    (m) => m.role === "assistant"
  ).length;
  const studentMsgs = conversation.filter((m) => m.role === "user").length;
  let avgAssistantLen = 0;
  if (assistantMsgs) {
    const total = conversation
      .filter((m) => m.role === "assistant")
      .reduce((sum, m) => sum + (m.content || "").length, 0);
    avgAssistantLen = Math.round(total / assistantMsgs);
  }

  // Draw D3 charts
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scoreKeys.length >= 3) {
        if (radarRef.current) drawScoreRadar(radarRef.current, capsule.scores);
        if (factDonutRef.current)
          drawFactDonut(
            factDonutRef.current,
            capsule.factsTaught.length,
            capsule.factsMastered.length,
            capsule.factsAssessed.length
          );
      }
      if (conversation.length > 1 && convTimelineRef.current) {
        drawConvTimeline(convTimelineRef.current, conversation);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [capsule, scoreKeys.length, conversation]);

  return (
    <>
      <a className="back-link" onClick={onBack} role="button" tabIndex={0}>
        <Icon name="back" size={12} /> Back to {run.id}
      </a>
      <h2 style={{ fontSize: 16, marginBottom: 4, color: "#f1f5f9" }}>
        {capsule.subject} - {capsule.capsuleName}
      </h2>
      <div
        style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}
      >
        Phase {capsule.phase || "?"} | Config: {capsule.configName} | Persona:{" "}
        {capsule.persona}
      </div>

      {/* Metric grid */}
      <div className="metric-grid">
        <div className="metric-box">
          <div
            className="metric-icon"
            style={{ background: "#1e3a5f", color: "#60a5fa" }}
          >
            <Icon name="timer" size={20} />
          </div>
          <div>
            <div className="metric-val">
              {formatDuration(capsule.totalDuration || 0)}
            </div>
            <div className="metric-label">Total Duration</div>
          </div>
        </div>
        <div className="metric-box">
          <div
            className="metric-icon"
            style={{ background: "#1a3a2a", color: "#4ade80" }}
          >
            <Icon name="timer" size={20} />
          </div>
          <div>
            <div className="metric-val">{avgTimePerTurn.toFixed(1)}s</div>
            <div className="metric-label">Avg Time / Turn</div>
          </div>
        </div>
        <div className="metric-box">
          <div
            className="metric-icon"
            style={{ background: "#3b1a3a", color: "#c084fc" }}
          >
            <Icon name="chat" size={20} />
          </div>
          <div>
            <div className="metric-val">{capsule.totalTurns}</div>
            <div className="metric-label">Total Turns</div>
          </div>
        </div>
        <div className="metric-box">
          <div
            className="metric-icon"
            style={{ background: "#3a2a1a", color: "#fb923c" }}
          >
            <Icon name="lightning" size={20} />
          </div>
          <div>
            <div className="metric-val">
              {(capsule.totalTokens || 0).toLocaleString()}
            </div>
            <div className="metric-label">Total Tokens</div>
          </div>
        </div>
        <div className="metric-box">
          <div
            className="metric-icon"
            style={{ background: "#1a2a3a", color: "#38bdf8" }}
          >
            <Icon name="lightning" size={20} />
          </div>
          <div>
            <div className="metric-val">{tokensPerTurn}</div>
            <div className="metric-label">Tokens / Turn</div>
          </div>
        </div>
        <div className="metric-box">
          <div
            className="metric-icon"
            style={{ background: "#2a1a1a", color: "#f87171" }}
          >
            <Icon name="note" size={20} />
          </div>
          <div>
            <div className="metric-val">{avgAssistantLen}</div>
            <div className="metric-label">Avg Tutor Chars</div>
          </div>
        </div>
      </div>

      {/* Status badges */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {capsule.sessionCompleted ? (
          <span className="badge badge-green">Session Complete</span>
        ) : (
          <span className="badge badge-yellow">Session Incomplete</span>
        )}
        {capsule.capsuleAdvanced ? (
          <span className="badge badge-green">Capsule Advanced</span>
        ) : (
          <span className="badge badge-gray">Not Advanced</span>
        )}
        {capsule.stepsCompleted &&
          capsule.stepsCompleted.map((s, i) => (
            <span key={i} className="badge badge-blue">
              {s}
            </span>
          ))}
      </div>

      {/* Score radar + fact donut (if enough scores) */}
      {scoreKeys.length >= 3 ? (
        <div className="chart-row">
          <div className="chart-panel">
            <h3>Score Radar</h3>
            <div ref={radarRef} className="chart-area" />
          </div>
          <div className="chart-panel">
            <h3>Fact Coverage</h3>
            <div
              ref={factDonutRef}
              className="chart-area"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            />
          </div>
        </div>
      ) : scoreKeys.length > 0 ? (
        <div className="score-cards">
          {scoreKeys.map((k) => {
            const v = capsule.scores[k] as number;
            const pct = Math.round(v * 100);
            const color = scoreColor(v);
            return (
              <div className="score-card" key={k}>
                <div className="label">{k.replace(/_/g, " ")}</div>
                <div className="value" style={{ color }}>
                  {pct}%
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Conversation timeline chart */}
      {conversation.length > 1 && (
        <div className="chart-panel" style={{ marginBottom: 16 }}>
          <h3>Conversation Flow (message length by turn)</h3>
          <div ref={convTimelineRef} className="chart-area" />
        </div>
      )}

      {/* Facts Coverage */}
      <div className="detail-panel">
        <h3>Facts Coverage</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#3b82f6",
                marginBottom: 6,
              }}
            >
              TAUGHT ({capsule.factsTaught.length})
            </div>
            <ul className="fact-list">
              {capsule.factsTaught.map((f, i) => (
                <li key={i} className="taught">
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#22c55e",
                marginBottom: 6,
              }}
            >
              MASTERED ({capsule.factsMastered.length})
            </div>
            <ul className="fact-list">
              {capsule.factsMastered.map((f, i) => (
                <li key={i} className="mastered">
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#f59e0b",
                marginBottom: 6,
              }}
            >
              ASSESSED ({capsule.factsAssessed.length})
            </div>
            <ul className="fact-list">
              {capsule.factsAssessed.map((f, i) => (
                <li key={i} className="assessed">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Grading Details */}
      {capsule.gradingDetails && capsule.gradingDetails.length > 0 && (
        <div className="detail-panel">
          <h3>Grading Details</h3>
          {capsule.gradingDetails.map((g, i) => {
            const sc = g.score != null ? g.score : g.passed;
            const color =
              sc === true || (typeof sc === "number" && sc >= 0.8)
                ? "#22c55e"
                : sc === false || (typeof sc === "number" && sc < 0.5)
                  ? "#ef4444"
                  : "#f59e0b";
            return (
              <div className="grading-item" key={i}>
                <span className="check-name">
                  {g.check || g.name || "Check"}
                </span>
                <span className="check-score" style={{ color }}>
                  {typeof sc === "boolean"
                    ? sc
                      ? "PASS"
                      : "FAIL"
                    : sc != null
                      ? Math.round(sc * 100) + "%"
                      : "-"}
                </span>
                {(g.detail || g.details || g.reason) && (
                  <div className="check-detail">
                    {g.detail || g.details || g.reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Conversation transcript */}
      {conversation.length > 0 && (
        <div className="detail-panel">
          <h3>Conversation ({conversation.length} messages)</h3>
          {conversation.map((msg, i) => (
            <div key={i} className={`conv-msg ${msg.role}`}>
              <div className="conv-meta">
                {msg.role} | Turn {msg.turn || 0} | {msg.step || ""}
              </div>
              <div className="conv-content">{msg.content}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
