import { Icon } from "@/components/ui/Icon";
import type { DistillationJob } from "@/lib/distillations/types";

type ActiveJobsProps = {
  activeJobs: DistillationJob[];
  onCancel: (jobId: string) => void;
};

export function ActiveJobs({ activeJobs, onCancel }: ActiveJobsProps) {
  if (activeJobs.length === 0) return null;

  return (
    <section className="images-panel images-monitor" aria-label="Active jobs">
      <h2>Active Jobs</h2>
      {activeJobs.map((job) => {
        const pct = job.totalCandidates > 0
          ? Math.min(100, Math.round((job.itemsProcessed / job.totalCandidates) * 100))
          : 0;
        return (
          <div key={job.id} className="images-monitor-content" style={{ marginBottom: 8 }}>
            <div className="images-card-head">
              <strong>{job.command} ({job.id})</strong>
              <span className={`badge ${job.status}`}>{job.status}</span>
            </div>
            <div className="images-meta">
              <span>Stage: {job.currentStage || "-"}</span>
              <span>Progress: {job.itemsProcessed}{job.totalCandidates ? ` / ${job.totalCandidates}` : ""}</span>
            </div>
            {job.totalCandidates > 0 && (
              <div
                className="images-progress-wrap"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Job progress: ${pct}%`}
              >
                <div className="images-progress-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className="images-actions">
              <button onClick={() => onCancel(job.id)}>
                <Icon name="warning" /> Cancel
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
