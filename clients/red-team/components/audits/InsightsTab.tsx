"use client";

import { useState, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import type { AuditInsight, AuditSummary } from "./types";

interface Props {
  auditId: string;
  insights?: AuditInsight[];
  onInsightsGenerated: (insights: AuditInsight[], summary?: AuditSummary) => void;
}

const SEV_META: Record<string, { color: string; bg: string; label: string }> = {
  strength:   { color: "#4ade80", bg: "rgba(74,222,128,.1)",  label: "STRENGTH" },
  suggestion: { color: "#fbbf24", bg: "rgba(251,191,36,.1)",  label: "SUGGESTION" },
  concern:    { color: "#f472b6", bg: "rgba(244,114,182,.1)", label: "CONCERN" },
};

// 4-level grouping: subject > phase > theme > capsule
type CapsuleGroup = AuditInsight[];
type ThemeGroup = Record<string, CapsuleGroup>;
type PhaseGroup = Record<string, ThemeGroup>;
type SubjectGroup = Record<string, PhaseGroup>;

function buildTree(items: AuditInsight[]): SubjectGroup {
  const tree: SubjectGroup = {};
  for (const ins of items) {
    const theme = ins.theme || "(Phase-level)";
    const capsule = ins.capsule || "(Theme-level)";
    ((((tree[ins.subject] ??= {})[ins.phase] ??= {})[theme] ??= {})[capsule] ??= []).push(ins);
  }
  return tree;
}

function InsightCard({ ins }: { ins: AuditInsight }) {
  const meta = SEV_META[ins.severity] ?? SEV_META.suggestion;
  return (
    <div className="ins-card" style={{ borderLeftColor: meta.color, background: meta.bg }}>
      <div className="ins-card-head">
        <span className="ins-sev" style={{ color: meta.color }}>{meta.label}</span>
      </div>
      <div className="ins-card-title">{ins.title}</div>
      <div className="ins-card-detail">{ins.detail}</div>
    </div>
  );
}

const sorted = (obj: Record<string, unknown>) =>
  Object.keys(obj).sort((a, b) => a.localeCompare(b));

function countInsights(phases: PhaseGroup): number {
  let n = 0;
  for (const themes of Object.values(phases))
    for (const capsules of Object.values(themes))
      for (const items of Object.values(capsules)) n += items.length;
  return n;
}

function countPhaseInsights(themes: ThemeGroup): number {
  let n = 0;
  for (const capsules of Object.values(themes))
    for (const items of Object.values(capsules)) n += items.length;
  return n;
}

function PhaseAccordion({ subject, phases }: { subject: string; phases: PhaseGroup }) {
  const [openPhases, setOpenPhases] = useState<Set<string>>(new Set());
  const toggle = (phase: string) =>
    setOpenPhases((prev) => {
      const next = new Set(prev);
      next.has(phase) ? next.delete(phase) : next.add(phase);
      return next;
    });

  return (
    <div className="ins-subject">
      <div className="ins-subject-name">
        {subject}
        <span className="ins-subject-count">{countInsights(phases)} insights</span>
      </div>
      {sorted(phases).map((phase) => {
        const open = openPhases.has(phase);
        const phaseCount = countPhaseInsights(phases[phase]);
        return (
          <div key={phase} className="ins-phase">
            <div className="ins-phase-head" onClick={() => toggle(phase)}>
              <span className="ins-phase-caret">{open ? "\u25B4" : "\u25BE"}</span>
              <span className="ins-phase-label">{phase}</span>
              <span className="ins-phase-count">{phaseCount}</span>
            </div>
            {open && (
              <div className="ins-phase-body">
                {sorted(phases[phase]).map((theme) => (
                  <div key={theme} className="ins-theme">
                    <div className="ins-theme-name">{theme}</div>
                    {sorted(phases[phase][theme]).map((capsule) => (
                      <div key={capsule} className="ins-capsule">
                        {capsule !== "(Theme-level)" && (
                          <div className="ins-capsule-name">{capsule}</div>
                        )}
                        <div className="ins-cards">
                          {phases[phase][theme][capsule].map((ins, idx) => (
                            <InsightCard key={idx} ins={ins} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function InsightsTab({ auditId, insights, onInsightsGenerated }: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSev, setFilterSev] = useState<string>("all");
  const [filterSubj, setFilterSubj] = useState<string>("all");

  const subjects = useMemo(
    () => [...new Set((insights ?? []).map((i) => i.subject))].sort(),
    [insights],
  );

  const filtered = useMemo(() => {
    if (!insights) return [];
    return insights.filter((i) => {
      if (filterSev !== "all" && i.severity !== filterSev) return false;
      if (filterSubj !== "all" && i.subject !== filterSubj) return false;
      return true;
    });
  }, [insights, filterSev, filterSubj]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // Streaming response with heartbeat pings — collect full body then parse JSON
      const resp = await fetch(`/api/curriculum-audits/${auditId}/generate-insights`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok && !resp.body) throw new Error(`Request failed: ${resp.status}`);
      const raw = await resp.text();
      console.log("[Insights] raw response length:", raw.length, "first 200:", raw.slice(0, 200));
      const jsonStr = raw.replace(/^ +/, "").trim();
      const res = JSON.parse(jsonStr);
      if (res.error) throw new Error(res.error);
      console.log("[Insights] parsed", res.insights?.length, "insights");
      onInsightsGenerated(res.insights, res.summary);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate insights";
      console.error("[Insights] error:", e);
      setError(msg === "Failed to fetch"
        ? "Connection lost during insight generation. The AI analysis may take up to 3 minutes — please try again."
        : msg);
    } finally {
      setGenerating(false);
    }
  };

  if (!insights || insights.length === 0) {
    return (
      <div className="ins-empty">
        <div className="ins-empty-icon">&#9733;</div>
        <div className="ins-empty-title">AI Insights</div>
        <div className="ins-empty-desc">
          Generate a step-by-step curriculum analysis using Claude AI.
          Every phase, theme, and capsule is evaluated for fact density,
          field completeness, pedagogical sequencing, and content quality.
        </div>
        {error && <div className="ins-error">{error}</div>}
        <button className="ins-generate-btn" onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating..." : "Generate Insights"}
        </button>
        {generating && (
          <div className="ins-generating">
            <div className="audit-generating-spinner" />
            <span>Analyzing every capsule with Claude Opus... this may take 1-2 minutes.</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ins">
      <div className="it-filters">
        <select value={filterSev} onChange={(e) => setFilterSev(e.target.value)}>
          <option value="all">All Types</option>
          <option value="strength">Strengths</option>
          <option value="suggestion">Suggestions</option>
          <option value="concern">Concerns</option>
        </select>
        <select value={filterSubj} onChange={(e) => setFilterSubj(e.target.value)}>
          <option value="all">All Subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="it-count">
          {filtered.length} insight{filtered.length !== 1 ? "s" : ""}
        </span>
        <button
          className="ins-refresh-btn"
          onClick={handleGenerate}
          disabled={generating}
          title="Regenerate insights"
        >
          {generating ? "..." : "\u21BB"}
        </button>
        {generating && (
          <div className="ins-generating">
            <div className="audit-generating-spinner" />
            <span>Regenerating...</span>
          </div>
        )}
        {error && <div className="ins-error">{error}</div>}
      </div>

      {sorted(tree).map((subject) => (
        <PhaseAccordion key={subject} subject={subject} phases={tree[subject]} />
      ))}

      {filtered.length === 0 && (
        <div className="it-empty">No insights match the current filters.</div>
      )}
    </div>
  );
}
