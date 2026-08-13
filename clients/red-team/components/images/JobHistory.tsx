"use client";

import { Icon } from "@/components/ui/Icon";
import type { ImageJob } from "@/lib/images/types";

type JobHistoryProps = {
  jobs: ImageJob[];
  monitoredJobId: string;
  onMonitor: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  title?: string;
};

export function JobHistory({ jobs, monitoredJobId, onMonitor, onCancel, title }: JobHistoryProps) {
  return (
    <section className="images-panel">
      <h2>{title || "Job History"}</h2>
      <div className="images-jobs">
        {jobs.map((job) => (
          <div key={job.id} className={`images-job${monitoredJobId === job.id ? " monitored" : ""}`}>
            <div className="images-job-head">
              <strong>{job.command}</strong>
              <span className={`badge ${job.status}`}>{job.status}</span>
            </div>
            <div className="images-meta">
              <span>Scope: {job.scope?.subject || "-"} / p{job.scope?.phase} / {job.scope?.theme} / {job.scope?.capsule}</span>
              <span>Prompt: {job.promptVersion || "-"}</span>
              <span>Models: {(job.imageModels || []).join(", ") || "-"}</span>
              <span>Strategies: {(job.promptStrategies || []).join(", ") || "-"}</span>
              <span>Items: {job.count ?? 0}</span>
            </div>
            <div className="images-actions">
              <button onClick={() => onMonitor(job.id)}>
                <Icon name="chart" /> Monitor
              </button>
              {["running", "queued", "cancel_requested"].includes(job.status) && (
                <button onClick={() => onCancel(job.id)}>
                  <Icon name="warning" /> Cancel
                </button>
              )}
            </div>
          </div>
        ))}
        {!jobs.length && <div className="images-empty">No jobs yet.</div>}
      </div>
    </section>
  );
}
