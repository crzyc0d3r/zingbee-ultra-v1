"use client";

import { useState, useEffect, useCallback } from "react";
import { escapeHtml } from "@/lib/markdown";
import { JsonViewer } from "@/components/audits/JsonViewer";

interface SessionDetailsModalProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  subject: string;
  onViewCurriculum?: (phase: number) => void;
}

export function SessionDetailsModal({
  open,
  onClose,
  studentId,
  subject,
  onViewCurriculum,
}: SessionDetailsModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (!open || !studentId) return;
    setLoading(true);
    setError("");
    setActiveTab("overview");

    fetch(`/api/session-details/${studentId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [open, studentId]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay active" id="execModal" onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="modalTitle">Session Details</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body" id="modalBody">
          {loading && (
            <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
              Loading...
            </div>
          )}
          {error && (
            <div style={{ color: "#ef4444", padding: "20px" }}>{error}</div>
          )}
          {!loading && !error && data && (
            <SessionDetailsContent
              data={data}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onViewCurriculum={onViewCurriculum}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SessionDetailsContent({
  data,
  activeTab,
  setActiveTab,
  onViewCurriculum,
}: {
  data: any;
  activeTab: string;
  setActiveTab: (t: string) => void;
  onViewCurriculum?: (phase: number) => void;
}) {
  const s = data.session || {};
  const stu = data.student || {};
  const kp = data.knowledge || {};
  const sf = data.student_file || {};
  const dur = s.duration_seconds || 0;
  const mins = Math.floor(dur / 60);
  const secs = dur % 60;
  const accuracy =
    s.questions > 0 ? Math.round((s.correct / s.questions) * 100) : 0;

  const totalFacts = kp.total_facts || 1;
  const taughtPct = Math.round((kp.facts_taught / totalFacts) * 100);
  const assessedPct = Math.round((kp.facts_assessed / totalFacts) * 100);
  const masteredPct = Math.round((kp.facts_mastered / totalFacts) * 100);

  const insights = data.insights || [];
  const rawLog = data.raw_log || [];
  const systemLog = data.system_log || [];

  return (
    <div className="detail-body">
      <div className="detail-tabs">
        <button
          className={`detail-tab${activeTab === "overview" ? " active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={`detail-tab${activeTab === "insights" ? " active" : ""}`}
          onClick={() => setActiveTab("insights")}
        >
          Insights ({insights.length})
        </button>
        <button
          className={`detail-tab${activeTab === "studentfile" ? " active" : ""}`}
          onClick={() => setActiveTab("studentfile")}
        >
          Student File
        </button>
        <button
          className={`detail-tab${activeTab === "systemlog" ? " active" : ""}`}
          onClick={() => setActiveTab("systemlog")}
        >
          System Log ({systemLog.length})
        </button>
        <button
          className={`detail-tab${activeTab === "rawlog" ? " active" : ""}`}
          onClick={() => setActiveTab("rawlog")}
        >
          Raw Log
        </button>
      </div>

      {/* Overview Tab */}
      <div
        className={`tab-content${activeTab === "overview" ? " active" : ""}`}
        id="tab-overview"
      >
        <div className="info-cards">
          <div className="info-card">
            <h4>Student</h4>
            <InfoRow label="ID" value={stu.id} />
            <InfoRow label="Name" value={stu.name} />
            <InfoRow label="Credits" value={stu.total_credits} />
            <InfoRow label="Capsules Done" value={stu.completed_capsules} />
            <InfoRow label="Total Sessions" value={stu.total_sessions} />
            <InfoRow label="Interactions" value={stu.total_interactions} />
            <InfoRow label="Last Session" value={String(stu.last_session)} />
          </div>
          <div className="info-card">
            <h4>Session</h4>
            <InfoRow label="Duration" value={`${mins}m ${secs}s`} />
            <InfoRow label="Questions" value={s.questions} />
            <InfoRow label="Correct" value={`${s.correct} (${accuracy}%)`} />
            <InfoRow
              label="Tokens"
              value={s.total_tokens?.toLocaleString()}
            />
            <InfoRow label="Start Step" value={s.start_step || s.start_phase} />
            <InfoRow label="Active" value={s.is_active ? "Yes" : "No"} />
            <InfoRow label="Log Entries" value={rawLog.length} />
          </div>
        </div>

        <div className="info-card" style={{ marginBottom: "12px" }}>
          <h4>Knowledge Progress</h4>
          <div className="info-row">
            <span className="label">Phase</span>
            <span className="value">
              Phase {s.phase || "?"}{" "}
              {onViewCurriculum && (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onViewCurriculum(s.phase || 1);
                  }}
                  style={{ color: "#60a5fa", fontSize: "10px", marginLeft: "6px" }}
                >
                  View Curriculum
                </a>
              )}
            </span>
          </div>
          <InfoRow label="Theme" value={s.theme_name} />
          <InfoRow label="Capsule" value={s.capsule_name} />
          <div className="info-row">
            <span className="label">Step</span>
            <span className="value" style={{ color: "#34d399" }}>
              {s.current_step}
            </span>
          </div>

          <div className="info-row" style={{ marginTop: "8px" }}>
            <span className="label">Facts Taught</span>
            <span className="value" style={{ color: "#60a5fa" }}>
              {kp.facts_taught}/{kp.total_facts} ({taughtPct}%)
            </span>
          </div>
          <ProgressBar pct={taughtPct} color="#60a5fa" />

          <InfoRow label="Facts Assessed" value={`${kp.facts_assessed}/${kp.total_facts} (${assessedPct}%)`} valueColor="#f59e0b" />
          <ProgressBar pct={assessedPct} color="#f59e0b" />

          <InfoRow label="Facts Mastered" value={`${kp.facts_mastered}/${kp.total_facts} (${masteredPct}%)`} valueColor="#8b5cf6" />
          <ProgressBar pct={masteredPct} color="#8b5cf6" />

          {kp.current_fact && (
            <div
              style={{
                marginTop: "8px",
                padding: "8px",
                background: "#1a1a2e",
                borderRadius: "6px",
                borderLeft: "3px solid #60a5fa",
              }}
            >
              <div style={{ fontSize: "10px", color: "#888", marginBottom: "2px" }}>
                Currently Teaching (Fact {kp.current_fact_index}/{kp.total_facts})
              </div>
              <div style={{ fontSize: "11px", color: "#e0e0e0", lineHeight: 1.4 }}>
                {kp.current_fact}
              </div>
            </div>
          )}

          {kp.next_capsule && (
            <div
              style={{
                marginTop: "8px",
                padding: "8px",
                background: "#1a2e1a",
                borderRadius: "6px",
                borderLeft: "3px solid #34d399",
              }}
            >
              <div style={{ fontSize: "10px", color: "#34d399", marginBottom: "2px" }}>
                Next Capsule
              </div>
              <div style={{ fontSize: "11px", color: "#e0e0e0" }}>
                {kp.next_capsule}
              </div>
            </div>
          )}

          {kp.curriculum_complete && (
            <div
              style={{
                marginTop: "8px",
                padding: "8px",
                background: "#2e1a2e",
                borderRadius: "6px",
                borderLeft: "3px solid #a855f7",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "12px", color: "#a855f7", fontWeight: 600 }}>
                Phase {s.phase || "?"} Complete!
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Insights Tab */}
      <div
        className={`tab-content${activeTab === "insights" ? " active" : ""}`}
        id="tab-insights"
      >
        {insights.length ? (
          insights.map((item: any, i: number) => (
            <div key={i} className="insight-entry" data-type={item.type}>
              <span className="insight-time">{item.time}</span>
              <span className="insight-text">{item.text}</span>
            </div>
          ))
        ) : (
          <div style={{ color: "#666", padding: "12px" }}>
            No events recorded yet.
          </div>
        )}
      </div>

      {/* Student File Tab */}
      <div
        className={`tab-content${activeTab === "studentfile" ? " active" : ""}`}
        id="tab-studentfile"
      >
        <div
          style={{
            marginBottom: "8px",
            padding: "8px",
            background: "#1a1a2e",
            borderRadius: "6px",
            fontSize: "11px",
            color: "#888",
            wordBreak: "break-all",
          }}
        >
          File: {sf.file_path || "?"}
        </div>
        {sf.exists && sf.content ? (
          <JsonViewer data={sf.content} />
        ) : (
          <div style={{ color: "#888", padding: "12px" }}>File not found</div>
        )}
      </div>

      {/* System Log Tab */}
      <div
        className={`tab-content${activeTab === "systemlog" ? " active" : ""}`}
        id="tab-systemlog"
      >
        <JsonViewer data={systemLog} />
      </div>

      {/* Raw Log Tab */}
      <div
        className={`tab-content${activeTab === "rawlog" ? " active" : ""}`}
        id="tab-rawlog"
      >
        <JsonViewer data={rawLog} />
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: any;
  valueColor?: string;
}) {
  return (
    <div className="info-row">
      <span className="label">{label}</span>
      <span className="value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      style={{
        background: "#1a1a2e",
        borderRadius: "4px",
        height: "6px",
        margin: "4px 0 8px",
      }}
    >
      <div
        style={{
          background: color,
          height: "100%",
          borderRadius: "4px",
          width: `${pct}%`,
          transition: "width 0.3s",
        }}
      />
    </div>
  );
}
