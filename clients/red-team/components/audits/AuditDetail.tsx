"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { AuditDetailResponse, AuditInsight, AuditSummary } from "./types";
import { AuditHeader } from "./AuditHeader";
import { OverviewTab } from "./OverviewTab";
import { InsightsTab } from "./InsightsTab";
import { SubjectDetailTab } from "./SubjectDetailTab";
import { MatrixTab } from "./MatrixTab";
import { JsonViewer } from "./JsonViewer";

interface Props {
  auditId: string;
  onBack: () => void;
}

const TABS = ["Overview", "Insights", "Subjects", "Matrix", "Raw JSON"] as const;
type TabName = (typeof TABS)[number];

export function AuditDetail({ auditId, onBack }: Props) {
  const [audit, setAudit] = useState<AuditDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>("Overview");

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<AuditDetailResponse>(`/api/curriculum-audits/${auditId}`)
      .then(setAudit)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load audit"))
      .finally(() => setLoading(false));
  }, [auditId]);

  const handleInsightsGenerated = useCallback((insights: AuditInsight[], summary?: AuditSummary) => {
    setAudit((prev) => {
      if (!prev?.data) return prev;
      const updated = { ...prev, data: { ...prev.data, insights } };
      if (summary) updated.data.summary = summary;
      return updated;
    });
  }, []);

  if (loading) {
    return (
      <div className="audit-detail">
        <div className="back-bar">
          <button className="back-link" onClick={onBack}>Back to Audits</button>
        </div>
        <div className="ad-loading">Loading audit data...</div>
      </div>
    );
  }

  if (error || !audit) {
    return (
      <div className="audit-detail">
        <div className="back-bar">
          <button className="back-link" onClick={onBack}>Back to Audits</button>
        </div>
        <div className="ad-error">{error || "Audit not found"}</div>
      </div>
    );
  }

  if (!audit.data) {
    return (
      <div className="audit-detail">
        <div className="back-bar">
          <button className="back-link" onClick={onBack}>Back to Audits</button>
        </div>
        <div className="ad-error">This audit has no data.</div>
      </div>
    );
  }

  const data = audit.data;
  const insightCount = data.insights?.length ?? data.summary.insights_count ?? 0;

  return (
    <div className="audit-detail ad-react">
      <div className="back-bar">
        <button className="back-link" onClick={onBack}>Back to Audits</button>
      </div>
      <div className="ad-body">
        <AuditHeader
          summary={data.summary}
          title={audit.title}
          generatedAt={data.generated_at}
          insights={data.insights}
        />
        <div className="ad-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={`ad-tab ${t === activeTab ? "ad-tab-active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
              {t === "Insights" && insightCount > 0 && (
                <span className="ad-tab-badge">{insightCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ad-tab-content">
          {activeTab === "Overview" && (
            <OverviewTab subjectStats={data.subject_stats} insights={data.insights} />
          )}
          {activeTab === "Insights" && (
            <InsightsTab
              auditId={auditId}
              insights={data.insights}
              onInsightsGenerated={handleInsightsGenerated}
            />
          )}
          {activeTab === "Subjects" && <SubjectDetailTab phaseDetail={data.phase_detail} />}
          {activeTab === "Matrix" && <MatrixTab insights={data.insights} />}
          {activeTab === "Raw JSON" && <JsonViewer data={data} />}
        </div>
      </div>
    </div>
  );
}
