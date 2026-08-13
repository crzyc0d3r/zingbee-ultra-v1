"use client";

import { useMemo } from "react";
import type { DistillationJob } from "@/lib/distillations/types";

type IterationTimelineProps = {
  jobs: DistillationJob[];
};

// Commands that are part of the distillation pipeline
const DISTILLATION_COMMANDS = [
  "generate_explanations",
  "evaluate_explanations",
  "generate_images",
  "evaluate_images",
  "evaluate_pairs",
  "optimize_prompts",
  "full_loop",
];

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scopeKey(scope: Record<string, unknown>): string {
  const parts: string[] = [];
  if (scope.subject) parts.push(String(scope.subject));
  if (scope.phase) parts.push(`P${scope.phase}`);
  if (scope.theme) parts.push(String(scope.theme).slice(0, 8));
  if (scope.capsule) parts.push(String(scope.capsule).slice(0, 8));
  return parts.join(" / ") || "Global";
}

function commandLabel(cmd: string): string {
  return cmd
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function IterationTimeline({ jobs }: IterationTimelineProps) {
  // Filter to distillation jobs and group by scope
  const grouped = useMemo(() => {
    // Dedup by job ID (activeJobs and recentJobs can overlap)
    const seen = new Set<string>();
    const uniqueJobs = jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));

    const distJobs = uniqueJobs.filter((j) =>
      DISTILLATION_COMMANDS.includes(j.command),
    );

    const groups = new Map<string, DistillationJob[]>();
    for (const job of distJobs) {
      const key = scopeKey(job.scope);
      const existing = groups.get(key) || [];
      existing.push(job);
      groups.set(key, existing);
    }

    // Sort each group by startedAt desc
    for (const [, groupJobs] of groups) {
      groupJobs.sort((a, b) => {
        const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return bTime - aTime;
      });
    }

    return groups;
  }, [jobs]);

  if (grouped.size === 0) {
    return (
      <section className="images-panel" aria-label="Iteration Timeline">
        <h2>Iteration Timeline</h2>
        <div className="images-empty">No distillation pipeline jobs found.</div>
      </section>
    );
  }

  return (
    <section className="images-panel" aria-label="Iteration Timeline">
      <h2>Iteration Timeline</h2>

      {Array.from(grouped.entries()).map(([scope, scopeJobs]) => (
        <div key={scope} style={{ marginBottom: 16 }}>
          <h3 style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "#94a3b8",
            marginBottom: 8,
            paddingBottom: 4,
            borderBottom: "1px solid #1e293b",
          }}>
            {scope}
          </h3>

          <div style={{ position: "relative", paddingLeft: 24 }}>
            {/* Vertical line */}
            <div style={{
              position: "absolute",
              left: 8,
              top: 4,
              bottom: 4,
              width: 2,
              background: "#334155",
              borderRadius: 1,
            }} />

            {scopeJobs.map((job, idx) => {
              const isOptimize = job.command === "optimize_prompts";
              const dotColor = isOptimize
                ? "#a78bfa"
                : job.status === "completed"
                  ? "#22c55e"
                  : job.status === "running" || job.status === "queued"
                    ? "#f59e0b"
                    : job.status === "failed"
                      ? "#ef4444"
                      : "#475569";

              return (
                <div
                  key={job.id}
                  style={{
                    position: "relative",
                    marginBottom: idx < scopeJobs.length - 1 ? 8 : 0,
                  }}
                >
                  {/* Timeline dot */}
                  <div style={{
                    position: "absolute",
                    left: -20,
                    top: 4,
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: dotColor,
                    border: `2px solid ${isOptimize ? "#7c3aed" : "#0f172a"}`,
                    zIndex: 1,
                  }} />

                  <div
                    className="images-card"
                    style={{
                      margin: 0,
                      borderColor: isOptimize ? "#7c3aed" : undefined,
                      borderLeftWidth: isOptimize ? 3 : undefined,
                    }}
                  >
                    <div className="images-card-head" style={{ marginBottom: 2 }}>
                      <strong style={{
                        fontSize: 12,
                        color: isOptimize ? "#c4b5fd" : "#e2e8f0",
                      }}>
                        {commandLabel(job.command)}
                      </strong>
                      <span className={`badge ${job.status}`}>{job.status}</span>
                    </div>
                    <div className="images-meta">
                      <span>
                        Stage: {job.currentStage || "-"}
                        {job.totalCandidates > 0
                          ? ` -- ${job.itemsProcessed}/${job.totalCandidates} items`
                          : job.itemsProcessed > 0
                            ? ` -- ${job.itemsProcessed} items`
                            : ""}
                      </span>
                      <span style={{ fontSize: 10, color: "#475569" }}>
                        {formatTime(job.startedAt)}
                        {job.completedAt ? ` -- ${formatTime(job.completedAt)}` : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
