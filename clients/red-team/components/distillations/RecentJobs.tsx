import type { DistillationJob } from "@/lib/distillations/types";

type RecentJobsProps = {
  recentJobs: DistillationJob[];
};

export function RecentJobs({ recentJobs }: RecentJobsProps) {
  return (
    <section className="images-panel" style={{ marginTop: 12 }} aria-label="Recent jobs">
      <h2>Recent Jobs</h2>
      <div className="images-jobs">
        {recentJobs.map((job) => (
          <div key={job.id} className="images-job">
            <div className="images-job-head">
              <strong>{job.command}</strong>
              <span className={`badge ${job.status}`}>{job.status}</span>
            </div>
            <div className="images-meta">
              <span>Stage: {job.currentStage || "-"}</span>
              <span>Items: {job.itemsProcessed}</span>
              <span>Started: {job.startedAt || "-"}</span>
            </div>
          </div>
        ))}
        {!recentJobs.length && <div className="images-empty">No jobs yet.</div>}
      </div>
    </section>
  );
}
