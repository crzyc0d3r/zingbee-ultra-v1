"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";

// ---------- types ----------
interface FactData {
  fact_id: string;
  fact_text: string;
  is_taught: boolean;
  is_assessed: boolean;
  is_mastered: boolean;
  exposure_count: number;
  correct_count: number;
  incorrect_count: number;
}

interface CapsuleData {
  capsule_name: string;
  status: string;
  total_facts: number;
  mastered_count: number;
  taught_count: number;
  total_exposures: number;
  total_correct: number;
  total_incorrect: number;
  credits: number;
  accuracy: number;
  facts?: FactData[];
}

interface ThemeData {
  theme_name: string;
  total_capsules: number;
  completed_capsules: number;
  total_facts: number;
  mastered_facts: number;
  capsules: CapsuleData[];
}

interface PhaseData {
  phase: number;
  total_facts: number;
  mastered_facts: number;
  taught_facts: number;
  total_capsules: number;
  completed_capsules: number;
  themes: ThemeData[];
}

interface SubjectSummary {
  total_facts: number;
  mastered_facts: number;
  taught_facts: number;
  total_capsules: number;
  completed_capsules: number;
  total_credits: number;
  total_exposures: number;
}

interface SubjectSection {
  subject: string;
  subject_id: string;
  summary: SubjectSummary;
  phases: PhaseData[];
}

// Response shape when ?subject=all (preferred): { student_name, subjects[] }
// Legacy shape (single subject): { student_name, subject, summary, phases }
interface ReportCardAllResponse {
  student_name: string;
  subjects?: SubjectSection[];
  subject?: string;
  summary?: SubjectSummary;
  phases?: PhaseData[];
}

// ---------- sub-components ----------

function ProgressBar({ value, max, color = "#3b82f6", height = 6 }: {
  value: number; max: number; color?: string; height?: number;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ background: "#1e293b", borderRadius: height / 2, height, width: "100%", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: height / 2, transition: "width 0.4s ease" }} />
    </div>
  );
}

function MiniDonut({ value, max, size = 48, stroke = 5, color = "#22c55e" }: {
  value: number; max: number; size?: number; stroke?: number; color?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circ * (1 - pct);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.5s ease" }} />
    </svg>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rc-stat">
      <div className="rc-stat-val" style={color ? { color } : undefined}>{value}</div>
      <div className="rc-stat-label">{label}</div>
      {sub && <div className="rc-stat-sub">{sub}</div>}
    </div>
  );
}

function FactRow({ f }: { f: FactData }) {
  const status = f.is_mastered ? "mastered" : f.is_assessed ? "assessed" : f.is_taught ? "taught" : "pending";
  const color = f.is_mastered ? "#22c55e" : f.is_assessed ? "#f59e0b" : f.is_taught ? "#3b82f6" : "#475569";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <div className="rc-fact-row">
      <span className="rc-fact-dot" style={{ background: color }} />
      <span className="rc-fact-text" title={f.fact_text}>{f.fact_text || f.fact_id.slice(0, 8)}</span>
      <span className="rc-fact-status" style={{ color }}>{label}</span>
      {f.exposure_count > 0 && (
        <span className="rc-fact-meta">
          {f.correct_count}/{f.exposure_count}
        </span>
      )}
    </div>
  );
}

