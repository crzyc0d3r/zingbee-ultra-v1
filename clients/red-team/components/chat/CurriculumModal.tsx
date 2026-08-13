"use client";

import { useState, useEffect } from "react";
import { escapeHtml } from "@/lib/markdown";
import { JsonViewer } from "@/components/audits/JsonViewer";

interface CurriculumModalProps {
  open: boolean;
  onClose: () => void;
  phase: number;
  subject: string;
}

export function CurriculumModal({
  open,
  onClose,
  phase,
  subject,
}: CurriculumModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("curroverview");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setActiveTab("curroverview");

    fetch(
      `/api/curriculum-file/${phase}?subject=${encodeURIComponent(subject)}`,
      { credentials: "include" }
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [open, phase, subject]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const themes = data?.content?.themes || [];
  const filePath = data?.file_path || "?";

  return (
    <div className="modal-overlay active" onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Curriculum File - Phase {phase}</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          {loading && (
            <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
              Loading...
            </div>
          )}
          {error && (
            <div style={{ color: "#ef4444", padding: "20px" }}>{error}</div>
          )}
          {!loading && !error && data && (
            <div className="detail-body">
              <div className="detail-tabs">
                <button
                  className={`detail-tab${activeTab === "curroverview" ? " active" : ""}`}
                  onClick={() => setActiveTab("curroverview")}
                >
                  Overview
                </button>
                <button
                  className={`detail-tab${activeTab === "currraw" ? " active" : ""}`}
                  onClick={() => setActiveTab("currraw")}
                >
                  Raw JSON
                </button>
              </div>

              <div
                className={`tab-content${activeTab === "curroverview" ? " active" : ""}`}
                id="tab-curroverview"
              >
                <div
                  style={{
                    marginBottom: "12px",
                    padding: "8px",
                    background: "#1a1a2e",
                    borderRadius: "6px",
                    fontSize: "11px",
                    color: "#888",
                    wordBreak: "break-all",
                  }}
                >
                  File: {filePath}
                </div>
                {themes.map((t: any, i: number) => (
                  <div key={i} style={{ marginBottom: "8px" }}>
                    <div
                      style={{
                        fontWeight: 600,
                        color: "#60a5fa",
                        fontSize: "12px",
                        marginBottom: "4px",
                      }}
                    >
                      {t.name}
                    </div>
                    {(t.capsules || []).map((c: any, j: number) => {
                      const fc = (c.core_facts || []).length;
                      return (
                        <div
                          key={j}
                          style={{
                            padding: "2px 0 2px 12px",
                            fontSize: "11px",
                            color: "#ccc",
                          }}
                        >
                          {c.name}{" "}
                          <span style={{ color: "#888" }}>({fc} facts)</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div
                className={`tab-content${activeTab === "currraw" ? " active" : ""}`}
                id="tab-currraw"
              >
                <JsonViewer data={data.content} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
