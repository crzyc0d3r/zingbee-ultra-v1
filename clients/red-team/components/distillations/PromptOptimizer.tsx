"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { apiFetch } from "@/lib/api";

// --- Types ---

type PatternSeverity = "high" | "medium" | "low";

type DetectedPattern = {
  patternId: string;
  severity: number;        // float 0-1 from API
  affectedPct: number;     // float 0-1
  judgeName: string;
  description: string;
};

type Suggestion = {
  patternId: string;
  scopeType: string;
  scopeKey: string;
  strategy: string | null;
  overrideType: string;
  content: string;
  rationale: string;
  expectedImprovement: number;
};

type AnalysisResult = {
  patterns: DetectedPattern[];
  suggestions: Suggestion[];
};

type PromptOverride = {
  id: string;
  scopeType: string;
  scopeKey: string;
  promptId: string;
  strategy: string | null;
  overrideType: string;
  content: string;
  active: boolean;
  createdAt: string | null;
  source: string;
};

type PromptOptimizerProps = {
  phase: string;
  theme: string;
  capsule: string;
};

// --- Helpers ---

function toSeverityLabel(s: number): PatternSeverity {
  if (s >= 0.7) return "high";
  if (s >= 0.4) return "medium";
  return "low";
}

function readablePatternId(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const severityColor: Record<PatternSeverity, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#3b82f6",
};

const severityBg: Record<PatternSeverity, string> = {
  high: "#7f1d1d",
  medium: "#713f12",
  low: "#1e3a5f",
};

const severityLabel: Record<PatternSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// --- Component ---

