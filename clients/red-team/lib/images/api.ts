import { apiFetch } from "@/lib/api";
import type {
  DashboardSummary,
  HitlQueueResponse,
  ImageEvalOptions,
  ImageJob,
  ImageJobDetail,
  ImageScope,
  ImageVariant,
  SubjectPhasesResponse,
} from "@/lib/images/types";
import type { ImageCommand } from "@/lib/images/constants";

export async function fetchSubjectPhases() {
  return apiFetch<SubjectPhasesResponse>("/api/subject-phases");
}

export async function fetchScopeStructure(scope: Pick<ImageScope, "subject" | "phase">) {
  return apiFetch<{ themes: Record<string, string[]> }>(
    `/api/curriculum-structure/${scope.phase}?subject=${encodeURIComponent(scope.subject)}`,
  );
}

export async function fetchImageOptions(scope: ImageScope) {
  const query = new URLSearchParams({
    subject: scope.subject,
    phase: String(scope.phase),
    theme: scope.theme,
    capsule: scope.capsule,
  });
  return apiFetch<ImageEvalOptions>(`/image-eval/api/options?${query.toString()}`);
}

export async function fetchImageJobs() {
  return apiFetch<{ jobs: ImageJob[] }>("/image-eval/api/jobs");
}

export async function fetchImageJobDetail(jobId: string) {
  return apiFetch<ImageJobDetail>(`/image-eval/api/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelImageJob(jobId: string) {
  return apiFetch<{ ok: boolean; status: string }>(
    `/image-eval/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
}

export async function fetchImageVariants(
  scope: ImageScope,
  filters: { promptVersion?: string; model?: string; promptStrategy?: string } = {},
) {
  const query = new URLSearchParams({
    subject: scope.subject,
    phase: String(scope.phase),
    theme: scope.theme,
    capsule: scope.capsule,
  });
  if (filters.promptVersion) query.set("prompt_version", filters.promptVersion);
  if (filters.model) query.set("model", filters.model);
  if (filters.promptStrategy) query.set("prompt_strategy", filters.promptStrategy);
  return apiFetch<{ variants: ImageVariant[] }>(`/image-eval/api/variants?${query.toString()}`);
}

export async function startImageCommand(
  command: ImageCommand,
  scope: ImageScope,
  options: Record<string, unknown>,
) {
  return apiFetch<{ jobId: string; status: string }>("/image-eval/api/jobs", {
    method: "POST",
    body: JSON.stringify({ command, scope, options }),
  });
}

export async function reviewImageVariant(
  factId: string,
  variantId: string,
  action: "approve" | "reject" | "needs_work",
  note: string,
) {
  return apiFetch<{ ok: boolean }>(
    `/image-eval/api/variants/${encodeURIComponent(factId)}/${encodeURIComponent(variantId)}/review`,
    { method: "POST", body: JSON.stringify({ action, note }) },
  );
}

export async function overrideImageVariant(
  factId: string,
  variantId: string,
  decision: "SHIP" | "REVIEW" | "REGENERATE",
  composite: number,
  note: string,
) {
  return apiFetch<{ ok: boolean }>(
    `/image-eval/api/variants/${encodeURIComponent(factId)}/${encodeURIComponent(variantId)}/override`,
    { method: "POST", body: JSON.stringify({ decision, composite, note }) },
  );
}

export async function fetchHitlQueue(
  scope: ImageScope,
  filters: {
    promptVersion?: string;
    model?: string;
    promptStrategy?: string;
    queueFilter?: string;
    limit?: number;
  } = {},
) {
  const query = new URLSearchParams({
    subject: scope.subject,
    phase: String(scope.phase),
    theme: scope.theme,
    capsule: scope.capsule,
  });
  if (filters.promptVersion) query.set("prompt_version", filters.promptVersion);
  if (filters.model) query.set("model", filters.model);
  if (filters.promptStrategy) query.set("prompt_strategy", filters.promptStrategy);
  if (filters.queueFilter) query.set("queue_filter", filters.queueFilter);
  if (filters.limit) query.set("limit", String(filters.limit));
  return apiFetch<HitlQueueResponse>(`/image-eval/api/hitl/queue?${query.toString()}`);
}

export async function fetchDashboardSummary(
  scope: ImageScope,
  filters: { promptVersion?: string; model?: string; promptStrategy?: string } = {},
) {
  const query = new URLSearchParams({
    subject: scope.subject,
    phase: String(scope.phase),
    theme: scope.theme,
    capsule: scope.capsule,
  });
  if (filters.promptVersion) query.set("prompt_version", filters.promptVersion);
  if (filters.model) query.set("model", filters.model);
  if (filters.promptStrategy) query.set("prompt_strategy", filters.promptStrategy);
  return apiFetch<DashboardSummary>(`/image-eval/api/dashboard/summary?${query.toString()}`);
}

export async function regenerateImageVariant(
  factId: string,
  variantId: string,
  body: {
    subject?: string;
    phase: number;
    theme: string;
    capsule: string;
    next_prompt_version?: string;
  },
) {
  return apiFetch<{ ok: boolean; result: Record<string, unknown> }>(
    `/image-eval/api/variants/${encodeURIComponent(factId)}/${encodeURIComponent(variantId)}/regenerate`,
    { method: "POST", body: JSON.stringify(body) },
  );
}
