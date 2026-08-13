"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/ui/Icon";

interface NavSidebarProps {
  onNavTo?: (view: string) => void;
}

export function NavSidebar({ onNavTo }: NavSidebarProps) {
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeView, setActiveView] = useState("app");

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const toggleSection = useCallback((section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const handleNav = useCallback(
    (view: string) => {
      setMobileOpen(false);
      setActiveView(view);
      if (onNavTo) {
        onNavTo(view);
      }
    },
    [onNavTo]
  );

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  // Determine which top-level section is active
  const isSessionsActive = activeView === "sessions";
  const isEvalsActive = activeView.startsWith("evals");
  const isAdminActive = activeView.startsWith("admin");
  const isImagesActive = activeView.startsWith("images-") || activeView.startsWith("distillations-");
  const isCurriculumActive = activeView.startsWith("curriculum");
  const isPlaygroundActive = activeView === "playground";
  const isReportingActive = activeView === "reporting" || activeView.startsWith("reporting-");
  const isMonitoringActive = activeView.startsWith("monitoring-");
  const isLogsActive = activeView === "logs";
  const isAppActive = activeView === "app";

  return (
    <>
      <nav className={`nav-sidebar${collapsed ? " collapsed" : ""}`}>
        <div className="nav-sidebar-header">
          <button
            className="nav-sidebar-toggle"
            onClick={toggleCollapsed}
            title="Toggle menu"
          >
            <Icon name="menu" size={18} />
          </button>
          <span className="nav-sidebar-brand">ZingBee RT</span>
        </div>

        <div className="nav-sidebar-nav">
          {/* Start Session */}
          <div
            className={`nav-sidebar-item${isAppActive ? " active" : ""}`}
            onClick={() => handleNav("app")}
            title="Start Session"
          >
            <span className="nav-icon"><Icon name="launch" /></span>
            <span className="nav-label">Start Session</span>
          </div>

          {/* Sessions */}
          <div
            className={`nav-sidebar-item${isSessionsActive ? " active" : ""}`}
            onClick={() => handleNav("sessions")}
            title="Sessions"
          >
            <span className="nav-icon"><Icon name="clipboard" /></span>
            <span className="nav-label">Sessions</span>
          </div>

          {/* Reporting (expandable) */}
          <div
            className={`nav-sidebar-item${isReportingActive ? " active" : ""}${openSections.reporting ? " open" : ""}`}
            onClick={() => toggleSection("reporting")}
            title="Reporting"
          >
            <span className="nav-icon"><Icon name="chart" /></span>
            <span className="nav-label">Reporting</span>
            <span className="nav-arrow">&#9654;</span>
          </div>
          <div className={`nav-submenu${openSections.reporting ? " open" : ""}`}>
            <div className="nav-sub-item" onClick={() => handleNav("reporting-cost-student")}>
              <span className="sub-icon"><Icon name="user" /></span> Cost by Student
            </div>
            <div className="nav-sub-item" onClick={() => handleNav("reporting-cost-workload")}>
              <span className="sub-icon"><Icon name="wrench" /></span> Cost by Workload
            </div>
            <div className="nav-sub-item" onClick={() => handleNav("reporting-cost-model")}>
              <span className="sub-icon"><Icon name="robot" /></span> Cost by Model
            </div>
            <div className="nav-sub-item" onClick={() => handleNav("reporting-cost-subject")}>
              <span className="sub-icon"><Icon name="book" /></span> Cost by Subject
            </div>
            <div className="nav-sub-item" onClick={() => handleNav("reporting-time-student")}>
              <span className="sub-icon"><Icon name="timer" /></span> Time by Student
            </div>
            <div className="nav-sub-item" onClick={() => handleNav("reporting-time-fact")}>
              <span className="sub-icon"><Icon name="hourglass" /></span> Time by Fact
            </div>
          </div>

          {/* Monitoring (expandable) */}
          <div
            className={`nav-sidebar-item${isMonitoringActive ? " active" : ""}${openSections.monitoring ? " open" : ""}`}
            onClick={() => toggleSection("monitoring")}
            title="Monitoring"
          >
            <span className="nav-icon"><Icon name="chart" /></span>
            <span className="nav-label">Monitoring</span>
            <span className="nav-arrow">&#9654;</span>
          </div>
          <div className={`nav-submenu${openSections.monitoring ? " open" : ""}`}>
            <div className="nav-sub-item" onClick={() => handleNav("monitoring-engagement")}>
              <span className="sub-icon"><Icon name="lightning" /></span> Engagement Health
            </div>
          </div>

          {/* Playground */}
          <div
            className={`nav-sidebar-item${isPlaygroundActive ? " active" : ""}`}
            onClick={() => handleNav("playground")}
            title="Prompt Playground"
          >
            <span className="nav-icon"><Icon name="flask" /></span>
            <span className="nav-label">Playground</span>
          </div>

          {/* Logs */}
          <div
            className={`nav-sidebar-item${isLogsActive ? " active" : ""}`}
            onClick={() => handleNav("logs")}
            title="Cloud Logs"
          >
            <span className="nav-icon"><Icon name="chart" /></span>
            <span className="nav-label">Logs</span>
          </div>

          {/* Evals (expandable) */}
          <div
            className={`nav-sidebar-item${isEvalsActive ? " active" : ""}${openSections.evals ? " open" : ""}`}
            onClick={() => toggleSection("evals")}
            title="Evals"
          >
            <span className="nav-icon"><Icon name="lightning" /></span>
            <span className="nav-label">Evals</span>
            <span className="nav-arrow">&#9654;</span>
          </div>
          <div className={`nav-submenu${openSections.evals ? " open" : ""}`}>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("evals-running")}
            >
              <span className="sub-icon"><Icon name="play" /></span> Jobs
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("evals-completed")}
            >
              <span className="sub-icon"><Icon name="check" /></span> Completed Runs
            </div>
          </div>

          {/* Admin (expandable) */}
          <div
            className={`nav-sidebar-item${isAdminActive ? " active" : ""}${openSections.admin ? " open" : ""}`}
            onClick={() => toggleSection("admin")}
            title="Data"
          >
            <span className="nav-icon"><Icon name="wrench" /></span>
            <span className="nav-label">Data</span>
            <span className="nav-arrow">&#9654;</span>
          </div>
          <div className={`nav-submenu${openSections.admin ? " open" : ""}`}>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("admin-dashboard")}
            >
              <span className="sub-icon"><Icon name="chart" /></span> Dashboard
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("admin-subjects")}
            >
              <span className="sub-icon"><Icon name="book" /></span> Curriculum
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("admin-users")}
            >
              <span className="sub-icon"><Icon name="user" /></span> Users
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("admin-sessions")}
            >
              <span className="sub-icon"><Icon name="chat" /></span> Sessions
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("admin-tutors")}
            >
              <span className="sub-icon"><Icon name="robot" /></span> Tutors
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("learning-system")}
            >
              <span className="sub-icon"><Icon name="puzzle" /></span> Learning System
            </div>
          </div>

          {/* Bulk Generator (expandable) */}
          <div
            className={`nav-sidebar-item${isImagesActive ? " active" : ""}${openSections.images ? " open" : ""}`}
            onClick={() => toggleSection("images")}
            title="Bulk Generator"
          >
            <span className="nav-icon"><Icon name="geometry" /></span>
            <span className="nav-label">Bulk Generator</span>
            <span className="nav-arrow">&#9654;</span>
          </div>
          <div className={`nav-submenu${openSections.images ? " open" : ""}`}>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("distillations-dashboard")}
            >
              <span className="sub-icon"><Icon name="chart" /></span> Dashboard
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("distillations-review")}
            >
              <span className="sub-icon"><Icon name="sprout" /></span> Pipeline
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("distillations-images")}
            >
              <span className="sub-icon"><Icon name="user" /></span> Image Review
            </div>
          </div>

          {/* Curriculum (expandable) */}
          <div
            className={`nav-sidebar-item${isCurriculumActive ? " active" : ""}${openSections.curriculum ? " open" : ""}`}
            onClick={() => toggleSection("curriculum")}
            title="Curriculum"
          >
            <span className="nav-icon"><Icon name="curriculum" /></span>
            <span className="nav-label">Curriculum</span>
            <span className="nav-arrow">&#9654;</span>
          </div>
          <div className={`nav-submenu${openSections.curriculum ? " open" : ""}`}>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("curriculum-audit")}
            >
              <span className="sub-icon"><Icon name="audit" /></span> Audit
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("curriculum-builder")}
            >
              <span className="sub-icon"><Icon name="puzzle" /></span> Builder
            </div>
            <div
              className="nav-sub-item"
              onClick={() => handleNav("metaphor-review")}
            >
              <span className="sub-icon"><Icon name="sprout" /></span> Metaphor Review
            </div>
          </div>
        </div>

        <div className="nav-sidebar-footer">
          <button className="logout-sidebar-btn" onClick={handleLogout} title="Sign Out">
            <span className="nav-icon"><Icon name="logout" /></span>
            <span className="nav-label">Sign Out</span>
          </button>
        </div>
      </nav>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="nav-sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </>
  );
}