export function PromptOptimizer({ phase, theme, capsule }: PromptOptimizerProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [overrides, setOverrides] = useState<PromptOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [confirmSuggestion, setConfirmSuggestion] = useState<Suggestion | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const overridesAbortRef = useRef<AbortController | null>(null);

  // Load overrides — M-12: use AbortController to cancel stale requests
  const loadOverrides = useCallback(async () => {
    overridesAbortRef.current?.abort();
    const ctrl = new AbortController();
    overridesAbortRef.current = ctrl;
    try {
      const res = await apiFetch<{ overrides: PromptOverride[] }>(
        "/distillations/api/prompt-overrides",
        { signal: ctrl.signal } as RequestInit,
      );
      if (!ctrl.signal.aborted) {
        setOverrides(res.overrides.filter((o) => o.active));
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      // Non-critical — overrides section just stays empty
    }
  }, []);

  // Run analysis
  const analyze = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const params = new URLSearchParams({ phase, theme, capsule });
      const res = await apiFetch<AnalysisResult>(
        `/distillations/api/prompt-analysis?${params.toString()}`,
      );
      setAnalysis(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [phase, theme, capsule]);

  // H-5: Apply suggestion with correct API payload
  const applySuggestion = useCallback(async (suggestion: Suggestion) => {
    setApplyingId(suggestion.patternId + suggestion.scopeKey);
    setConfirmSuggestion(null);
    setError("");
    try {
      await apiFetch("/distillations/api/prompt-analysis/apply", {
        method: "POST",
        body: JSON.stringify({
          scope_type: suggestion.scopeType,
          scope_key: suggestion.scopeKey,
          strategy: suggestion.strategy ?? null,
          override_type: suggestion.overrideType,
          content: suggestion.content,
          pattern_id: suggestion.patternId,
          rationale: suggestion.rationale,
          expected_improvement: suggestion.expectedImprovement,
        }),
      });
      setSuccess(`Applied override for "${readablePatternId(suggestion.patternId)}"`);
      await loadOverrides();
      await analyze();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to apply suggestion");
    } finally {
      setApplyingId(null);
    }
  }, [loadOverrides, analyze]);

  // Remove override
  const removeOverride = useCallback(async (id: string) => {
    setRemovingId(id);
    setError("");
    try {
      await apiFetch(`/distillations/api/prompt-overrides/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setSuccess("Override removed");
      await loadOverrides();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove override");
    } finally {
      setRemovingId(null);
    }
  }, [loadOverrides]);

  // Initial load
  useEffect(() => {
    loadOverrides();
    return () => { overridesAbortRef.current?.abort(); };
  }, [loadOverrides]);

  // Clear stale analysis when scope changes
  useEffect(() => {
    setAnalysis(null);
    setError("");
  }, [phase, theme, capsule]);

  // Clear success after 4s
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(""), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  return (
    <section className="images-panel" role="tabpanel" aria-label="Prompt Optimizer">
      <div className="images-card-head" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Prompt Optimizer</h2>
        <button
          onClick={analyze}
          disabled={loading}
          style={{
            background: loading ? "#1e293b" : "linear-gradient(135deg, #1e3a5f, #1e293b)",
            color: "#60a5fa",
            border: "1px solid #3b82f6",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 12,
            fontFamily: "inherit",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600,
            opacity: loading ? 0.6 : 1,
            transition: "all 0.15s ease",
          }}
        >
          <Icon name="lightning" /> {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {/* Messages */}
      {error && <div className="images-error" role="alert" aria-live="assertive">{error}</div>}
      {success && <div className="images-success" role="status" aria-live="polite">{success}</div>}

      {/* H-15: Confirm dialog before applying */}
      {confirmSuggestion && (
        <div style={{
          background: "#1e293b",
          border: "1px solid #f59e0b",
          borderRadius: 8,
          padding: "14px 16px",
          marginBottom: 12,
        }}>
          <div style={{ fontWeight: 600, color: "#fde68a", fontSize: 13, marginBottom: 6 }}>
            Apply "{readablePatternId(confirmSuggestion.patternId)}" override?
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
            This will write a prompt override for scope <code>{confirmSuggestion.scopeType}:{confirmSuggestion.scopeKey}</code>.
            {confirmSuggestion.scopeType === "global" && (
              <span style={{ color: "#fca5a5" }}> Global overrides require human approval before activating.</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="images-btn-approve"
              onClick={() => applySuggestion(confirmSuggestion)}
              disabled={!!applyingId}
            >
              <Icon name="check" /> Confirm Apply
            </button>
            <button
              className="images-btn-danger"
              onClick={() => setConfirmSuggestion(null)}
              style={{ opacity: 0.7 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Analysis results */}
      {analysis && (
        <>
          {/* No issues state */}
          {analysis.patterns.length === 0 && analysis.suggestions.length === 0 && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "16px 12px",
              background: "rgba(34, 197, 94, 0.08)",
              border: "1px solid #166534",
              borderRadius: 8,
              marginBottom: 12,
            }}>
              <Icon name="check" size={20} />
              <div>
                <div style={{ fontWeight: 600, color: "#bbf7d0", fontSize: 13 }}>No issues detected</div>
                <div style={{ fontSize: 11, color: "#86efac", marginTop: 2 }}>
                  Prompt patterns look clean for this scope.
                </div>
              </div>
            </div>
          )}

          {/* Detected patterns */}
          {analysis.patterns.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "#94a3b8", marginBottom: 8 }}>
                Detected Patterns ({analysis.patterns.length})
              </h3>
              <div style={{ display: "grid", gap: 8 }}>
                {analysis.patterns.map((pattern, i) => {
                  const sev = toSeverityLabel(pattern.severity);
                  return (
                    <div
                      key={`${pattern.patternId}-${i}`}
                      className="images-card"
                      style={{
                        margin: 0,
                        borderColor: severityColor[sev],
                        borderLeftWidth: 3,
                      }}
                    >
                      <div className="images-card-head" style={{ marginBottom: 4 }}>
                        <strong style={{ fontSize: 13 }}>{readablePatternId(pattern.patternId)}</strong>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: severityBg[sev],
                          color: severityColor[sev],
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}>
                          {severityLabel[sev]}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>
                        {pattern.description}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                        Judge: {pattern.judgeName} · Affects {(pattern.affectedPct * 100).toFixed(0)}% of variants
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {analysis.suggestions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "#94a3b8", marginBottom: 8 }}>
                Suggestions ({analysis.suggestions.length})
              </h3>
              <div style={{ display: "grid", gap: 8 }}>
                {analysis.suggestions.map((suggestion, i) => {
                  const applyKey = suggestion.patternId + suggestion.scopeKey;
                  return (
                    <div key={`${suggestion.patternId}-${suggestion.scopeKey}-${i}`} className="images-card" style={{ margin: 0 }}>
                      <div className="images-card-head" style={{ marginBottom: 4 }}>
                        <strong style={{ fontSize: 13 }}>{readablePatternId(suggestion.patternId)}</strong>
                        {suggestion.strategy && (
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>strategy: {suggestion.strategy}</span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 12,
                        color: "#94a3b8",
                        lineHeight: 1.5,
                        marginBottom: 6,
                        fontStyle: "italic",
                      }}>
                        {suggestion.rationale}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: "#cbd5e1",
                        background: "#0f172a",
                        padding: "6px 8px",
                        borderRadius: 4,
                        border: "1px solid #1e293b",
                        marginBottom: 8,
                        whiteSpace: "pre-wrap",
                        fontFamily: "monospace",
                      }}>
                        {suggestion.content}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
                        Scope: {suggestion.scopeType}:{suggestion.scopeKey.slice(0, 8)} ·
                        Type: {suggestion.overrideType} ·
                        Expected Δ: +{(suggestion.expectedImprovement * 100).toFixed(0)}%
                      </div>
                      <div className="images-actions" style={{ marginTop: 0 }}>
                        <button
                          className="images-btn-approve"
                          onClick={() => setConfirmSuggestion(suggestion)}
                          disabled={applyingId === applyKey || !!confirmSuggestion}
                        >
                          <Icon name="check" /> {applyingId === applyKey ? "Applying..." : "Apply"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* No analysis run yet */}
      {!analysis && !loading && (
        <div className="images-empty" style={{ padding: "16px 0" }}>
          Click "Analyze" to scan prompt patterns for the current scope.
        </div>
      )}

      {/* Loading */}
      {loading && !analysis && (
        <div className="images-empty" style={{ padding: "16px 0" }}>
          Analyzing prompt patterns...
        </div>
      )}

      {/* Existing overrides */}
      <div style={{ marginTop: 16, borderTop: "1px solid #334155", paddingTop: 12 }}>
        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "#94a3b8", marginBottom: 8 }}>
          Active Overrides ({overrides.length})
        </h3>
        {overrides.length === 0 ? (
          <div className="images-empty">No active prompt overrides.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {overrides.map((override) => (
              <div
                key={override.id}
                className="images-card"
                style={{ margin: 0, borderColor: "#8b5cf6" }}
              >
                <div className="images-card-head" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "#a78bfa" }}>
                    {override.scopeType}:{override.scopeKey.slice(0, 8)}
                    {override.strategy ? ` / ${override.strategy}` : ""}
                    {" "}
                    <span style={{ color: "#64748b", fontWeight: 400 }}>({override.overrideType})</span>
                  </span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>
                    {override.createdAt ? new Date(override.createdAt).toLocaleDateString() : ""}
                  </span>
                </div>
                <div style={{
                  fontSize: 11,
                  color: "#cbd5e1",
                  background: "#0f172a",
                  padding: "4px 6px",
                  borderRadius: 4,
                  border: "1px solid #1e293b",
                  whiteSpace: "pre-wrap",
                  fontFamily: "monospace",
                  maxHeight: 80,
                  overflow: "auto",
                }}>
                  {override.content}
                </div>
                <div className="images-actions" style={{ marginTop: 6 }}>
                  <button
                    className="images-btn-danger"
                    onClick={() => removeOverride(override.id)}
                    disabled={removingId === override.id}
                  >
                    <Icon name="trash" /> {removingId === override.id ? "Removing..." : "Remove"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
