"use client";

import React, { useState } from "react";
import type { PhaseData, CapsuleDetail, FactDetail } from "./types";

interface Props {
  phaseDetail: Record<string, Record<string, PhaseData>>;
}

// Enrichment fields shown as numbered lists under each fact
const LIST_FIELDS: { key: keyof FactDetail; label: string; icon: string }[] = [
  { key: "vocabulary", label: "Vocabulary", icon: "Aa" },
  { key: "processes", label: "Processes", icon: "\u2699" },
  { key: "applications", label: "Applications", icon: "\u26A1" },
  { key: "micro_checks", label: "Micro Checks", icon: "\u2713" },
];

// Fields that always live at the capsule level
const CAPSULE_ONLY_FIELDS: { key: keyof CapsuleDetail; label: string }[] = [
  { key: "d_evidence", label: "Evidence" },
  { key: "d_stretch", label: "Stretch" },
];

// All enrichment fields at capsule level (used as fallback when facts_data is missing)
const ALL_CAPSULE_FIELDS: { key: keyof CapsuleDetail; label: string }[] = [
  { key: "d_processes", label: "Processes" },
  { key: "d_applications", label: "Applications" },
  { key: "d_misconceptions", label: "Misconceptions" },
  { key: "d_micro_checks", label: "Micro Checks" },
  { key: "d_evidence", label: "Evidence" },
  { key: "d_stretch", label: "Stretch" },
  { key: "d_vocabulary", label: "Vocabulary" },
];

function countColor(n: number, good = 3): string {
  if (n === 0) return "#f87171";
  if (n < good) return "#fbbf24";
  return "#2dd4bf";
}

function formatItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    if (obj.wrong && obj.correct) return `${obj.wrong} \u2192 ${obj.correct}`;
    if (obj.question) return String(obj.question);
  }
  return JSON.stringify(item);
}

// Count total enrichment items for a fact
function factEnrichCount(fact: FactDetail): number {
  let n = 0;
  for (const k of ["vocabulary", "processes", "applications", "misconceptions", "micro_checks"] as (keyof FactDetail)[]) {
    const arr = fact[k];
    if (Array.isArray(arr)) n += arr.length;
  }
  return n;
}

// --- Sub-components for per-fact enrichment sections ---

