"use client";

import { useState } from "react";
import { escapeHtml } from "@/lib/markdown";

interface EndSessionPanelProps {
  visible: boolean;
  data: any;
  onClose: (sentiment: string | null, comment: string) => void;
}

export function EndSessionPanel({ visible, data, onClose }: EndSessionPanelProps) {
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  if (!visible || !data) return null;

  const s = data.session || {};
  const k = data.knowledge || {};
  const mins = Math.floor((s.duration_seconds || 0) / 60);
  const secs = (s.duration_seconds || 0) % 60;
  const accuracy = s.accuracy || 0;
  const caps = data.capsules_covered || [];
  const dbFacts = data.db_fact_progress || [];
  const memFacts = data.fact_details || [];
  const completed = k.completed_capsules || [];
  const credits = k.total_credits || 0;

  let nextHtml = "";
  if (k.curriculum_complete) {
    nextHtml = "Curriculum complete! All capsules mastered.";
  } else {
    nextHtml = `Current step: <strong>${escapeHtml(k.current_step || "--")}</strong>`;
    if (k.next_capsule)
      nextHtml += `<br>Next capsule: <strong>${escapeHtml(k.next_capsule)}</strong>`;
    if (completed.length) nextHtml += `<br>Completed capsules: ${completed.length}`;
    if (credits) nextHtml += ` | Total credits: ${credits}`;
  }

  const handleClose = () => {
    onClose(sentiment, comment);
    setSentiment(null);
    setComment("");
  };

  // Fact table rows
  let factRows: React.ReactNode;
  if (dbFacts.length) {
    factRows = dbFacts.map((f: any, i: number) => {
      const status = f.is_mastered
        ? "mastered"
        : f.is_assessed
          ? "assessed"
          : f.is_taught
            ? "taught"
            : f.is_introduced
              ? "introduced"
              : "not_started";
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      const total = f.correct_count + f.incorrect_count;
      const acc = total > 0 ? Math.round((f.correct_count / total) * 100) : null;
      return (
        <tr key={i}>
          <td>{f.fact_text}</td>
          <td>
            <span className={`es-badge ${status}`}>{label}</span>
          </td>
          <td style={{ textAlign: "center" }}>{f.exposure_count}</td>
          <td style={{ textAlign: "center" }}>
            {acc != null ? `${acc}%` : "--"}
          </td>
        </tr>
      );
    });
  } else if (memFacts.length) {
    factRows = memFacts.map((f: any, i: number) => (
      <tr key={i}>
        <td>{f.fact}</td>
        <td>
          <span className={`es-badge ${f.status}`}>
            {f.status.charAt(0).toUpperCase() + f.status.slice(1)}
          </span>
        </td>
        <td style={{ textAlign: "center" }}>--</td>
        <td style={{ textAlign: "center" }}>--</td>
      </tr>
    ));
  } else {
    factRows = (
      <tr>
        <td colSpan={4} style={{ textAlign: "center", color: "#475569" }}>
          No fact data for this session
        </td>
      </tr>
    );
  }

  return (
    <div className={`end-session-panel${visible ? " visible" : ""}`} id="endSessionPanel">
      <div className="es-header">
        <h2>Session Complete</h2>
        <div className="es-subject" id="esSubject">
          {data.subject || "Session"} with {data.tutor_name || "Tutor"} |{" "}
          {mins}m {secs}s
        </div>
      </div>

      <div className="es-stats-grid" id="esStatsGrid">
        <div className="es-stat-card">
          <div className="es-stat-value">
            {mins}:{String(secs).padStart(2, "0")}
          </div>
          <div className="es-stat-label">Duration</div>
        </div>
        <div className="es-stat-card">
          <div className="es-stat-value">{s.questions_answered || 0}</div>
          <div className="es-stat-label">Questions</div>
        </div>
        <div className="es-stat-card highlight">
          <div className="es-stat-value">{accuracy}%</div>
          <div className="es-stat-label">Accuracy</div>
        </div>
        <div className="es-stat-card">
          <div className="es-stat-value">{s.facts_taught || 0}</div>
          <div className="es-stat-label">Facts Learned</div>
        </div>
      </div>

      {caps.length > 0 && (
        <div className="es-section" id="esCapsuleSection">
          <div className="es-section-title">Capsules Covered</div>
          <div id="esCapsuleList">
            {caps.map((c: string, i: number) => (
              <div key={i} className="es-capsule-item">
                <span className="es-capsule-name">{c}</span>
                <span className="es-badge taught">Covered</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="es-section" id="esFactSection">
        <div className="es-section-title">Fact Progression</div>
        <table className="es-fact-table">
          <thead>
            <tr>
              <th>Fact</th>
              <th>Status</th>
              <th>Exposures</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody id="esFactBody">{factRows}</tbody>
        </table>
      </div>

      <div className="es-section" id="esNextSection">
        <div className="es-section-title">Next Steps</div>
        <div
          id="esNextSteps"
          style={{ color: "#94a3b8", fontSize: "13px", lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: nextHtml }}
        />
      </div>

      <div className="es-feedback-section">
        <label>How was this session?</label>
        <div className="es-fb-btns">
          <button
            className={`es-fb-btn${sentiment === "positive" ? " active-pos" : ""}`}
            onClick={() => setSentiment("positive")}
          >
            {"\uD83D\uDC4D"} Good
          </button>
          <button
            className={`es-fb-btn${sentiment === "negative" ? " active-neg" : ""}`}
            onClick={() => setSentiment("negative")}
          >
            {"\uD83D\uDC4E"} Needs Work
          </button>
          <button
            className={`es-fb-btn${sentiment === "question" ? " active-question" : ""}`}
            onClick={() => setSentiment("question")}
          >
            {"\u2753"} Question
          </button>
          <button
            className={`es-fb-btn${sentiment === "idea" ? " active-idea" : ""}`}
            onClick={() => setSentiment("idea")}
          >
            {"\uD83D\uDCA1"} Suggestion
          </button>
        </div>
        <textarea
          className="es-fb-comment"
          id="esFbComment"
          placeholder={
            sentiment === "question"
              ? "What would you like to ask about this session?"
              : sentiment === "idea"
                ? "Share your suggestion or idea..."
                : "Optional: share feedback about this session..."
          }
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <button className="es-ok-btn" id="esOkBtn" onClick={handleClose}>
        OK
      </button>
    </div>
  );
}
