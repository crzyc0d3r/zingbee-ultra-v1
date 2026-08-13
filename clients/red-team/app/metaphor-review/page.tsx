"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/lib/auth";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { Icon, SvgSprite } from "@/components/ui/Icon";
import {
  cancelMetaphorJob,
  fetchMetaphorCapsule,
  fetchMetaphorCapsules,
  fetchMetaphorCoverage,
  fetchMetaphorJobs,
  kickOffEvaluateJob,
  regenerateCapsule,
  reviewCapsuleAction,
} from "@/lib/metaphor-review/api";
import type {
  MetaphorCandidate,
  MetaphorCapsuleDetail,
  MetaphorCapsuleListEntry,
  MetaphorCoverage,
  MetaphorJob,
  MetaphorReviewStatus,
} from "@/lib/metaphor-review/types";

import "@/styles/images.css";

const SUBJECTS = ["Biology", "Chemistry", "English", "Math", "Physics"];
const PHASES = [1, 2, 3, 4, 5];
const STATUS_OPTIONS: { value: MetaphorReviewStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs_review", label: "Needs your call" },
  { value: "auto_accepted", label: "Strong (auto-accepted)" },
  { value: "human_approved", label: "Approved by reviewer" },
  { value: "auto_rejected", label: "Rejected by judges" },
  { value: "unset", label: "No proposals yet" },
];

// Plain-English labels for the per-candidate decision tier. Backend keeps the
// AUTO_ACCEPT / NEEDS_REVIEW / AUTO_REJECT vocabulary for storage and audit;
// reviewers see human-readable text. Per pre-ship review first-time-user feedback.
const DECISION_LABELS: Record<string, { label: string; tooltip: string; bg: string; fg: string; glyph: string }> = {
  AUTO_ACCEPT: {
    label: "Strong",
    tooltip: "Mean score ≥ 0.85 with low judge disagreement. Will auto-apply unless you override.",
    bg: "#10b981", fg: "#0f172a", glyph: "✓",
  },
  NEEDS_REVIEW: {
    label: "Needs your call",
    tooltip: "Judges disagreed, a critical flag fired, or the score landed in the gray band. Your read decides.",
    bg: "#f59e0b", fg: "#0f172a", glyph: "⚠",
  },
  AUTO_REJECT: {
    label: "Rejected",
    tooltip: "Mean score ≤ 0.50. Don't ship; click Regenerate to try again.",
    bg: "#ef4444", fg: "#1a0707", glyph: "✗",
  },
};

const STATUS_LABELS: Record<string, string> = {
  auto_accepted: "Strong",
  human_approved: "Approved",
  needs_review: "Needs review",
  auto_rejected: "Rejected",
  unset: "No proposals yet",
};

function statusVisuals(status: MetaphorReviewStatus): { bg: string; fg: string; glyph: string } {
  if (status === "auto_accepted" || status === "human_approved") return { bg: "#10b981", fg: "#0f172a", glyph: "✓" };
  if (status === "needs_review") return { bg: "#f59e0b", fg: "#0f172a", glyph: "⚠" };
  if (status === "auto_rejected") return { bg: "#ef4444", fg: "#1a0707", glyph: "✗" };
  return { bg: "#94a3b8", fg: "#0f172a", glyph: "·" };
}

