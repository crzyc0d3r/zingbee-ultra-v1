"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { Icon, SvgSprite } from "@/components/ui/Icon";
import { useImageScope } from "@/hooks/use-image-scope";
import { ScopePicker } from "@/components/images/ScopePicker";
import { useSearchParams, useRouter } from "next/navigation";
import { useDistillationData } from "@/hooks/use-distillation-data";
import type { PipelineLimits } from "@/hooks/use-distillation-data";
import type { ReviewTab } from "@/lib/distillations/types";
import {
  ActiveJobs,
  AnalyticsDashboard,
  ConfirmDialog,
  CoverageGrid,
  EmptyState,
  ExplanationList,
  ImageList,
  IterationTimeline,
  PairList,
  PipelinePanel,
  PromptOptimizer,
  ProviderSelector,
  RecentJobs,
  StatsBar,
  WorkflowBanner,
} from "@/components/distillations";
import type { ModelSelection } from "@/components/distillations/ProviderSelector";
import "@/styles/images.css";

function ReviewPageInner() {
  const { user, loading: authLoading } = useAuth();
  const scopeHook = useImageScope("distillations");
  const {
    subjects, phaseOptions, themeOptions, capsuleOptions,
    subject, phase, theme, capsule, setSubject, setPhase, setTheme, setCapsule,
    scopeWarning,
  } = scopeHook;
  const searchParams = useSearchParams();
  const router = useRouter();

  // Tab state from URL — default to dashboard when no scope
  const urlTab = searchParams.get("tab") as ReviewTab | null;
  const [tab, setTabRaw] = useState<ReviewTab>(urlTab || "dashboard");

  const setTab = useCallback((t: ReviewTab) => {
    setTabRaw(t);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", t);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Data hook
  const data = useDistillationData({
    subject,
    phase: String(phase),
    theme,
    capsule,
  });

  // Coverage filter URL sync
  const setCoverageFilter = useCallback((f: "all" | "not_started" | "in_progress" | "ready") => {
    data.setCoverageFilter(f);
    const params = new URLSearchParams(searchParams.toString());
    params.set("cf", f);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router, data]);

  // Highlight fact (from coverage click → explanations tab)
  const [highlightFactId, setHighlightFactId] = useState<string | null>(null);

  const handleFactClick = useCallback((factId: string) => {
    setHighlightFactId(factId);
    setTab("explanations");
  }, [setTab]);

  useEffect(() => {
    if (!highlightFactId || tab !== "explanations") return;
    const el = document.querySelector(`[data-fact-id="${highlightFactId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("images-card-highlight");
      const timer = setTimeout(() => {
        el.classList.remove("images-card-highlight");
        setHighlightFactId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightFactId, tab]);

  // Keyboard shortcuts
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (el.isContentEditable) return;
      if (e.key === "d" && !e.metaKey && !e.ctrlKey) setTab("dashboard");
      else if (e.key === "1") setTab("explanations");
      else if (e.key === "2") setTab("images");
      else if (e.key === "3") setTab("coverage");
      else if (e.key === "4") setTab("pairs");
      else if (e.key === "5") setTab("optimize");
      else if (e.key === "r" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); data.loadData(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [setTab, data]);

  // Provider/model selection state
  const [modelSelection, setModelSelection] = useState<ModelSelection>({
    generationModel: "",
    evaluationModel: "",
    imageProvider: "xai",
  });

  // H-13: wrap runCommand to inject model selection into every job
  const runCommandWithModel = useCallback((command: string) => {
    const extras: Record<string, unknown> = {};
    if (modelSelection.generationModel) extras.generation_model = modelSelection.generationModel;
    if (modelSelection.evaluationModel) extras.evaluation_model = modelSelection.evaluationModel;
    if (modelSelection.imageProvider) extras.image_provider = modelSelection.imageProvider;
    return data.runCommand(command, extras);
  }, [data, modelSelection]);

  // Unique fact count for pipeline panel
  const uniqueFactCount = useMemo(
    () => new Set(data.explanations.map((e) => e.factId)).size,
    [data.explanations],
  );

  // Limit change handler
  const handleLimitChange = useCallback((update: Partial<PipelineLimits>) => {
    data.setLimits((prev) => ({ ...prev, ...update }));
  }, [data]);

  // Auto-tab switch on job completion
  const lastCompletedCommand = data.lastCompletedCommand;
  const clearLastCompleted = data.setLastCompletedCommand;
  useEffect(() => {
    if (!lastCompletedCommand) return;
    clearLastCompleted(null);
    if (lastCompletedCommand === "evaluate_explanations") setTab("explanations");
    else if (lastCompletedCommand === "evaluate_images" || lastCompletedCommand === "evaluate_pairs") setTab("pairs");
    else if (lastCompletedCommand === "generate_images") setTab("images");
    else if (lastCompletedCommand === "generate_explanations") setTab("explanations");
  }, [lastCompletedCommand, clearLastCompleted, setTab]);

  // Detect embed mode
  const isEmbed = searchParams.get("embed") === "1";

  if (authLoading) return <div className="images-page"><div role="status" aria-live="polite" className="images-empty">Loading...</div></div>;
  if (!user) return <div className="images-page"><LoginOverlay /></div>;

  return (
    <div className="images-page" ref={pageRef}>
      <SvgSprite />

      <main>
        <div className="images-toolbar">
          <h1>Distillation Review</h1>
          <ScopePicker
            subjects={subjects}
            phaseOptions={phaseOptions}
            themeOptions={themeOptions}
            capsuleOptions={capsuleOptions}
            subject={subject}
            phase={phase}
            theme={theme}
            capsule={capsule}
            setSubject={setSubject}
            setPhase={setPhase}
            setTheme={setTheme}
            setCapsule={setCapsule}
          >
            <button onClick={() => data.loadData()} title="Refresh (R)"><Icon name="refresh" /> Refresh</button>
            {isEmbed && (
              <button
                onClick={() => window.open("/distillations/review", "_blank")}
                title="Open in new tab"
                style={{ fontSize: 12 }}
              >
                <Icon name="launch" /> Pop Out
              </button>
            )}
          </ScopePicker>
        </div>

        {/* Pipeline panel (only when scope is ready) */}
        {data.scopeReady && (
          <>
            <PipelinePanel
              stats={data.stats}
              coverageSummary={data.coverageSummary}
              images={data.images}
              uniqueFactCount={uniqueFactCount}
              loading={data.loading}
              showOptions={data.showOptions}
              limits={data.limits}
              onRunCommand={runCommandWithModel}
              onToggleOptions={() => data.setShowOptions((v) => !v)}
              onLimitChange={handleLimitChange}
            />
            <div className="dist-pipeline-panel" style={{ padding: "8px 14px", marginTop: -4 }}>
              <ProviderSelector value={modelSelection} onChange={setModelSelection} />
            </div>
          </>
        )}

        {/* Prerequisite error */}
        {data.prerequisiteError && (
          <div
            className="images-error"
            role="alert"
            aria-live="assertive"
            style={{ background: "rgba(234, 179, 8, 0.15)", borderColor: "#eab308", padding: "8px 12px", borderRadius: 8, border: "1px solid #eab308" }}
          >
            Prerequisites not met: {data.prerequisiteError}
          </div>
        )}

        {/* Success */}
        {data.successMessage && <div className="images-success" role="status" aria-live="polite">{data.successMessage}</div>}

        {/* Error */}
        {data.error && <div className="images-error" role="alert" aria-live="assertive">{data.error}</div>}

        {/* Confirm dialog */}
        {data.confirmAction && (
          <ConfirmDialog
            action={data.confirmAction.action}
            onConfirm={() => data.reviewAction(data.confirmAction!.type, data.confirmAction!.factId, data.confirmAction!.variantId, data.confirmAction!.action)}
            onCancel={() => data.setConfirmAction(null)}
            note={data.confirmNote}
            onNoteChange={data.setConfirmNote}
          />
        )}

        {/* Active jobs */}
        <ActiveJobs activeJobs={data.activeJobs} onCancel={data.handleCancelJob} />

        {/* Stats bar */}
        {data.scopeReady && <StatsBar stats={data.stats} coverageSummary={data.coverageSummary} />}

        {/* Tab navigation — always visible */}
        <div className="images-nav" role="tablist" aria-label="Review tabs" style={{ marginTop: 8 }}>
          <button role="tab" aria-selected={tab === "dashboard"} className={`images-nav-tab${tab === "dashboard" ? " active" : ""}`} onClick={() => setTab("dashboard")}>
            Dashboard
          </button>
          <button role="tab" aria-selected={tab === "explanations"} className={`images-nav-tab${tab === "explanations" ? " active" : ""}`} disabled={!data.scopeReady} onClick={() => data.scopeReady && setTab("explanations")} title={!data.scopeReady ? "Select a full scope to unlock" : undefined}>
            Explanations{data.stats.total > 0 ? ` (${data.stats.approved}/${data.stats.total})` : ""}
          </button>
          <button role="tab" aria-selected={tab === "images"} className={`images-nav-tab${tab === "images" ? " active" : ""}`} disabled={!data.scopeReady} onClick={() => data.scopeReady && setTab("images")} title={!data.scopeReady ? "Select a full scope to unlock" : undefined}>
            Images{data.images.length > 0 ? ` (${data.images.length})` : ""}
          </button>
          <button role="tab" aria-selected={tab === "coverage"} className={`images-nav-tab${tab === "coverage" ? " active" : ""}`} disabled={!data.scopeReady} onClick={() => data.scopeReady && setTab("coverage")} title={!data.scopeReady ? "Select a full scope to unlock" : undefined}>
            Coverage{data.coverageSummary.totalFacts > 0 ? ` (${data.coverageSummary.readyFacts}/${data.coverageSummary.totalFacts})` : ""}
          </button>
          <button role="tab" aria-selected={tab === "pairs"} className={`images-nav-tab${tab === "pairs" ? " active" : ""}`} disabled={!data.scopeReady} onClick={() => data.scopeReady && setTab("pairs")} title={!data.scopeReady ? "Select a full scope to unlock" : undefined}>
            Pairs{data.pairSummary.total > 0 ? ` (${data.pairSummary.ship}/${data.pairSummary.total})` : ""}
          </button>
          <button role="tab" aria-selected={tab === "optimize"} className={`images-nav-tab${tab === "optimize" ? " active" : ""}`} disabled={!data.scopeReady} onClick={() => data.scopeReady && setTab("optimize")} title={!data.scopeReady ? "Select a full scope to unlock" : undefined}>
            Optimize
          </button>
        </div>

        {/* Empty state when scope not ready and not on dashboard */}
        {!data.scopeReady && tab !== "dashboard" && (
          <EmptyState
            subject={subject}
            phase={phase}
            theme={theme}
            capsule={capsule}
            subjectCount={Object.keys(subjects).length}
            phaseCount={phaseOptions.length}
            themeCount={themeOptions.length}
            capsuleCount={capsuleOptions.length}
            scopeWarning={scopeWarning}
          />
        )}

        {/* Loading indicator */}
        {data.loading && <div role="status" aria-live="polite" className="images-empty">Loading data...</div>}

        {/* Dashboard tab — works without scope */}
        {tab === "dashboard" && (
          <AnalyticsDashboard
            subject={subject || undefined}
            phase={phase || undefined}
            onSelectSubject={(s) => { setSubject(s); setTab("dashboard"); }}
          />
        )}

        {/* Workflow banner — scope-dependent tabs only, never on dashboard */}
        {data.scopeReady && tab !== "dashboard" && (
          <WorkflowBanner
            stats={data.stats}
            coverageSummary={data.coverageSummary}
            images={data.images}
            pairSummary={data.pairSummary}
            loading={data.loading}
            onRunCommand={runCommandWithModel}
            onSwitchTab={setTab}
          />
        )}

        {/* Scope-dependent tab content */}
        {tab === "explanations" && data.scopeReady && !data.loading && (
          <div role="tabpanel" aria-label="Explanations"><ExplanationList
            groupedExplanations={data.groupedExplanations}
            stats={data.stats}
            statusFilter={data.statusFilter}
            sortMode={data.sortMode}
            actionBusy={data.actionBusy}
            onAction={data.handleAction}
            onDirectAction={data.reviewAction}
            onBulkAction={data.bulkAction}
            onFilterChange={data.setStatusFilter}
            onSortChange={data.setSortMode}
          />
          </div>
        )}

        {tab === "images" && data.scopeReady && !data.loading && (
          <div role="tabpanel" aria-label="Images"><ImageList
            groupedImages={data.groupedImages}
            actionBusy={data.actionBusy}
            onAction={data.handleAction}
            onDirectAction={data.reviewAction}
            onBulkAction={data.bulkAction}
          />
          </div>
        )}

        {tab === "coverage" && data.scopeReady && !data.loading && (
          <div role="tabpanel" aria-label="Coverage"><CoverageGrid
            filteredCoverage={data.filteredCoverage}
            coverageSummary={data.coverageSummary}
            coverageFilter={data.coverageFilter}
            onFilterChange={setCoverageFilter}
            onFactClick={handleFactClick}
          />
          </div>
        )}

        {tab === "pairs" && data.scopeReady && !data.loading && (
          <div role="tabpanel" aria-label="Pairs"><PairList
            filteredPairs={data.filteredPairs}
            pairSummary={data.pairSummary}
            pairFilter={data.pairFilter}
            actionBusy={data.actionBusy}
            onAction={data.handleAction}
            onDirectAction={data.reviewAction}
            onFilterChange={data.setPairFilter}
          />
          </div>
        )}

        {tab === "optimize" && data.scopeReady && !data.loading && (
          <div role="tabpanel" aria-label="Optimize">
            <PromptOptimizer
              phase={String(phase)}
              theme={theme}
              capsule={capsule}
            />
            <IterationTimeline jobs={[...data.activeJobs, ...data.recentJobs]} />
          </div>
        )}

        {/* Recent jobs */}
        {data.scopeReady && <RecentJobs recentJobs={data.recentJobs} />}

        {/* Keyboard hint */}
        <div className="images-meta" style={{ marginTop: 8, opacity: 0.5, fontSize: 12 }}>
          <span>Keyboard: D = dashboard | 1/2/3/4/5 = switch tabs | R = refresh</span>
        </div>
      </main>
    </div>
  );
}

export default function DistillationReviewPage() {
  return (
    <Suspense fallback={<div className="images-page"><div className="images-empty">Loading...</div></div>}>
      <ReviewPageInner />
    </Suspense>
  );
}
