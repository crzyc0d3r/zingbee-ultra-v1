"use client";

import { useState, useRef, useEffect, memo } from "react";
import { ExecStepItem, getStepClass } from "./ExecStep";
import { StatsBar } from "./StatsBar";
import { useTimerDisplay } from "@/hooks/use-session-timer";

interface ExecLogEntry {
  step: string;
  details: string;
  agent?: string;
  timestamp?: string;
}

interface ExecPanelProps {
  execLog: ExecLogEntry[];
  factsState: { taught: number; assessed: number; mastered: number };
  totalFacts: number;
  tokenCount: number;
  questionsAsked: number;
  correctAnswers: number;
  timerRunning: boolean;
  sessionActive: boolean;
  onEndSession: () => void;
  onShowDetails: () => void;
  onExecStepClick: (entry: ExecLogEntry) => void;
  isLoading: boolean;
}

/** Self-contained timer display — only this component re-renders on tick. */
function TimerDisplay({ running }: { running: boolean }) {
  const { formatted, formattedMs } = useTimerDisplay();

  const formatDate = () => {
    const now = new Date();
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
  };

  return (
    <div
      className={`session-timer${!running ? " paused" : ""}`}
      id="sessionTimer"
    >
      <div className="session-timer-date" id="sessionTimerDate">
        {running ? formatDate() : ""}
      </div>
      <span className="session-timer-clock" id="sessionTimerClock">
        {formatted}
      </span>
      <span className="session-timer-ms" id="sessionTimerMs">
        {formattedMs}
      </span>
    </div>
  );
}

export function ExecPanel({
  execLog,
  factsState,
  totalFacts,
  tokenCount,
  questionsAsked,
  correctAnswers,
  timerRunning,
  sessionActive,
  onEndSession,
  onShowDetails,
  onExecStepClick,
  isLoading,
}: ExecPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // Track whether user has scrolled away from the bottom
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 60;
      isNearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll exec log only when user is already near the bottom
  useEffect(() => {
    if (logRef.current && isNearBottomRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [execLog]);

  return (
    <div className="exec-panel-wrap" id="execPanelWrap">
      <button
        className="panel-toggle"
        id="panelToggle"
        onClick={() => setCollapsed(!collapsed)}
        title="Toggle panel"
      >
        {collapsed ? "\u25C0" : "\u25B6"}
      </button>
      <div
        className={`exec-panel${collapsed ? " collapsed" : ""}`}
        id="execPanel"
      >
        <div className="exec-header">
          <StatsBar
            factsState={factsState}
            totalFacts={totalFacts}
            tokenCount={tokenCount}
            questionsAsked={questionsAsked}
            correctAnswers={correctAnswers}
          />
          <TimerDisplay running={timerRunning} />
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "8px",
              marginTop: "8px",
            }}
          >
            {sessionActive && (
              <button
                className="session-btn stop"
                id="stopBtn"
                onClick={onEndSession}
                disabled={isLoading}
              >
                End Session
              </button>
            )}
            <button
              className="reset-btn"
              id="detailsBtn"
              onClick={onShowDetails}
              disabled={isLoading}
            >
              Details
            </button>
          </div>
        </div>

        <div className="exec-log" id="execLog" ref={logRef} style={{ willChange: "transform" }}>
          {execLog.slice(-50).map((entry, i) => (
            <ExecStepItem
              key={execLog.length - 50 + i}
              name={entry.step}
              details={entry.details}
              className={getStepClass(entry.step)}
              agent={entry.agent}
              timestamp={entry.timestamp}
              onClick={() => onExecStepClick(entry)}
            />
          ))}
          {execLog.length > 50 && (
            <div style={{ color: "#666", fontSize: "11px", padding: "4px 8px", textAlign: "center" }}>
              Showing last 50 of {execLog.length} events
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