function ReviewPageInner() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  // ---- filters (URL-synced) ---------------------------------------------
  const [subject, setSubjectRaw] = useState(searchParams.get("subject") || "Biology");
  const [phase, setPhaseRaw] = useState<number | null>(() => {
    const p = searchParams.get("phase");
    return p ? Number(p) : null;
  });
  const [status, setStatusRaw] = useState<MetaphorReviewStatus | "all">(
    (searchParams.get("status") as MetaphorReviewStatus | "all" | null) || "needs_review",
  );

  const updateFilter = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value == null || value === "") params.delete(key);
    else params.set(key, value);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const setSubject = useCallback((s: string) => { setSubjectRaw(s); updateFilter("subject", s); }, [updateFilter]);
  const setPhase = useCallback((p: number | null) => { setPhaseRaw(p); updateFilter("phase", p == null ? null : String(p)); }, [updateFilter]);
  const setStatus = useCallback((st: MetaphorReviewStatus | "all") => { setStatusRaw(st); updateFilter("status", st); }, [updateFilter]);

  // ---- data -------------------------------------------------------------
  const [capsules, setCapsules] = useState<MetaphorCapsuleListEntry[]>([]);
  const [coverage, setCoverage] = useState<MetaphorCoverage | null>(null);
  const [activeJobs, setActiveJobs] = useState<MetaphorJob[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const [list, cov, jobs] = await Promise.all([
        fetchMetaphorCapsules({ subject, phase, status: status === "all" ? null : status }),
        fetchMetaphorCoverage({ subject, phase }),
        fetchMetaphorJobs(),
      ]);
      setCapsules(list.capsules);
      setCoverage(cov);
      setActiveJobs(jobs.jobs.filter((j) => j.status === "running" || j.status === "queued"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoadingList(false);
    }
  }, [subject, phase, status]);

  useEffect(() => { if (user) reload(); }, [user, reload]);

  // Poll active jobs while one is running. Use a ref-tracked interval so a
  // filter change (which re-creates `reload`) doesn't accidentally spawn
  // overlapping intervals — that was the H6 bug from pre-ship review.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasActiveJobs = activeJobs.length > 0;
  useEffect(() => {
    if (!user || !hasActiveJobs) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }
    if (pollIntervalRef.current) return;
    // 1.5s while a batch runs feels responsive; the old 4s was perceptibly
    // stale per pre-ship review power-user feedback.
    pollIntervalRef.current = setInterval(async () => {
      try {
        const jobs = await fetchMetaphorJobs();
        const stillRunning = jobs.jobs.filter((j) => j.status === "running" || j.status === "queued");
        setActiveJobs(stillRunning);
        if (stillRunning.length === 0) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          reload();
        }
      } catch {
        // best-effort polling
      }
    }, 1500);
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [user, hasActiveJobs, reload]);

  // ---- selection + detail ----------------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("capsule") || null);
  const [detail, setDetail] = useState<MetaphorCapsuleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadDetail = useCallback(async (capsuleId: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const d = await fetchMetaphorCapsule(capsuleId);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detail load failed");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Prefetch next-in-list so power users walking the queue don't pay
  // round-trip latency on every ↓.
  useEffect(() => {
    if (!selectedId || capsules.length === 0) return;
    const idx = capsules.findIndex((c) => c.capsuleId === selectedId);
    if (idx >= 0 && idx + 1 < capsules.length) {
      const nextId = capsules[idx + 1].capsuleId;
      fetchMetaphorCapsule(nextId).catch(() => {});
    }
  }, [selectedId, capsules]);

  const selectCapsule = useCallback((id: string | null) => {
    setSelectedId(id);
    updateFilter("capsule", id);
  }, [updateFilter]);

  const advanceToNext = useCallback(() => {
    if (!selectedId) return;
    const idx = capsules.findIndex((c) => c.capsuleId === selectedId);
    if (idx >= 0 && idx + 1 < capsules.length) selectCapsule(capsules[idx + 1].capsuleId);
  }, [selectedId, capsules, selectCapsule]);

  const advanceToPrev = useCallback(() => {
    if (!selectedId) return;
    const idx = capsules.findIndex((c) => c.capsuleId === selectedId);
    if (idx > 0) selectCapsule(capsules[idx - 1].capsuleId);
  }, [selectedId, capsules, selectCapsule]);

  // ---- actions ----------------------------------------------------------
  const [actionBusy, setActionBusy] = useState(false);

  const flashSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3500);
  }, []);

  // ---- run-batch confirmation modal ------------------------------------
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);

  const handleRunBatch = useCallback(() => {
    setBatchConfirmOpen(true);
  }, []);

  const performRunBatch = useCallback(async () => {
    if (!subject) return;
    setBatchConfirmOpen(false);
    setActionBusy(true);
    setError(null);
    try {
      await kickOffEvaluateJob({ subject, ...(phase != null ? { phase } : {}) });
      flashSuccess(`Batch evaluate kicked off for ${subject}${phase != null ? ` phase ${phase}` : ""}`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start batch");
    } finally {
      setActionBusy(false);
    }
  }, [subject, phase, flashSuccess, reload]);

  const handleApprove = useCallback(async (candidate: MetaphorCandidate, note: string) => {
    if (!selectedId) return;
    setActionBusy(true);
    try {
      await reviewCapsuleAction(selectedId, { action: "approve", candidate_id: candidate.id, note });
      flashSuccess(`Approved "${candidate.metaphor}"`);
      await loadDetail(selectedId);
      reload();
      // Auto-advance so the reviewer keeps moving without mousing back to the list.
      advanceToNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setActionBusy(false);
    }
  }, [selectedId, flashSuccess, loadDetail, reload, advanceToNext]);

  const handleEditApprove = useCallback(async (candidate: MetaphorCandidate | null, edited: string, note: string) => {
    if (!selectedId || !edited.trim()) return;
    setActionBusy(true);
    try {
      await reviewCapsuleAction(selectedId, {
        action: "edit_then_approve",
        candidate_id: candidate?.id ?? null,
        edited_metaphor: edited,
        note,
      });
      flashSuccess(`Approved edited metaphor "${edited}"`);
      await loadDetail(selectedId);
      reload();
      advanceToNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit-approve failed");
    } finally {
      setActionBusy(false);
    }
  }, [selectedId, flashSuccess, loadDetail, reload, advanceToNext]);

  const handleReject = useCallback(async (note: string) => {
    if (!selectedId) return;
    setActionBusy(true);
    try {
      await reviewCapsuleAction(selectedId, { action: "reject", note });
      flashSuccess("Rejected — capsule queued for regeneration");
      await loadDetail(selectedId);
      reload();
      advanceToNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setActionBusy(false);
    }
  }, [selectedId, flashSuccess, loadDetail, reload, advanceToNext]);

  const handleRegenerate = useCallback(async () => {
    if (!selectedId) return;
    setActionBusy(true);
    try {
      await regenerateCapsule(selectedId);
      flashSuccess("Regenerate kicked off — new proposals will appear when judges finish");
      await loadDetail(selectedId);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regenerate failed");
    } finally {
      setActionBusy(false);
    }
  }, [selectedId, flashSuccess, loadDetail, reload]);

  const handleCancelJob = useCallback(async (jobId: string) => {
    try {
      await cancelMetaphorJob(jobId);
      flashSuccess("Cancel requested");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }, [flashSuccess]);

  // ---- keyboard shortcuts ----------------------------------------------
  // J/K = next/prev, R = refresh, ? = help. Skipped when focus is in a text
  // field so reviewers can type notes without keyboard hijacking.
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) =>
      el instanceof HTMLInputElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLSelectElement
      || (el instanceof HTMLElement && el.isContentEditable);
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") { e.preventDefault(); advanceToNext(); }
      else if (e.key === "k") { e.preventDefault(); advanceToPrev(); }
      else if (e.key === "r") { e.preventDefault(); reload(); }
      else if (e.key === "?") { e.preventDefault(); flashSuccess("Shortcuts: J = next · K = prev · R = refresh"); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [advanceToNext, advanceToPrev, reload, flashSuccess]);

  // ---- render -----------------------------------------------------------
  if (authLoading) return <div className="images-page"><div role="status" aria-live="polite" className="images-empty">Loading…</div></div>;
  if (!user) return <div className="images-page"><LoginOverlay /></div>;

  return (
    <div className="images-page">
      <SvgSprite />
      <main>
        <header className="images-toolbar">
          <h1>Metaphor Review</h1>
          <p style={{ margin: "4px 0 8px", fontSize: 13, color: "#94a3b8", maxWidth: 720, lineHeight: 1.5 }}>
            For each curriculum capsule, an AI proposer suggests three sustained metaphors and a panel of five
            judges scores each. You approve, edit, or reject the winner. The accepted metaphor will pin the
            tutor&rsquo;s analogies across reteach rounds.
          </p>
          <div className="images-controls">
            <div className="images-control">
              <label htmlFor="m-subject">Subject</label>
              <select id="m-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="images-control">
              <label htmlFor="m-phase">Phase</label>
              <select id="m-phase" value={phase ?? ""} onChange={(e) => setPhase(e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">All</option>
                {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="images-control">
              <label htmlFor="m-status">Status</label>
              <select id="m-status" value={status} onChange={(e) => setStatus(e.target.value as MetaphorReviewStatus | "all")}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button onClick={() => reload()} title="Refresh (R)" aria-label="Refresh capsule list">
              <Icon name="refresh" /> Refresh
            </button>
            <button
              onClick={handleRunBatch}
              disabled={actionBusy}
              title="Score capsules in this scope"
              aria-label={`Run batch evaluate for ${subject}${phase != null ? ` phase ${phase}` : ""}`}
            >
              <Icon name="sprout" /> Run batch
            </button>
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: "auto" }} aria-hidden="true">
              J = next · K = prev · R = refresh
            </span>
          </div>
        </header>

        {coverage && <CoverageBar coverage={coverage} />}

        {activeJobs.length > 0 && (
          <section
            aria-label="Active metaphor-eval jobs"
            role="status"
            aria-live="polite"
            style={{ background: "rgba(245, 158, 11, 0.08)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(245, 158, 11, 0.4)", marginBottom: 8 }}
          >
            <strong style={{ color: "#fbbf24" }}>Active jobs ({activeJobs.length})</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
              {activeJobs.map((j) => (
                <li key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>{j.command} · {j.currentStage} · {j.itemsProcessed}/{j.totalCandidates}</span>
                  <button
                    onClick={() => handleCancelJob(j.id)}
                    style={{ fontSize: 11, padding: "2px 8px" }}
                    aria-label={`Cancel ${j.command} job ${j.id}`}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && <div className="images-error" role="alert" aria-live="assertive">{error}</div>}
        {success && <div className="images-success" role="status" aria-live="polite">{success}</div>}

        {batchConfirmOpen && (
          <BatchConfirm
            subject={subject}
            phase={phase}
            onConfirm={performRunBatch}
            onCancel={() => setBatchConfirmOpen(false)}
          />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 380px) 1fr", gap: 12, marginTop: 10 }}>
          <CapsuleList
            capsules={capsules}
            selectedId={selectedId}
            loading={loadingList}
            onSelect={selectCapsule}
          />
          <CapsuleDetail
            detail={detail}
            loading={loadingDetail}
            actionBusy={actionBusy}
            onApprove={handleApprove}
            onEditApprove={handleEditApprove}
            onReject={handleReject}
            onRegenerate={handleRegenerate}
          />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch-run confirm dialog
// ---------------------------------------------------------------------------

function BatchConfirm({
  subject, phase, onConfirm, onCancel,
}: { subject: string; phase: number | null; onConfirm: () => void; onCancel: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    // Listen for Esc on document while modal is open — the dialog div's
    // onKeyDown only fires when focus is inside it. Per pre-ship review pass-2 N2.
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="m-batch-confirm-title"
      style={{
        position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ background: "#0f172a", borderRadius: 8, border: "1px solid #334155", padding: 18, maxWidth: 480 }}>
        <h2 id="m-batch-confirm-title" style={{ margin: 0, fontSize: 16, color: "#f1f5f9" }}>
          Run batch evaluate
        </h2>
        <p style={{ margin: "8px 0 12px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>
          Score every unauthored capsule in <strong>{subject}{phase != null ? ` · phase ${phase}` : ""}</strong>.
        </p>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
          Each capsule runs 1 proposer + 5 judges × 3 candidates = 16 LLM calls.
          Already-accepted capsules are skipped. The job runs in the background; cancel it any time
          from the Active jobs panel.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel}>Cancel</button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{ background: "rgba(16, 185, 129, 0.18)", borderColor: "#10b981", color: "#6ee7b7" }}
          >
            Start batch
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coverage bar
// ---------------------------------------------------------------------------

function CoverageBar({ coverage }: { coverage: MetaphorCoverage }) {
  const pct = Math.round(coverage.coveragePct * 100);
  const target = 95;
  const barColor = pct >= target ? "#10b981" : pct >= 70 ? "#f59e0b" : "#ef4444";
  const onTrack = pct >= target;
  return (
    <div
      role="status"
      aria-label={`Authoring coverage: ${coverage.acceptedCount} of ${coverage.total} capsules accepted, ${pct} percent. Target is ${target} percent.`}
      style={{ padding: "8px 12px", borderRadius: 8, background: "#0f172a", border: "1px solid #334155", marginBottom: 8 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: 13, flexWrap: "wrap" }}>
        <strong>Coverage:</strong>
        <span>{coverage.acceptedCount} / {coverage.total} accepted ({pct}%)</span>
        <span style={{ color: "#94a3b8" }}>target ≥ {target}%</span>
        <span aria-hidden="true" style={{ color: onTrack ? "#10b981" : "#f59e0b", fontWeight: 600 }}>
          {onTrack ? "✓ on track" : "⚠ below target"}
        </span>
        <span style={{ marginLeft: "auto", color: "#94a3b8", fontSize: 11 }}>
          needs review: {coverage.counts.needs_review || 0} · rejected: {coverage.counts.auto_rejected || 0} · no proposals: {coverage.counts.unset || 0}
        </span>
      </div>
      <div style={{ height: 6, background: "#1e293b", borderRadius: 3, marginTop: 6, overflow: "hidden" }} aria-hidden="true">
        <div style={{ height: "100%", width: `${pct}%`, background: barColor, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capsule list (left column)
// ---------------------------------------------------------------------------

function CapsuleList({
  capsules, selectedId, loading, onSelect,
}: {
  capsules: MetaphorCapsuleListEntry[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string | null) => void;
}) {
  return (
    <nav
      aria-label="Capsules"
      style={{ background: "#0f172a", borderRadius: 8, border: "1px solid #334155", maxHeight: "calc(100vh - 280px)", overflow: "auto" }}
    >
      <div
        role="status"
        aria-live="polite"
        style={{ position: "sticky", top: 0, background: "#0f172a", padding: "8px 12px", borderBottom: "1px solid #334155", fontSize: 13, color: "#94a3b8" }}
      >
        {loading ? "Loading…" : `${capsules.length} capsule${capsules.length === 1 ? "" : "s"}`}
      </div>
      {capsules.length === 0 && !loading && (
        <div className="images-empty" role="status" style={{ padding: 16, textAlign: "center", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing to review here.</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            Try <em>Status: All</em> to see auto-accepted capsules, or click <em>Run batch</em> above to score capsules
            that don&rsquo;t have proposals yet.
          </div>
        </div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }} role="list">
        {capsules.map((c) => {
          const selected = c.capsuleId === selectedId;
          const visuals = statusVisuals(c.reviewStatus);
          const friendlyStatus = STATUS_LABELS[c.reviewStatus] || c.reviewStatus;
          return (
            <li key={c.capsuleId}>
              {/* Real <button> so keyboard users can Tab + Enter/Space.
                  Bare <li onClick> was a WCAG 2.1.1 (Level A) failure. */}
              <button
                type="button"
                onClick={() => onSelect(c.capsuleId)}
                aria-current={selected ? "page" : undefined}
                aria-label={`${c.capsuleName}, ${c.subjectName} phase ${c.phase}, status ${friendlyStatus}`}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "10px 12px", borderBottom: "1px solid #1e293b",
                  cursor: "pointer",
                  background: selected ? "rgba(99, 102, 241, 0.18)" : "transparent",
                  border: "none",
                  borderLeft: selected ? "3px solid #6366f1" : "3px solid transparent",
                  color: "inherit", font: "inherit",
                }}
              >
                <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <strong style={{ fontSize: 13, color: "#e2e8f0" }}>{c.capsuleName}</strong>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>P{c.phase}</span>
                  <span
                    style={{
                      marginLeft: "auto", fontSize: 11, padding: "2px 7px", borderRadius: 999,
                      background: visuals.bg, color: visuals.fg, fontWeight: 700, whiteSpace: "nowrap",
                    }}
                  >
                    <span aria-hidden="true">{visuals.glyph} </span>
                    {friendlyStatus}
                  </span>
                </span>
                <span style={{ display: "block", fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                  {c.subjectName} · {c.themeName}
                </span>
                {c.metaphor && (
                  <span style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginTop: 4, fontStyle: "italic" }}>
                    &ldquo;{c.metaphor}&rdquo;
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Capsule detail (right column)
// ---------------------------------------------------------------------------

function CapsuleDetail({
  detail, loading, actionBusy,
  onApprove, onEditApprove, onReject, onRegenerate,
}: {
  detail: MetaphorCapsuleDetail | null;
  loading: boolean;
  actionBusy: boolean;
  onApprove: (c: MetaphorCandidate, note: string) => void;
  onEditApprove: (c: MetaphorCandidate | null, edited: string, note: string) => void;
  onReject: (note: string) => void;
  onRegenerate: () => void;
}) {
  const latestRun = detail?.metaphorProposals[detail.metaphorProposals.length - 1];
  const candidates = useMemo(() => latestRun?.candidates ?? [], [latestRun]);

  // Local UI state
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editedText, setEditedText] = useState("");
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setNote("");
    setEditing(null);
    setEditedText("");
  }, [detail?.capsuleId]);

  // Manage focus on edit-panel toggle: textarea on open, trigger button on close.
  useEffect(() => {
    if (editing) {
      editTextareaRef.current?.focus();
    } else if (editTriggerRef.current) {
      editTriggerRef.current.focus();
    }
  }, [editing]);

  if (loading) {
    return <div role="status" aria-live="polite" className="images-empty" style={{ padding: 24, textAlign: "center" }}>Loading capsule…</div>;
  }
  if (!detail) {
    return (
      <div className="images-empty" style={{ padding: 24, textAlign: "center", color: "#94a3b8", lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Pick a capsule from the list to start.</div>
        <div style={{ fontSize: 12 }}>Use <kbd>J</kbd>/<kbd>K</kbd> to walk the queue, or click any row.</div>
      </div>
    );
  }

  const review = detail.metaphorReview || ({ status: "unset" } as { status: MetaphorReviewStatus });
  const reviewVisuals = statusVisuals(review.status);
  const friendlyReview = STATUS_LABELS[review.status] || review.status;

  return (
    <section style={{ background: "#0f172a", borderRadius: 8, border: "1px solid #334155", padding: 14, maxHeight: "calc(100vh - 280px)", overflow: "auto" }} aria-label="Capsule detail">
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, color: "#f1f5f9" }}>{detail.capsuleName}</h2>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          {detail.subjectName} · {detail.themeName} · Phase {detail.phase} · Ages {detail.ageRange}
        </span>
        <span
          role="status"
          aria-label={`Review status: ${friendlyReview}`}
          style={{
            marginLeft: "auto", fontSize: 12, padding: "3px 10px", borderRadius: 999,
            background: reviewVisuals.bg, color: reviewVisuals.fg, fontWeight: 700,
          }}
        >
          <span aria-hidden="true">{reviewVisuals.glyph} </span>
          {friendlyReview}
        </span>
      </header>

      {detail.metaphor && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(16, 185, 129, 0.1)", borderRadius: 6, border: "1px solid rgba(16, 185, 129, 0.4)" }}>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Currently accepted</div>
          <div style={{ fontSize: 14, color: "#e2e8f0", marginTop: 2 }}>&ldquo;{detail.metaphor}&rdquo;</div>
          {review.reviewer && (
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              by {review.reviewer} {review.reviewed_at ? `· ${new Date(review.reviewed_at).toLocaleString()}` : ""}
            </div>
          )}
        </div>
      )}

      {!latestRun && (
        <div className="images-empty" style={{ padding: 16, marginTop: 12, textAlign: "center" }}>
          No proposal runs yet. Click <em>Run batch</em> above or <em>Regenerate now</em> below to score candidates.
        </div>
      )}

      {latestRun && (
        <>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0, fontSize: 13 }}>Latest run · {new Date(latestRun.proposed_at).toLocaleString()}</h3>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>by {latestRun.proposed_by}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, marginTop: 8 }}>
            {candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                isWinner={latestRun.winner_id === c.id}
                facts={detail.facts}
                actionBusy={actionBusy}
                onApprove={() => onApprove(c, note)}
                onStartEdit={(triggerEl) => { editTriggerRef.current = triggerEl; setEditing(c.id); setEditedText(c.metaphor); }}
              />
            ))}
          </div>
        </>
      )}

      {/* Edit panel */}
      {editing && (
        <div style={{ marginTop: 14, padding: 12, background: "rgba(99, 102, 241, 0.08)", borderRadius: 6, border: "1px solid #4f46e5" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 13 }}>Edit then approve</h3>
          <label htmlFor="m-edit-text" className="sr-only">Edited metaphor text</label>
          <textarea
            id="m-edit-text"
            ref={editTextareaRef}
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            rows={3}
            maxLength={200}
            style={{ width: "100%", marginTop: 6, fontSize: 13 }}
            placeholder="Edit the metaphor wording…"
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
            <button
              disabled={actionBusy || !editedText.trim()}
              onClick={() => {
                const c = candidates.find((x) => x.id === editing) || null;
                onEditApprove(c, editedText, note);
                setEditing(null);
              }}
            >Save & approve</button>
            <button onClick={() => setEditing(null)}>Cancel</button>
            <span aria-hidden="true" style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>
              {editedText.length}/200
            </span>
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div style={{ marginTop: 14, padding: 12, background: "#1e293b", borderRadius: 6, border: "1px solid #334155" }}>
        <label htmlFor="m-reviewer-note" style={{ fontSize: 11, color: "#94a3b8" }}>
          Reviewer note (optional, applies to whichever action you take next)
        </label>
        <input
          id="m-reviewer-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Why this decision…"
          style={{ width: "100%", marginTop: 4 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => onReject(note)}
            disabled={actionBusy}
            title="Clears the accepted metaphor and queues this capsule for the next batch run"
            style={{ background: "rgba(239, 68, 68, 0.18)", borderColor: "#ef4444", color: "#fca5a5" }}
          >
            Reject and request new proposals
          </button>
          <button
            onClick={() => onRegenerate()}
            disabled={actionBusy}
            title="Score fresh proposals for this capsule right now"
            style={{ background: "rgba(99, 102, 241, 0.18)", borderColor: "#6366f1", color: "#c7d2fe" }}
          >
            Regenerate now
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Candidate card
// ---------------------------------------------------------------------------

function CandidateCard({
  candidate, isWinner, facts, actionBusy, onApprove, onStartEdit,
}: {
  candidate: MetaphorCandidate;
  isWinner: boolean;
  facts: { factId: string; factText: string; factOrder: number }[];
  actionBusy: boolean;
  onApprove: () => void;
  onStartEdit: (triggerEl: HTMLButtonElement) => void;
}) {
  // Auto-expand judge breakdown for the winner ONLY when the decision is
  // NEEDS_REVIEW — that's when the reviewer most needs the rationale at a
  // glance. AUTO_ACCEPT cards don't need to bury the page in 5 collapsed
  // panels worth of judge text the reviewer will probably approve outright
  // (per pre-ship review pass-2 power-user feedback).
  const [showJudges, setShowJudges] = useState(isWinner && candidate.decision === "NEEDS_REVIEW");
  const [showSustained, setShowSustained] = useState(false);
  const decision = DECISION_LABELS[candidate.decision] || DECISION_LABELS.NEEDS_REVIEW;
  const editButtonRef = useRef<HTMLButtonElement | null>(null);

  // Aggregate sustained-coverage stat so reviewers don't have to expand the
  // panel just to count gaps.
  const sustainedStats = useMemo(() => {
    const examples = candidate.sustained_examples_per_fact || {};
    const total = facts.length;
    const covered = facts.filter((f) => {
      const ex = examples[f.factId];
      return typeof ex === "string" && ex.trim().length > 0;
    }).length;
    return { covered, total };
  }, [candidate.sustained_examples_per_fact, facts]);

  return (
    <article style={{ padding: 10, borderRadius: 6, background: "#1e293b", border: isWinner ? "1px solid #10b981" : "1px solid #334155" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <strong style={{ fontSize: 13, color: "#f1f5f9" }}>&ldquo;{candidate.metaphor}&rdquo;</strong>
        <span
          title={decision.tooltip}
          aria-label={`Decision: ${decision.label}. ${decision.tooltip}`}
          style={{
            fontSize: 11, padding: "2px 7px", borderRadius: 4,
            background: decision.bg, color: decision.fg, fontWeight: 700, whiteSpace: "nowrap",
          }}
        >
          <span aria-hidden="true">{decision.glyph} </span>
          {decision.label}
        </span>
      </header>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
        score {candidate.composite.toFixed(2)}/1.0 · agreement{" "}
        <span title={`judge variance ${candidate.variance.toFixed(2)} (lower = more agreement)`}>
          {candidate.variance < 0.2 ? "high" : candidate.variance < 0.4 ? "medium" : "low"}
        </span>
        {" · "}
        <span title="How many of the capsule's facts the metaphor extends to (higher is better)">
          sustains {sustainedStats.covered}/{sustainedStats.total} facts
        </span>
        {isWinner && (
          <>
            {" "}
            <span aria-hidden="true" style={{ color: "#10b981" }}>★</span>
            <span className="sr-only">Winner candidate. </span>
            <span style={{ color: "#10b981" }}>winner</span>
          </>
        )}
      </div>
      {candidate.rationale && (
        <p style={{ fontSize: 12, color: "#cbd5e1", marginTop: 6, lineHeight: 1.4 }}>
          {candidate.rationale}
        </p>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, fontSize: 11 }}>
        <button onClick={() => setShowJudges((v) => !v)} aria-expanded={showJudges} style={{ padding: "2px 8px" }}>
          {showJudges ? "Hide" : "Show"} judges
        </button>
        <button onClick={() => setShowSustained((v) => !v)} aria-expanded={showSustained} style={{ padding: "2px 8px" }}>
          {showSustained ? "Hide" : "Show"} per-fact extension ({sustainedStats.covered}/{sustainedStats.total})
        </button>
      </div>
      {showJudges && (
        <div style={{ marginTop: 6, fontSize: 11 }}>
          {Object.entries(candidate.judge_breakdown || {}).map(([name, j]) => (
            <div key={name} style={{ padding: "4px 6px", marginTop: 2, background: "#0f172a", borderRadius: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span><strong>{name.replace(/_/g, " ")}</strong> · {j.score == null ? "n/a" : j.score.toFixed(2)}</span>
                <span style={{ color: "#64748b" }}>{j.provider}{j.model ? ` / ${j.model}` : ""}</span>
              </div>
              {j.reasoning && <div style={{ color: "#cbd5e1", marginTop: 2 }}>{j.reasoning}</div>}
              {j.flags?.length > 0 && (
                <div style={{ color: "#fca5a5", marginTop: 2 }}>flags: {j.flags.join(", ")}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {showSustained && (
        <div style={{ marginTop: 6, fontSize: 11 }}>
          {facts.map((f) => {
            const ex = (candidate.sustained_examples_per_fact || {})[f.factId];
            return (
              <div key={f.factId} style={{ padding: "4px 6px", marginTop: 2, background: "#0f172a", borderRadius: 4 }}>
                <div style={{ color: "#94a3b8" }}>#{f.factOrder} {f.factText}</div>
                <div style={{ color: ex ? "#cbd5e1" : "#64748b", marginTop: 2, fontStyle: ex ? "italic" : "normal" }}>
                  {ex || "(no per-fact extension supplied)"}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={onApprove} disabled={actionBusy} style={{ background: "rgba(16, 185, 129, 0.18)", borderColor: "#10b981", color: "#6ee7b7" }}>
          Approve
        </button>
        <button
          ref={editButtonRef}
          onClick={() => editButtonRef.current && onStartEdit(editButtonRef.current)}
          disabled={actionBusy}
          style={{ padding: "5px 10px" }}
        >
          Edit then approve
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Suspense wrapper (Next 14 useSearchParams quirk)
// ---------------------------------------------------------------------------

export default function MetaphorReviewPage() {
  return (
    <Suspense fallback={<div className="images-page"><div role="status" aria-live="polite" className="images-empty">Loading…</div></div>}>
      <ReviewPageInner />
    </Suspense>
  );
}
