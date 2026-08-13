import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/distillations/api";
import type {
  CoverageFilter,
  CoverageFact,
  CoverageSummary,
  DistillationImageVariant,
  DistillationJob,
  DistillationScope,
  ExplanationStats,
  ExplanationVariant,
  PairData,
  PairFilter,
  PairSummary,
  SortMode,
  StatusFilter,
} from "@/lib/distillations/types";

const EMPTY_COVERAGE_SUMMARY: CoverageSummary = {
  totalFacts: 0, readyFacts: 0, coveragePercent: 0,
  factsWithApprovedExplanation: 0, factsWithShippedImage: 0,
  notStarted: 0, inProgress: 0,
};

const EMPTY_PAIR_SUMMARY: PairSummary = {
  total: 0, ship: 0, review: 0, regenerate: 0, unevaluated: 0,
};

export type PipelineLimits = {
  genMaxFacts: number;
  evalMaxEvaluations: number;
  imgMaxExplanations: number;
  imgVariantsPerExplanation: number;
  imgEvalMaxEvaluations: number;
};

export type ConfirmActionState = {
  type: string;
  factId: string;
  variantId: string;
  action: string;
} | null;

export function useDistillationData(scope: {
  subject: string;
  phase: string;
  theme: string;
  capsule: string;
}) {
  const { subject, phase, theme, capsule } = scope;
  const scopeReady = Boolean(subject && phase && theme && capsule);

  // --- Raw data state ---
  const [explanations, setExplanations] = useState<ExplanationVariant[]>([]);
  const [images, setImages] = useState<DistillationImageVariant[]>([]);
  const [pairs, setPairs] = useState<PairData[]>([]);
  const [pairSummary, setPairSummary] = useState<PairSummary>(EMPTY_PAIR_SUMMARY);
  const [coverage, setCoverage] = useState<CoverageFact[]>([]);
  const [coverageSummary, setCoverageSummary] = useState<CoverageSummary>(EMPTY_COVERAGE_SUMMARY);
  const [jobs, setJobs] = useState<DistillationJob[]>([]);

  // --- UI state ---
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [prerequisiteError, setPrerequisiteError] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState>(null);
  const [confirmNote, setConfirmNote] = useState("");

  // --- Filter/sort state ---
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("order");
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>("all");
  const [pairFilter, setPairFilter] = useState<PairFilter>("all");

  // --- Pipeline limits ---
  const [limits, setLimits] = useState<PipelineLimits>({
    genMaxFacts: 5,
    evalMaxEvaluations: 50,
    imgMaxExplanations: 10,
    imgVariantsPerExplanation: 3,
    imgEvalMaxEvaluations: 50,
  });
  const [showOptions, setShowOptions] = useState(false);

  // --- Highlight state (for coverage → explanation nav) ---
  const [highlightFactId, setHighlightFactId] = useState<string | null>(null);

  // --- Last completed command (for auto-tab switching in PR 3) ---
  const [lastCompletedCommand, setLastCompletedCommand] = useState<string | null>(null);

  // --- Build scope for API calls ---
  const apiScope: DistillationScope | null = useMemo(() => {
    if (!scopeReady) return null;
    return {
      subject,
      phase: Number(phase),
      theme,
      capsule,
    };
  }, [scopeReady, subject, phase, theme, capsule]);

  // --- Data loading ---
  const loadData = useCallback(async () => {
    if (!apiScope) return;
    setLoading(true);
    try {
      const [varRes, covRes, jobsRes, imgRes, pairsRes] = await Promise.all([
        api.fetchVariants(apiScope),
        api.fetchCoverage(apiScope),
        api.fetchJobs(),
        api.fetchImageQueue(apiScope),
        api.fetchPairs(apiScope).catch(() => ({
          pairs: [] as PairData[],
          summary: EMPTY_PAIR_SUMMARY,
        })),
      ]);
      setExplanations(varRes.variants || []);
      setCoverage(covRes.coverage || []);
      setCoverageSummary(covRes.summary || EMPTY_COVERAGE_SUMMARY);
      setJobs(jobsRes.jobs || []);
      setImages(imgRes.images || []);
      setPairs(pairsRes.pairs || []);
      setPairSummary(pairsRes.summary || EMPTY_PAIR_SUMMARY);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [apiScope]);

  // Auto-load on scope change
  useEffect(() => { loadData(); }, [loadData]);

  // --- Active jobs ---
  const activeJobs = useMemo(
    () => jobs.filter((j) => ["running", "queued", "cancel_requested"].includes(j.status)),
    [jobs],
  );

  // Auto-reload when last active job finishes
  const prevActiveCountRef = useRef(activeJobs.length);
  useEffect(() => {
    if (activeJobs.length === 0 && prevActiveCountRef.current > 0) {
      // Track which command just completed for auto-tab switching
      const lastJob = [...jobs]
        .filter((j) => j.status === "completed" && j.completedAt)
        .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""))
        [0];
      if (lastJob) setLastCompletedCommand(lastJob.command);
      loadData();
    }
    prevActiveCountRef.current = activeJobs.length;
  }, [activeJobs.length, jobs, loadData]);

  // Poll jobs when active
  useEffect(() => {
    if (activeJobs.length === 0) return;
    let visible = true;
    const onVis = () => { visible = !document.hidden; };
    document.addEventListener("visibilitychange", onVis);
    const timer = setInterval(() => {
      if (!visible) return;
      api.fetchJobs().then((r) => setJobs(r.jobs || [])).catch((e) => {
        console.warn("Job poll failed:", e instanceof Error ? e.message : e);
      });
    }, 5000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeJobs.length]);

  // --- Command execution ---
  const runCommand = useCallback(async (command: string, extraOptions?: Record<string, unknown>) => {
    if (!apiScope) return;
    setError("");
    setPrerequisiteError("");

    let options: Record<string, unknown> = {};
    if (command === "generate_explanations") {
      options = { max_facts: limits.genMaxFacts };
    } else if (command === "evaluate_explanations") {
      options = { max_evaluations: limits.evalMaxEvaluations };
    } else if (command === "generate_images") {
      options = { img_max_explanations: limits.imgMaxExplanations, variants_per_fact: limits.imgVariantsPerExplanation };
    } else if (command === "evaluate_images") {
      options = { max_evaluations: limits.imgEvalMaxEvaluations };
    } else if (command === "full_loop") {
      options = {
        max_facts: limits.genMaxFacts,
        img_max_explanations: limits.imgMaxExplanations,
        max_evaluations: limits.evalMaxEvaluations,
        variants_per_fact: limits.imgVariantsPerExplanation,
      };
    }

    // Merge caller-supplied extras (e.g. model selection from ProviderSelector)
    if (extraOptions) {
      options = { ...options, ...extraOptions };
    }

    try {
      const prereqRes = await api.checkPrerequisites(command, apiScope);
      if (!prereqRes.ok) {
        setPrerequisiteError(prereqRes.issues?.join("; ") || "Prerequisites not met");
        return;
      }
      await api.startJob(command, apiScope, options);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start command");
    }
  }, [apiScope, limits, loadData]);

  // --- Job cancellation ---
  const handleCancelJob = useCallback(async (jobId: string) => {
    try {
      await api.cancelJob(jobId);
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: "cancel_requested" } : j));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to cancel job");
    }
  }, []);

  // --- Review actions ---
  const reviewAction = useCallback(async (type: string, factId: string, variantId: string, action: string) => {
    if (!apiScope) return;
    const key = `${factId}:${variantId}`;
    setActionBusy(key);
    try {
      await api.submitReviewAction({
        type, factId, variantId, action,
        note: confirmNote || undefined,
        scope: action === "regenerate" ? apiScope : undefined,
      });
      if (type === "explanation" && (action === "approve" || action === "reject" || action === "regenerate")) {
        const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "regenerating";
        setExplanations((prev) => prev.map((e) =>
          e.factId === factId && e.variantId === variantId ? { ...e, status: newStatus, humanReviewStatus: action } : e
        ));
      } else {
        await loadData();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionBusy("");
      setConfirmAction(null);
      setConfirmNote("");
    }
  }, [apiScope, confirmNote, loadData]);

  const handleAction = useCallback((type: string, factId: string, variantId: string, action: string) => {
    if (action === "reject" || action === "regenerate" || action === "needs_work") {
      setConfirmNote("");
      setConfirmAction({ type, factId, variantId, action });
    } else {
      reviewAction(type, factId, variantId, action);
    }
  }, [reviewAction]);

  const bulkAction = useCallback(async (action: "approve" | "reject", minScore?: number, itemType: string = "explanation") => {
    if (!apiScope) return;
    setError("");
    try {
      const result = await api.submitBulkAction({
        type: itemType, action, scope: apiScope, minScore,
      });
      await loadData();
      setSuccessMessage(`Bulk ${action}: ${result.affected} variants updated`);
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bulk action failed");
    }
  }, [apiScope, loadData]);

  // --- Computed values ---
  const stats: ExplanationStats = useMemo(() => {
    const total = explanations.length;
    const approved = explanations.filter((e) => e.status === "approved").length;
    const review = explanations.filter((e) => e.status === "review").length;
    const draft = explanations.filter((e) => e.status === "draft").length;
    const regenerating = explanations.filter((e) => e.status === "regenerating").length;
    return { total, approved, review, draft, regenerating };
  }, [explanations]);

  const groupedExplanations = useMemo(() => {
    let filtered = explanations;
    if (statusFilter !== "all") filtered = filtered.filter((e) => e.status === statusFilter);
    const map = new Map<string, ExplanationVariant[]>();
    for (const exp of filtered) {
      const a = map.get(exp.factId) || [];
      a.push(exp);
      map.set(exp.factId, a);
    }
    const entries = Array.from(map.entries());
    if (sortMode === "score_asc") {
      entries.sort((a, b) => Math.min(...a[1].map((e) => e.compositeScore ?? 1)) - Math.min(...b[1].map((e) => e.compositeScore ?? 1)));
    } else if (sortMode === "score_desc") {
      entries.sort((a, b) => Math.max(...b[1].map((e) => e.compositeScore ?? 0)) - Math.max(...a[1].map((e) => e.compositeScore ?? 0)));
    } else {
      entries.sort((a, b) => (a[1][0]?.factOrder || 0) - (b[1][0]?.factOrder || 0));
    }
    return entries;
  }, [explanations, statusFilter, sortMode]);

  const groupedImages = useMemo(() => {
    const map = new Map<string, DistillationImageVariant[]>();
    for (const img of images) {
      const a = map.get(img.factId) || [];
      a.push(img);
      map.set(img.factId, a);
    }
    return Array.from(map.entries()).sort((a, b) => (a[1][0]?.factOrder || 0) - (b[1][0]?.factOrder || 0));
  }, [images]);

  const filteredPairs = useMemo(() => {
    if (pairFilter === "all") return pairs;
    if (pairFilter === "unevaluated") return pairs.filter((p) => !p.pairEvaluation.decision);
    return pairs.filter((p) => (p.pairEvaluation.decision || "").toUpperCase() === pairFilter);
  }, [pairs, pairFilter]);

  const filteredCoverage = useMemo(() => {
    if (coverageFilter === "all") return coverage;
    return coverage.filter((f) => {
      if (coverageFilter === "ready") return f.ready;
      if (coverageFilter === "not_started") return f.explanations.total === 0 && f.images.total === 0;
      if (coverageFilter === "in_progress") return !f.ready && (f.explanations.total > 0 || f.images.total > 0);
      return true;
    });
  }, [coverage, coverageFilter]);

  const recentJobs = useMemo(() => jobs.slice(0, 10), [jobs]);

  return {
    // State
    scopeReady,
    loading,
    error,
    successMessage,
    prerequisiteError,
    actionBusy,
    confirmAction,
    confirmNote,
    highlightFactId,
    showOptions,
    lastCompletedCommand,

    // Raw data
    explanations,
    images,
    pairs,
    coverage,
    jobs,

    // Summaries
    stats,
    coverageSummary,
    pairSummary,

    // Filtered/grouped
    groupedExplanations,
    groupedImages,
    filteredPairs,
    filteredCoverage,
    activeJobs,
    recentJobs,

    // Filters
    statusFilter,
    sortMode,
    coverageFilter,
    pairFilter,
    limits,

    // Actions
    loadData,
    runCommand,
    handleCancelJob,
    reviewAction,
    handleAction,
    bulkAction,

    // Setters
    setError,
    setConfirmAction,
    setConfirmNote,
    setHighlightFactId,
    setShowOptions,
    setStatusFilter,
    setSortMode,
    setCoverageFilter,
    setPairFilter,
    setLimits,
    setLastCompletedCommand,
  };
}