function MisconceptionsTable({ items }: { items: unknown[] }) {
  // Detect format: new extended {misconception, correct_understanding, why_wrong, prevalence}
  const hasExtended = items.some((it) => typeof it === "object" && it !== null && "misconception" in (it as Record<string, unknown>));
  // Legacy format: {wrong, correct}
  const hasLegacy = items.some((it) => typeof it === "object" && it !== null && "wrong" in (it as Record<string, unknown>));

  if (hasExtended) {
    return (
      <table className="sf-misc-table">
        <thead>
          <tr><th>#</th><th>Misconception</th><th>Correct Understanding</th><th>Why Wrong</th><th>Prevalence</th></tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const obj = it as Record<string, unknown>;
            return (
              <tr key={i}>
                <td className="sf-misc-num">{i + 1}</td>
                <td className="sf-misc-wrong">{String(obj.misconception || "")}</td>
                <td className="sf-misc-correct">{String(obj.correct_understanding || "")}</td>
                <td className="sf-misc-why">{String(obj.why_wrong || "")}</td>
                <td className="sf-misc-prevalence">{String(obj.prevalence || "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  if (hasLegacy) {
    return (
      <table className="sf-misc-table">
        <thead>
          <tr><th>#</th><th>Wrong</th><th>Correct</th></tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const obj = it as Record<string, unknown>;
            return (
              <tr key={i}>
                <td className="sf-misc-num">{i + 1}</td>
                <td className="sf-misc-wrong">{String(obj.wrong || "")}</td>
                <td className="sf-misc-correct">{String(obj.correct || "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // Fallback: string misconceptions as numbered list
  return (
    <ol className="sf-list">
      {items.map((it, i) => <li key={i}>{formatItem(it)}</li>)}
    </ol>
  );
}

function VocabularyTable({ items }: { items: unknown[] }) {
  const hasExtended = items.some((it) => typeof it === "object" && it !== null && "term" in (it as Record<string, unknown>));
  if (hasExtended) {
    return (
      <table className="sf-vocab-table">
        <thead>
          <tr><th>#</th><th>Term</th><th>Definition</th><th>Context</th></tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const obj = it as Record<string, unknown>;
            return (
              <tr key={i}>
                <td className="sf-vocab-num">{i + 1}</td>
                <td className="sf-vocab-term">{String(obj.term || "")}</td>
                <td className="sf-vocab-def">{String(obj.definition || "")}</td>
                <td className="sf-vocab-ctx">{String(obj.context_sentence || "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  return (
    <ol className="sf-list">
      {items.map((it, i) => <li key={i}>{formatItem(it)}</li>)}
    </ol>
  );
}

function MicroChecksList({ items }: { items: unknown[] }) {
  return (
    <ol className="sf-list">
      {items.map((it, i) => <li key={i}>{formatItem(it)}</li>)}
    </ol>
  );
}

function FactSection({ label, icon, fieldKey, items }: { label: string; icon: string; fieldKey: string; items: unknown[] }) {
  const [open, setOpen] = useState(false);
  if (fieldKey === "misconceptions") {
    return (
      <div className="sf-section">
        <div className="sf-section-head" onClick={() => setOpen(!open)}>
          <span className="sf-section-caret">{open ? "\u25BC" : "\u25B6"}</span>
          <span className="sf-section-icon">{icon}</span>
          <span className="sf-section-label">{label}</span>
          <span className="sf-section-count">{items.length}</span>
        </div>
        {open && <MisconceptionsTable items={items} />}
      </div>
    );
  }
  if (fieldKey === "vocabulary") {
    return (
      <div className="sf-section">
        <div className="sf-section-head" onClick={() => setOpen(!open)}>
          <span className="sf-section-caret">{open ? "\u25BC" : "\u25B6"}</span>
          <span className="sf-section-icon">{icon}</span>
          <span className="sf-section-label">{label}</span>
          <span className="sf-section-count">{items.length}</span>
        </div>
        {open && <VocabularyTable items={items} />}
      </div>
    );
  }
  if (fieldKey === "micro_checks") {
    return (
      <div className="sf-section">
        <div className="sf-section-head" onClick={() => setOpen(!open)}>
          <span className="sf-section-caret">{open ? "\u25BC" : "\u25B6"}</span>
          <span className="sf-section-icon">{icon}</span>
          <span className="sf-section-label">{label}</span>
          <span className="sf-section-count">{items.length}</span>
        </div>
        {open && <MicroChecksList items={items} />}
      </div>
    );
  }
  return (
    <div className="sf-section">
      <div className="sf-section-head" onClick={() => setOpen(!open)}>
        <span className="sf-section-caret">{open ? "\u25BC" : "\u25B6"}</span>
        <span className="sf-section-icon">{icon}</span>
        <span className="sf-section-label">{label}</span>
        <span className="sf-section-count">{items.length}</span>
      </div>
      {open && (
        <ol className="sf-list">
          {items.map((it, i) => <li key={i}>{formatItem(it)}</li>)}
        </ol>
      )}
    </div>
  );
}

function ExpandableFact({ fact, index }: { fact: FactDetail; index: number }) {
  const [open, setOpen] = useState(false);
  const enrichCount = factEnrichCount(fact);
  const misconceptions = Array.isArray(fact.misconceptions) && fact.misconceptions.length > 0 ? fact.misconceptions : null;

  return (
    <div className={`sf-fact ${open ? "sf-fact-open" : ""}`}>
      <div className="sf-fact-head" onClick={() => setOpen(!open)}>
        <span className="sf-fact-caret">{open ? "\u25BC" : "\u25B6"}</span>
        <span className="sf-fact-num">{index + 1}.</span>
        <span className="sf-fact-text">{fact.text}</span>
        {enrichCount > 0 && <span className="sf-fact-badge">{enrichCount}</span>}
      </div>
      {open && (
        <div className="sf-fact-body">
          {/* Standard list fields */}
          {LIST_FIELDS.map(({ key, label, icon }) => {
            const items = fact[key];
            if (!Array.isArray(items) || items.length === 0) return null;
            return <FactSection key={key} label={label} icon={icon} fieldKey={key} items={items} />;
          })}
          {/* Misconceptions as table */}
          {misconceptions && (
            <FactSection label="Misconceptions" icon="\u26A0" fieldKey="misconceptions" items={misconceptions} />
          )}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

export function SubjectDetailTab({ phaseDetail }: Props) {
  const subjects = Object.keys(phaseDetail).sort();
  const [activeSubject, setActiveSubject] = useState(subjects[0] || "");
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandedCapsules, setExpandedCapsules] = useState<Set<string>>(new Set());

  const togglePhase = (key: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleCapsule = (key: string) => {
    setExpandedCapsules((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const phases = activeSubject ? phaseDetail[activeSubject] : {};
  const sortedPhases = Object.entries(phases || {}).sort(
    ([a], [b]) => Number(a) - Number(b)
  );

  return (
    <div className="sd">
      <div className="sd-tabs">
        {subjects.map((s) => (
          <button
            key={s}
            className={`sd-tab ${s === activeSubject ? "sd-tab-active" : ""}`}
            onClick={() => { setActiveSubject(s); setExpandedPhases(new Set()); setExpandedCapsules(new Set()); }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="sd-content">
        {sortedPhases.map(([phaseNum, phaseData]) => {
          const phaseKey = `${activeSubject}-${phaseNum}`;
          const phaseOpen = expandedPhases.has(phaseKey);
          const themeCount = Object.keys(phaseData.themes).length;
          const capsuleCount = Object.values(phaseData.themes).reduce((n, c) => n + c.length, 0);
          return (
          <div key={phaseNum} className="sd-phase">
            <div className="sd-phase-head sd-phase-toggle" onClick={() => togglePhase(phaseKey)}>
              <span className="sd-phase-caret">{phaseOpen ? "\u25BC" : "\u25B6"}</span>
              Phase {phaseNum}
              {phaseData.age_range && <span className="sd-age">Ages {phaseData.age_range}</span>}
              {!phaseOpen && <span className="sd-phase-summary">{themeCount} themes, {capsuleCount} capsules</span>}
            </div>
            {phaseOpen && Object.entries(phaseData.themes).map(([themeName, capsules]) => (
              <div key={themeName} className="sd-theme">
                <div className="sd-theme-name">{themeName}</div>
                <table className="sd-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Capsule</th>
                      <th>Facts</th>
                      <th>Proc</th>
                      <th>App</th>
                      <th>Misc</th>
                      <th>Micro</th>
                      <th>Evid</th>
                      <th>Str</th>
                      <th>Vocab</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capsules.map((cap) => {
                      const key = `${activeSubject}-${phaseNum}-${themeName}-${cap.order}`;
                      const open = expandedCapsules.has(key);
                      return (
                        <React.Fragment key={key}>
                          <tr
                            className={`sd-row ${open ? "sd-row-open" : ""}`}
                            onClick={() => toggleCapsule(key)}
                            style={{ cursor: "pointer" }}
                          >
                            <td>{cap.order}</td>
                            <td className="sd-cap-name">
                              {cap.name}
                              <span className="sd-arrow">{open ? " \u25B4" : " \u25BE"}</span>
                            </td>
                            <td style={{ color: countColor(cap.facts, 4) }}>{cap.facts}</td>
                            <td style={{ color: countColor(cap.n_processes) }}>{cap.n_processes}</td>
                            <td style={{ color: countColor(cap.n_applications) }}>{cap.n_applications}</td>
                            <td style={{ color: countColor(cap.n_misconceptions, 2) }}>{cap.n_misconceptions}</td>
                            <td style={{ color: countColor(cap.n_micro_checks) }}>{cap.n_micro_checks}</td>
                            <td style={{ color: countColor(cap.n_evidence) }}>{cap.n_evidence}</td>
                            <td style={{ color: countColor(cap.n_stretch, 2) }}>{cap.n_stretch}</td>
                            <td style={{ color: countColor(cap.n_vocabulary) }}>{cap.n_vocabulary}</td>
                          </tr>
                          {open && (
                            <tr className="sd-detail-row">
                              <td colSpan={10}>
                                <div className="sd-detail">
                                  {cap.facts_data && cap.facts_data.length > 0 ? (
                                    <>
                                      {/* Expandable per-fact detail */}
                                      <div className="sf-facts">
                                        {cap.facts_data.map((fact, fi) => (
                                          <ExpandableFact key={fi} fact={fact} index={fi} />
                                        ))}
                                      </div>
                                      {/* Capsule-only fields (evidence, stretch) */}
                                      {CAPSULE_ONLY_FIELDS.map(({ key: fKey, label }) => {
                                        const items = cap[fKey];
                                        if (!Array.isArray(items) || items.length === 0) return null;
                                        return (
                                          <div key={fKey} className="sd-detail-section">
                                            <div className="sd-detail-label">{label} ({items.length})</div>
                                            <ol className="sd-detail-list">
                                              {items.map((item, i) => <li key={i}>{formatItem(item)}</li>)}
                                            </ol>
                                          </div>
                                        );
                                      })}
                                    </>
                                  ) : (
                                    <>
                                      {/* Fallback: show facts as list + aggregated capsule-level enrichment */}
                                      {cap.facts_text.length > 0 && (
                                        <div className="sd-detail-section">
                                          <div className="sd-detail-label">Facts ({cap.facts})</div>
                                          <ol className="sd-detail-list">
                                            {cap.facts_text.map((f, i) => <li key={i}>{f}</li>)}
                                          </ol>
                                        </div>
                                      )}
                                      {ALL_CAPSULE_FIELDS.map(({ key: fKey, label }) => {
                                        const items = cap[fKey];
                                        if (!Array.isArray(items) || items.length === 0) return null;
                                        return (
                                          <div key={fKey} className="sd-detail-section">
                                            <div className="sd-detail-label">{label} ({items.length})</div>
                                            <ol className="sd-detail-list">
                                              {items.map((item, i) => <li key={i}>{formatItem(item)}</li>)}
                                            </ol>
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          );
        })}
      </div>
    </div>
  );
}
