import { apiFetch } from "@/lib/api";
import type {
  MetaphorCapsuleDetail,
  MetaphorCapsuleListEntry,
  MetaphorCoverage,
  MetaphorJob,
  MetaphorReviewStatus,
} from "./types";

export async function fetchMetaphorCapsules(filters: {
  subject?: string;
  phase?: number | null;
  status?: MetaphorReviewStatus | null;
}) {
  const params = new URLSearchParams();
  if (filters.subject) params.set("subject", filters.subject);
  if (filters.phase != null) params.set("phase", String(filters.phase));
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return apiFetch<{ capsules: MetaphorCapsuleListEntry[]; count: number }>(
    `/metaphor-eval/api/capsules${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchMetaphorCapsule(capsuleId: string) {
  return apiFetch<MetaphorCapsuleDetail>(
    `/metaphor-eval/api/capsules/${capsuleId}`,
  );
}

export async function fetchMetaphorCoverage(filters: {
  subject?: string;
  phase?: number | null;
}) {
  const params = new URLSearchParams();
  if (filters.subject) params.set("subject", filters.subject);
  if (filters.phase != null) params.set("phase", String(filters.phase));
  const qs = params.toString();
  return apiFetch<MetaphorCoverage>(
    `/metaphor-eval/api/coverage${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchMetaphorJobs(command?: "evaluate" | "regenerate") {
  const qs = command ? `?command=${command}` : "";
  return apiFetch<{ jobs: MetaphorJob[] }>(`/metaphor-eval/api/jobs${qs}`);
}

export async function kickOffEvaluateJob(scope: {
  capsule_id?: string;
  subject?: string;
  phase?: number;
}, options: Record<string, unknown> = {}) {
  return apiFetch<{ jobId: string; status: string }>(
    "/metaphor-eval/api/jobs",
    {
      method: "POST",
      body: JSON.stringify({ command: "evaluate", scope, options }),
    },
  );
}

export async function cancelMetaphorJob(jobId: string) {
  return apiFetch<{ ok: boolean; status: string }>(
    `/metaphor-eval/api/jobs/${jobId}/cancel`,
    { method: "POST" },
  );
}

export async function reviewCapsuleAction(
  capsuleId: string,
  body: {
    action: "approve" | "reject" | "edit_then_approve";
    candidate_id?: string | null;
    edited_metaphor?: string;
    note?: string;
  },
) {
  return apiFetch<{ ok: boolean }>(
    `/metaphor-eval/api/capsules/${capsuleId}/review`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function regenerateCapsule(capsuleId: string) {
  return apiFetch<{ ok: boolean; result: unknown }>(
    `/metaphor-eval/api/capsules/${capsuleId}/regenerate`,
    { method: "POST" },
  );
}
