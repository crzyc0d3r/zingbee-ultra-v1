"use client";

import { useState, useEffect, useCallback } from "react";
import type { SessionDetail as SessionDetailType } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { Icon } from "@/components/ui/Icon";
import DashboardTab from "./DashboardTab";
import TimelineTab from "./TimelineTab";
import InteractionsTab from "./InteractionsTab";
import FeedbackTab from "./FeedbackTab";
import { JsonViewer } from "@/components/audits/JsonViewer";
import { ReportCard } from "@/components/shared/ReportCard";
import "@/styles/report-card.css";

type TabName = "dashboard" | "report" | "timeline" | "systemlog" | "interactions" | "feedback";

const TABS: { key: TabName; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "report", label: "Report Card" },
  { key: "timeline", label: "Timeline" },
  { key: "systemlog", label: "System Log" },
  { key: "interactions", label: "Fact Interactions" },
  { key: "feedback", label: "Feedback" },
];

interface SessionDetailProps {
  sessionId: string;
  onClose: () => void;
  onImageClick: (url: string) => void;
}

export default function SessionDetail({
  sessionId,
  onClose,
  onImageClick,
}: SessionDetailProps) {
  const [sessionData, setSessionData] = useState<SessionDetailType | null>(
    null
  );
  const [error, setError] = useState(false);
  const [currentTab, setCurrentTab] = useState<TabName>("dashboard");

  useEffect(() => {
    setSessionData(null);
    setError(false);
    setCurrentTab("dashboard");

    apiFetch<SessionDetailType>(
      `/sessions/api/${encodeURIComponent(sessionId)}`
    )
      .then(setSessionData)
      .catch(() => setError(true));
  }, [sessionId]);

  // Escape key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const renderTabContent = () => {
    if (error) {
      return (
        <div className="empty" style={{ color: "#ef4444" }}>
          Error loading session
        </div>
      );
    }
    if (!sessionData) {
      return (
        <div className="empty">
          <div className="ico">
            <Icon name="hourglass" size={32} />
          </div>
          <div>Loading...</div>
        </div>
      );
    }

    switch (currentTab) {
      case "dashboard":
        return (
          <DashboardTab
            session={sessionData}
            onImageClick={onImageClick}
          />
        );
      case "report":
        return (
          <ReportCard
            studentId={sessionData.student_id}
            adminMode
          />
        );
      case "timeline":
        return (
          <TimelineTab
            session={sessionData}
            onImageClick={onImageClick}
          />
        );
      case "systemlog":
        return <JsonViewer data={sessionData.system_log || []} height="calc(100vh - 160px)" />;
      case "interactions":
        return (
          <InteractionsTab
            interactions={sessionData.interactions}
            executionLog={sessionData.execution_log}
            onImageClick={onImageClick}
          />
        );
      case "feedback":
        return <FeedbackTab feedback={sessionData.feedback} onImageClick={onImageClick} />;
      default:
        return null;
    }
  };

  const title = sessionData
    ? `${sessionData.student_name} - ${sessionData.capsule_name}`
    : "Session Detail";

  return (
    <>
      <div className="detail-overlay" id="detailOverlay" onClick={onClose} />
      <div className="detail-panel active" id="detailPanel">
        <div className="detail-header">
          <h2 id="detailTitle">{title}</h2>
          <button className="close-btn" id="closeDetail" onClick={onClose}>
            <Icon name="back" size={14} /> Back
          </button>
        </div>
        <div className="detail-tabs" id="detailTabs">
          {TABS.map((tab) => (
            <div
              key={tab.key}
              className={`detail-tab${currentTab === tab.key ? " active" : ""}`}
              data-tab={tab.key}
              onClick={() => setCurrentTab(tab.key)}
            >
              {tab.label}
            </div>
          ))}
        </div>
        <div className="detail-body" id="detailBody">
          {renderTabContent()}
        </div>
      </div>
    </>
  );
}