function CapsuleRow({ c }: { c: CapsuleData }) {
  const [open, setOpen] = useState(false);
  const statusColor = c.status === "completed" ? "#22c55e" : c.status === "in_progress" ? "#f59e0b" : "#475569";
  const statusLabel = c.status === "completed" ? "Done" : c.status === "in_progress" ? "In Progress" : "Not Started";
  const hasFacts = (c.facts || []).length > 0;
  return (
    <div className={`rc-capsule-row${open ? " rc-capsule-open" : ""}`}>
      <div
        className="rc-capsule-info"
        onClick={hasFacts ? () => setOpen((v) => !v) : undefined}
        style={hasFacts ? { cursor: "pointer" } : undefined}
      >
        {hasFacts && <span className="rc-capsule-arrow">{open ? "▼" : "▶"}</span>}
        <span className="rc-capsule-dot" style={{ background: statusColor }} />
        <span className="rc-capsule-name">{c.capsule_name}</span>
        <span className="rc-capsule-status" style={{ color: statusColor }}>{statusLabel}</span>
      </div>
      <div className="rc-capsule-bars">
        <div className="rc-capsule-bar-group">
          <span className="rc-bar-label">Facts {c.mastered_count}/{c.total_facts}</span>
          <ProgressBar value={c.mastered_count} max={c.total_facts} color="#22c55e" height={4} />
        </div>
        <div className="rc-capsule-metrics">
          {c.total_exposures > 0 && <span className="rc-metric">{c.total_exposures} exp</span>}
          {(c.total_correct + c.total_incorrect) > 0 && (
            <span className="rc-metric" style={{ color: c.accuracy >= 70 ? "#22c55e" : c.accuracy >= 40 ? "#f59e0b" : "#ef4444" }}>
              {c.accuracy.toFixed(0)}% acc
            </span>
          )}
          {c.credits > 0 && <span className="rc-metric">{c.credits} cr</span>}
        </div>
      </div>
      {open && hasFacts && (
        <div className="rc-capsule-facts">
          {(c.facts || []).map((f) => <FactRow key={f.fact_id} f={f} />)}
        </div>
      )}
    </div>
  );
}

