"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { SvgSprite, Icon } from "@/components/ui/Icon";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { AuditDetail } from "@/components/audits/AuditDetail";
import "@/styles/audits.css";

interface AuditItem {
  id: string;
  title: string;
  description: string | null;
  audit_date: string | null;
  subjects_count: number | null;
  capsules_count: number | null;
  facts_count: number | null;
  issues_count: number | null;
  health_score: number | null;
  created_at: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return { day: "?", month: "???", year: "" };
  const d = new Date(iso);
  return {
    day: String(d.getDate()),
    month: d.toLocaleString("en-US", { month: "short" }),
    year: String(d.getFullYear()),
  };
}

function AuditsPageInner() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Apply embed mode class
  useEffect(() => {
    if (isEmbed) {
      document.body.classList.add("embed-mode");
      return () => document.body.classList.remove("embed-mode");
    }
  }, [isEmbed]);

  // Load audits
  const loadAudits = useCallback(async () => {
    try {
      const data = await apiFetch<AuditItem[]>("/api/curriculum-audits");
      setAudits(data);
    } catch {
      setAudits([]);
    }
    setDataLoaded(true);
  }, []);

  useEffect(() => {
    if (user) loadAudits();
  }, [user, loadAudits]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDeleteId) return;
    setDeletingId(confirmDeleteId);
    setDeleteError(null);
    setConfirmDeleteId(null);
    try {
      await apiFetch(`/api/curriculum-audits/${confirmDeleteId}`, { method: "DELETE" });
      setAudits((prev) => prev.filter((a) => a.id !== confirmDeleteId));
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }, [confirmDeleteId]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await apiFetch<{ id: string }>("/api/curriculum-audits/generate", {
        method: "POST",
      });
      setShowNewModal(false);
      await loadAudits();
      if (result?.id) setSelectedId(result.id);
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [loadAudits]);

  // Auth guard
  if (authLoading) return <div className="page-audits"><div className="loading">Loading...</div></div>;
  if (!user) return <div className="page-audits"><SvgSprite /><LoginOverlay /></div>;

  // Detail view: React-rendered audit (with iframe fallback for legacy)
  if (selectedId) {
    return (
      <div className="page-audits">
        <SvgSprite />
        <AuditDetail auditId={selectedId} onBack={handleBack} />
      </div>
    );
  }

  // List view
  return (
    <div className="page-audits">
      <SvgSprite />
      <div className="toolbar">
        <span className="toolbar-title">Curriculum Audits</span>
        <div className="toolbar-actions">
          <button className="new-audit-btn" onClick={() => setShowNewModal(true)}>
            New Audit
          </button>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            {audits.length} audit{audits.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {showNewModal && (
        <div className="audit-modal-overlay" onClick={() => !generating && setShowNewModal(false)}>
          <div className="audit-modal" onClick={(e) => e.stopPropagation()}>
            {generating ? (
              <div className="audit-generating">
                <div className="audit-generating-spinner" />
                <div className="audit-generating-title">Generating Report</div>
                <div className="audit-generating-desc">Analyzing curriculum data with AI. This may take a few minutes.</div>
              </div>
            ) : (
              <>
                <div className="audit-modal-title">New Curriculum Audit</div>
                <p className="audit-modal-desc">
                  This will analyze the current curriculum database and generate a fresh audit report using AI.
                </p>
                {genError && <div className="audit-modal-error">{genError}</div>}
                <div className="audit-modal-actions">
                  <button
                    className="audit-modal-cancel"
                    onClick={() => setShowNewModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="audit-modal-begin"
                    onClick={handleGenerate}
                  >
                    Begin Audit
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="audit-modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="audit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="audit-modal-title">Delete Audit</div>
            <p className="audit-modal-desc">Are you sure you want to delete this audit? This cannot be undone.</p>
            <div className="audit-modal-actions">
              <button className="audit-modal-cancel" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button className="audit-modal-begin" style={{ background: "#dc2626" }} onClick={handleDeleteConfirm}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {deleteError && (
        <div style={{ padding: "8px 20px", background: "#7f1d1d", color: "#fca5a5", fontSize: 12 }}>
          Delete failed: {deleteError}
        </div>
      )}

      {!dataLoaded ? (
        <div className="loading">Loading...</div>
      ) : audits.length === 0 ? (
        <div className="empty">
          <div className="ico"><Icon name="audit" size={32} /></div>
          <div>No audits found</div>
        </div>
      ) : (
        <div className="audit-list">
          {audits.map((a) => {
            const dt = formatDate(a.audit_date);
            return (
              <div key={a.id} className="audit-card" onClick={() => handleSelect(a.id)}>
                <div className="audit-date">
                  <div className="month">{dt.month}</div>
                  {dt.day}
                </div>
                <div className="audit-info">
                  <div className="audit-title">{a.title || "Untitled Audit"}</div>
                  {a.description && <div className="audit-desc">{a.description}</div>}
                  <div className="audit-meta">
                    {a.subjects_count != null && (
                      <span className="audit-stat">Subjects: <span className="value">{a.subjects_count}</span></span>
                    )}
                    {a.capsules_count != null && (
                      <span className="audit-stat">Capsules: <span className="value">{a.capsules_count}</span></span>
                    )}
                    {a.facts_count != null && (
                      <span className="audit-stat">Facts: <span className="value">{a.facts_count}</span></span>
                    )}
                    {a.issues_count != null && (
                      <span className="audit-stat">Insights: <span className="value">{a.issues_count}</span></span>
                    )}
                    {a.health_score != null && (
                      <span className="audit-stat">Health: <span className="value">{a.health_score}%</span></span>
                    )}
                    <span className="audit-stat">{dt.year}</span>
                  </div>
                </div>
                <button
                  className="audit-delete-btn"
                  disabled={deletingId === a.id}
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(a.id); }}
                  title="Delete audit"
                >
                  {deletingId === a.id ? "..." : "\u00D7"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AuditsPage() {
  return (
    <Suspense>
      <AuditsPageInner />
    </Suspense>
  );
}
