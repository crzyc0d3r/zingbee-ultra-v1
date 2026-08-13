"use client";

import { Icon } from "@/components/ui/Icon";
import type { ImageJobDetail } from "@/lib/images/types";

type JobMonitorProps = {
  jobDetail: ImageJobDetail | null;
  onCancel: (jobId: string) => void;
  emptyMessage?: string;
};

export function JobMonitor({ jobDetail, onCancel, emptyMessage }: JobMonitorProps) {
  if (!jobDetail) {
    return (
      <section className="images-panel images-monitor">
        <h2>Active Job Monitor</h2>
        <div className="images-empty">{emptyMessage || "Start a command or pick one from history to monitor."}</div>
      </section>
    );
  }

  const progress = jobDetail.totalCandidates
    ? Math.min(100, Math.round(((jobDetail.itemsProcessed || 0) / jobDetail.totalCandidates) * 100))
    : 0;

  return (
    <section className="images-panel images-monitor">
      <h2>Active Job Monitor</h2>
      <div className="images-monitor-content">
        <div className="images-card-head">
          <strong>{jobDetail.command} ({jobDetail.id})</strong>
          <span className={`badge ${jobDetail.status}`}>{jobDetail.status}</span>
        </div>
        <div className="images-meta">
          <span>Stage: {jobDetail.currentStage || "-"}</span>
          <span>
            Progress: {jobDetail.itemsProcessed ?? 0}
            {jobDetail.totalCandidates ? ` / ${jobDetail.totalCandidates}` : ""}
          </span>
          <span>Prompt: {jobDetail.promptVersion || "-"}</span>
          <span>Models: {(jobDetail.imageModels || []).join(", ") || "-"}</span>
          <span>Strategies: {(jobDetail.promptStrategies || []).join(", ") || "-"}</span>
        </div>
        <div className="images-progress-wrap">
          <div className="images-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        {(jobDetail.errors || []).length > 0 && (
          <div className="images-error">{(jobDetail.errors || []).join(" | ")}</div>
        )}
        {jobDetail.result?.lastNote && (
          <div className="images-empty">Note: {String(jobDetail.result.lastNote)}</div>
        )}
        {["running", "queued", "cancel_requested"].includes(jobDetail.status) && (
          <div className="images-actions">
            <button onClick={() => onCancel(jobDetail.id)}>
              <Icon name="warning" /> Cancel Job
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