function SubjectSectionBlock({
  section,
  compact,
  expandedPhase,
  setExpandedPhase,
}: {
  section: SubjectSection;
  compact: boolean;
  expandedPhase: number | null;
  setExpandedPhase: (n: number | null) => void;
}) {
  const s = section.summary;
  const factsPct = s.total_facts > 0 ? Math.round((s.mastered_facts / s.total_facts) * 100) : 0;
  const capsulesPct = s.total_capsules > 0 ? Math.round((s.completed_capsules / s.total_capsules) * 100) : 0;

  return (
    <div className="rc-subject-section">
      <div className="rc-subject-header">
        <span className="rc-subject-badge">{section.subject}</span>
        <span className="rc-subject-stats">
          {s.mastered_facts}/{s.total_facts} facts &middot; {s.completed_capsules}/{s.total_capsules} capsules
        </span>
      </div>

      {/* Summary ring + stats */}
      <div className="rc-summary">
        <div className="rc-rings">
          <div className="rc-ring-item">
            <div style={{ position: "relative", display: "inline-block" }}>
              <MiniDonut value={s.mastered_facts} max={s.total_facts} size={compact ? 56 : 72} stroke={compact ? 5 : 6} color="#22c55e" />
              <div className="rc-ring-center">{factsPct}%</div>
            </div>
            <div className="rc-ring-label">Facts Mastered</div>
            <div className="rc-ring-detail">{s.mastered_facts}/{s.total_facts}</div>
          </div>
          <div className="rc-ring-item">
            <div style={{ position: "relative", display: "inline-block" }}>
              <MiniDonut value={s.completed_capsules} max={s.total_capsules} size={compact ? 56 : 72} stroke={compact ? 5 : 6} color="#3b82f6" />
              <div className="rc-ring-center">{capsulesPct}%</div>
            </div>
            <div className="rc-ring-label">Capsules Done</div>
            <div className="rc-ring-detail">{s.completed_capsules}/{s.total_capsules}</div>
          </div>
        </div>
        <div className="rc-stats-row">
          <StatCard label="Credits" value={s.total_credits} color="#a855f7" />
          <StatCard label="Taught" value={s.taught_facts} sub={`of ${s.total_facts}`} color="#2dd4bf" />
          <StatCard label="Exposures" value={s.total_exposures} color="#818cf8" />
        </div>
      </div>

      {/* Phase breakdown */}
      {!compact && section.phases.length > 0 && (
        <div className="rc-phases">
          <h4 className="rc-section-title">Phase Breakdown</h4>
          {section.phases.map((p) => {
            const phaseKey = p.phase;
            const isExpanded = expandedPhase === phaseKey;
            const phasePct = p.total_facts > 0 ? Math.round((p.mastered_facts / p.total_facts) * 100) : 0;
            return (
              <div key={phaseKey} className={`rc-phase${isExpanded ? " expanded" : ""}`}>
                <div className="rc-phase-header" onClick={() => setExpandedPhase(isExpanded ? null : phaseKey)}>
                  <div className="rc-phase-left">
                    <span className="rc-phase-arrow">{isExpanded ? "▼" : "▶"}</span>
                    <span className="rc-phase-label">Phase {p.phase}</span>
                    <span className="rc-phase-pct">{phasePct}%</span>
                  </div>
                  <div className="rc-phase-bar-wrap">
                    <ProgressBar value={p.mastered_facts} max={p.total_facts} color="#22c55e" height={4} />
                  </div>
                  <div className="rc-phase-counts">
                    <span>{p.completed_capsules}/{p.total_capsules} capsules</span>
                    <span>{p.mastered_facts}/{p.total_facts} facts</span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="rc-phase-body">
                    {p.themes.map((t, ti) => (
                      <div key={ti} className="rc-theme">
                        <div className="rc-theme-header">
                          <span className="rc-theme-name">{t.theme_name}</span>
                          <span className="rc-theme-count">{t.completed_capsules}/{t.total_capsules} capsules</span>
                        </div>
                        {t.capsules.map((c, ci) => (
                          <CapsuleRow key={ci} c={c} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- main component ----------

interface ReportCardProps {
  studentId: string;
  /** Reserved: when set, filter to a single subject. Defaults to all. */
  subject?: string;
  adminMode?: boolean;
  compact?: boolean;
}

export function ReportCard({ studentId, subject = "all", adminMode = false, compact = false }: ReportCardProps) {
  const [data, setData] = useState<ReportCardAllResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openSubject, setOpenSubject] = useState<string | null>(null);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    setError("");
    const url = adminMode
      ? `/admin/api/student-report-card/${studentId}?subject=${encodeURIComponent(subject)}`
      : `/api/student-report-card/${studentId}?subject=${encodeURIComponent(subject)}`;
    apiFetch<ReportCardAllResponse>(url)
      .then((d) => {
        setData(d);
        // Auto-open the subject with the most activity
        const subjects = d.subjects && d.subjects.length > 0
          ? d.subjects
          : (d.subject && d.summary && d.phases
              ? [{ subject: d.subject, subject_id: "", summary: d.summary, phases: d.phases }]
              : []);
        const active = subjects.find((s) =>
          s.summary.completed_capsules > 0 || s.summary.taught_facts > 0
        );
        const target = active || subjects[0];
        if (target) {
          setOpenSubject(target.subject);
          const activePhase = target.phases.find(
            (p) => p.completed_capsules < p.total_capsules && p.completed_capsules > 0
          );
          if (activePhase) setExpandedPhase(activePhase.phase);
          else if (target.phases.length) setExpandedPhase(target.phases[0].phase);
        }
      })
      .catch((e) => setError(e.message || "Failed to load report card"))
      .finally(() => setLoading(false));
  }, [studentId, subject, adminMode]);

  if (loading) return <div className="rc-loading">Loading report card...</div>;
  if (error) return <div className="rc-error">{error}</div>;
  if (!data) return null;

  // Normalize to a list of subject sections regardless of which shape the
  // server returned.
  const sections: SubjectSection[] = data.subjects
    ? data.subjects
    : (data.subject && data.summary && data.phases
        ? [{ subject: data.subject, subject_id: "", summary: data.summary, phases: data.phases }]
        : []);

  return (
    <div className={`rc-container${compact ? " rc-compact" : ""}`}>
      <div className="rc-header">
        <div className="rc-header-left">
          <h3 className="rc-title">{data.student_name}</h3>
        </div>
      </div>

      {sections.length === 0 && (
        <div className="rc-loading">No subject data yet for this student.</div>
      )}

      {sections.map((section) => {
        const isOpen = openSubject === section.subject;
        return (
          <div key={section.subject_id || section.subject} className={`rc-subject-wrap${isOpen ? " rc-subject-open" : ""}`}>
            <div
              className="rc-subject-toggle"
              onClick={() => setOpenSubject(isOpen ? null : section.subject)}
              style={{ cursor: "pointer" }}
            >
              <span className="rc-subject-arrow">{isOpen ? "▼" : "▶"}</span>
              <span className="rc-subject-title">{section.subject}</span>
              <span className="rc-subject-summary-inline">
                {section.summary.mastered_facts}/{section.summary.total_facts} facts &middot;{" "}
                {section.summary.completed_capsules}/{section.summary.total_capsules} capsules
              </span>
            </div>
            {isOpen && (
              <SubjectSectionBlock
                section={section}
                compact={compact}
                expandedPhase={expandedPhase}
                setExpandedPhase={setExpandedPhase}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
