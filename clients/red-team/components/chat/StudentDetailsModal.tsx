"use client";

import { useState, useEffect } from "react";
import { ReportCard } from "@/components/shared/ReportCard";
import "@/styles/report-card.css";

interface StudentDetailsModalProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  subject: string;
}

export function StudentDetailsModal({
  open,
  onClose,
  studentId,
  subject,
}: StudentDetailsModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"report" | "position" | "sessions">("report");

  useEffect(() => {
    if (!open || !studentId) return;
    setLoading(true);
    setError("");
    setActiveTab("report");

    fetch(
      `/api/student-details/${studentId}?subject=${encodeURIComponent(subject)}`,
      { credentials: "include" }
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [open, studentId, subject]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay active" id="execModal" onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h3 id="modalTitle">Student Details</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body" id="modalBody">
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1e293b", marginBottom: 14 }}>
            {(["report", "position", "sessions"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  padding: "8px 16px",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === t ? "2px solid #3b82f6" : "2px solid transparent",
                  color: activeTab === t ? "#e2e8f0" : "#64748b",
                  fontSize: 13,
                  fontWeight: activeTab === t ? 600 : 400,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {t === "report" ? "Report Card" : t === "position" ? "Current Position" : "Recent Sessions"}
              </button>
            ))}
          </div>

          {/* Report Card tab */}
          {activeTab === "report" && (
            <ReportCard studentId={studentId} subject={subject} />
          )}

          {/* Position tab */}
          {activeTab === "position" && (
            <>
              {loading && <div style={{ textAlign: "center", padding: 20, color: "#64748b" }}>Loading...</div>}
              {error && <div style={{ color: "#ef4444", padding: 20 }}>{error}</div>}
              {!loading && !error && data && <PositionContent data={data} />}
            </>
          )}

          {/* Sessions tab */}
          {activeTab === "sessions" && (
            <>
              {loading && <div style={{ textAlign: "center", padding: 20, color: "#64748b" }}>Loading...</div>}
              {error && <div style={{ color: "#ef4444", padding: 20 }}>{error}</div>}
              {!loading && !error && data && <SessionsContent data={data} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PositionContent({ data }: { data: any }) {
  const pos = data.current_position || {};
  const completed = data.completed_capsules || [];
  return (
    <div className="detail-body">
      <div className="info-cards">
        <div className="info-card">
          <h4>Current Position</h4>
          <div className="info-row"><span className="label">Subject</span><span className="value">{data.subject || "-"}</span></div>
          <div className="info-row"><span className="label">Phase</span><span className="value">{pos.phase || "-"}</span></div>
          <div className="info-row"><span className="label">Step</span><span className="value">{pos.step_name || "-"}</span></div>
          <div className="info-row"><span className="label">Theme</span><span className="value">{pos.theme_name || "-"}</span></div>
          <div className="info-row"><span className="label">Capsule</span><span className="value">{pos.capsule_name || "-"}</span></div>
          <div className="info-row"><span className="label">Current Fact</span><span className="value">{pos.current_fact || "-"}</span></div>
        </div>
        <div className="info-card">
          <h4>Progress</h4>
          <div className="info-row"><span className="label">Credits</span><span className="value">{data.total_credits || 0}</span></div>
          <div className="info-row"><span className="label">Capsules Done</span><span className="value">{completed.length}</span></div>
        </div>
      </div>
      <div className="info-card" style={{ marginBottom: 12 }}>
        <h4>Completed Capsules</h4>
        {completed.length ? (
          completed.map((c: string, i: number) => (
            <div key={i} className="info-row"><span className="label">-</span><span className="value">{c}</span></div>
          ))
        ) : (
          <div style={{ color: "#475569", padding: "4px 0" }}>None yet</div>
        )}
      </div>
    </div>
  );
}

function SessionsContent({ data }: { data: any }) {
  const sessions = data.recent_sessions || [];
  return (
    <div className="detail-body">
      {sessions.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {sessions.map((s: any, i: number) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 12px", background: "#0f172a", borderRadius: 6, border: "1px solid #1e293b"
            }}>
              <div>
                <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>{s.capsule}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{s.date}</div>
              </div>
              <div style={{
                fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                background: "#1e293b", color: "#2dd4bf"
              }}>
                {s.facts_taught} facts
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "#475569", padding: 20, textAlign: "center" }}>No sessions yet</div>
      )}
    </div>
  );
}
