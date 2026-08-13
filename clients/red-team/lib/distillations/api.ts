import { apiFetch } from "@/lib/api";
import type {
  CoverageFact,
  CoverageSummary,
  DistillationImageVariant,
  DistillationJob,
  DistillationScope,
  ExplanationVariant,
  PairData,
  PairSummary,
  PipelineHealthSummary,
} from "./types";

function scopeQuery(scope: DistillationScope): string {
  const params = new URLSearchParams({
    phase: String(scope.phase),
    theme: scope.theme,
    capsule: scope.capsule,
  });
  if (scope.subject) params.set("subject", scope.subject);
  return params.toString();
}

// --- Variants ---

export async function fetchVariants(scope: DistillationScope) {
  return apiFetch<{ variants: ExplanationVariant[] }>(
    `/distillations/api/variants?${scopeQuery(scope)}`,
  );
}

// --- Coverage ---

export async function fetchCoverage(scope: DistillationScope) {
  return apiFetch<{ coverage: CoverageFact[]; summary: CoverageSummary }>(
    `/distillations/api/coverage?${scopeQuery(scope)}`,
  );
}

// --- Jobs ---

export async function fetchJobs() {
  return apiFetch<{ jobs: DistillationJob[] }>("/distillations/api/jobs");
}

// --- Image review queue ---

export async function fetchImageQueue(scope: DistillationScope) {
  return apiFetch<{ images: DistillationImageVariant[] }>(
    `/distillations/api/review/queue?${scopeQuery(scope)}&queue_filter=all`,
  );
}

// --- Pairs ---

export async function fetchPairs(scope: DistillationScope) {
  return apiFetch<{ pairs: PairData[]; summary: PairSummary }>(
    `/distillations/api/pairs?${scopeQuery(scope)}`,
  );
}

// --- Prerequisites ---

export async function checkPrerequisites(
  command: string,
  scope: DistillationScope,
) {
  return apiFetch<{ ok: boolean; issues?: string[] }>(
    "/distillations/api/prerequisites",
    {
      method: "POST",
      body: JSON.stringify({ command, scope }),
    },
  );
}

// --- Job management ---

export async function startJob(
  command: string,
  scope: DistillationScope,
  options: Record<string, unknown> = {},
) {
  return apiFetch<{ jobId: string; status: string }>("/distillations/api/jobs", {
    method: "POST",
    body: JSON.stringify({ command, scope, options }),
  });
}

export async function cancelJob(jobId: string) {
  return apiFetch<{ ok: boolean }>(
    `/distillations/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
}

// --- Review actions ---

export async function submitReviewAction(params: {
  type: string;
  factId: string;
  variantId: string;
  action: string;
  note?: string;
  scope?: DistillationScope;
}) {
  return apiFetch<{ ok: boolean }>("/distillations/api/review/action", {
    method: "POST",
    body: JSON.stringify({
      type: params.type,
      factId: params.factId,
      variantId: params.variantId,
      action: params.action,
      ...(params.note ? { note: params.note } : {}),
      ...(params.action === "regenerate" && params.scope
        ? { scope: params.scope }
        : {}),
    }),
  });
}

export async function submitBulkAction(params: {
  type: string;
  action: "approve" | "reject";
  scope: DistillationScope;
  minScore?: number;
}) {
  return apiFetch<{ ok: boolean; affected: number }>(
    "/distillations/api/review/bulk-action",
    {
      method: "POST",
      body: JSON.stringify({
        type: params.type,
        action: params.action,
        phase: params.scope.phase,
        theme: params.scope.theme,
        capsule: params.scope.capsule,
        subject: params.scope.subject,
        minScore: params.minScore,
      }),
    },
  );
}

// --- Analytics (PR 2 — stub for now) ---

export async function fetchPipelineHealth(filters?: {
  subject?: string;
  phase?: number;
  drilldown?: "subject" | "phase";
}) {
  const params = new URLSearchParams();
  if (filters?.subject) params.set("subject", filters.subject);
  if (filters?.phase != null) params.set("phase", String(filters.phase));
  if (filters?.drilldown) params.set("drilldown", filters.drilldown);
  const qs = params.toString();
  return apiFetch<PipelineHealthSummary>(
    `/distillations/api/health${qs ? `?${qs}` : ""}`,
  );
}
