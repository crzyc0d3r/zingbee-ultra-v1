"use client";

import type { VocabTerm } from "@/hooks/use-chat-stream";

/**
 * Debug view of the server-derived Vocabulary Bank (ADO #25). This is the
 * testing surface for verifying term timing against the capsule-completion
 * checklist: each term appears the moment its fact enters TEACH, and during
 * CHECK/EVIDENCE the definitions are masked server-side (definitionsHidden).
 * Deliberately plain — no age tiers, no pinning; the point is to see the raw
 * payload.
 */

const STATUS_DOT: Record<VocabTerm["status"], string> = {
  current: "#2563eb", // blue
  taught: "#64748b", // slate
  mastered: "#16a34a", // green
};

export function VocabBankPanel({
  terms,
  definitionsHidden,
}: {
  terms: VocabTerm[];
  definitionsHidden?: boolean;
}) {
  if (!terms?.length) return null;

  return (
    <div className="vocab-debug-panel" style={{ padding: "8px 12px", borderTop: "1px solid #e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: 12, color: "#334155" }}>
          Vocabulary Bank ({terms.length})
        </strong>
        {definitionsHidden && (
          <span style={{ fontSize: 10, color: "#b45309", background: "#fffbeb", padding: "1px 6px", borderRadius: 4 }}>
            definitions masked (assessment)
          </span>
        )}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {terms.map((v) => (
          <li key={`${v.fact_id}:${v.term}`} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12 }}>
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[v.status], flexShrink: 0, marginTop: 4 }}
            />
            <span style={{ fontSize: 9, color: "#94a3b8", minWidth: 52 }}>{v.status}</span>
            <span style={{ fontWeight: 600, color: "#1e293b" }}>{v.term}</span>
            {v.definition && <span style={{ color: "#64748b" }}>— {v.definition}</span>}
            <span style={{ marginLeft: "auto", fontSize: 9, color: "#cbd5e1" }} title={v.fact_id}>
              {v.fact_id.slice(0, 8)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
