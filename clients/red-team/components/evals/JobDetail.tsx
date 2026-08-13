"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "./helpers";

interface JobData {
  id: string;
  status: string;
  targets: string[];
  config: string;
  persona: string;
  enableGrading?: boolean;
  maxTurns?: number | null;
  pid?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  log?: string;
}

interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const [job, setJob] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const loadJob = useCallback(async () => {
    try {
      const data = await apiFetch<JobData>(
        `/evals/api/jobs/${encodeURIComponent(jobId)}`
      );
      setJob(data);
      setError(false);
      setLoading(false);
    } catch (e: any) {
      if (e.message !== "auth") {
        setError(true);
        setLoading(false);
      }
    }
  }, [jobId]);

  // Initial load
  useEffect(() => {
    loadJob();
  }, [loadJob]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [job?.log]);

  // Auto-refresh while running
  useEffect(() => {
    if (job && job.status === "running") {
      refreshRef.current = setInterval(loadJob, 1000);
    }
    return () => {
      if (refreshRef.current) {
        clearInterval(refreshRef.current);
        refreshRef.current = null;
      }
    };
  }, [job?.status, loadJob]);

  const handleCancel = async () => {
    try {
      await apiFetch(`/evals/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
      });
      toast("Job cancelled", "success");
      loadJob();
    } catch {
      // handled
    }
  };

  if (loading) {
    return (
      <div className="empty">
        <div className="ico">
          <Icon name="hourglass" size={32} />
        </div>
        <div>Loading job...</div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="empty">
        <div className="ico">
          <Icon name="warning" size={32} />
        </div>
        <div>Failed to load job</div>
      </div>
    );
  }

  const statusBadge = (() => {
    switch (job.status) {
      case "running":
        return <span className="badge badge-blue">Running</span>;
      case "completed":
        return <span className="badge badge-green">Completed</span>;
      case "failed":
        return <span className="badge badge-red">Failed</span>;
      case "cancelled":
        return <span className="badge badge-yellow">Cancelled</span>;
      default:
        return <span className="badge badge-gray">{job.status}</span>;
    }
  })();

  return (
    <>
      <a className="back-link" onClick={onBack} role="button" tabIndex={0}>
        <Icon name="back" size={12} /> Back to Running Jobs
      </a>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 16, color: "#f1f5f9" }}>Job {job.id}</h2>
        {statusBadge}
        {job.status === "running" && (
          <button
            className="btn btn-danger"
            style={{ marginLeft: "auto" }}
            onClick={handleCancel}
          >
            Cancel
          </button>
        )}
      </div>

      <div className="detail-panel">
        <h3>Configuration</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            fontSize: 12,
          }}
        >
          <div style={{ color: "#94a3b8" }}>Targets</div>
          <div>{job.targets.join(", ")}</div>
          <div style={{ color: "#94a3b8" }}>Config</div>
          <div>
            <span className="badge badge-blue">{job.config}</span>
          </div>
          <div style={{ color: "#94a3b8" }}>Persona</div>
          <div>{job.persona}</div>
          <div style={{ color: "#94a3b8" }}>Grading</div>
          <div>{job.enableGrading ? "Enabled" : "Disabled"}</div>
          <div style={{ color: "#94a3b8" }}>Max Turns</div>
          <div>{job.maxTurns || "Default"}</div>
          <div style={{ color: "#94a3b8" }}>PID</div>
          <div style={{ fontFamily: "monospace" }}>{job.pid || "N/A"}</div>
          <div style={{ color: "#94a3b8" }}>Started</div>
          <div>{job.startedAt ? formatDate(job.startedAt) : "-"}</div>
          {job.completedAt && (
            <>
              <div style={{ color: "#94a3b8" }}>Completed</div>
              <div>{formatDate(job.completedAt)}</div>
            </>
          )}
        </div>
        {job.error && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              background: "#7f1d1d",
              border: "1px solid #ef4444",
              borderRadius: 6,
              fontSize: 12,
              color: "#fecaca",
            }}
          >
            {job.error}
          </div>
        )}
      </div>

      <div className="detail-panel">
        <h3
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          Output Log{" "}
          <button
            className="btn btn-secondary"
            style={{ fontSize: 10, padding: "3px 8px" }}
            onClick={loadJob}
          >
            <Icon name="refresh" size={12} /> Refresh
          </button>
        </h3>
        {job.log ? (
          <div
            className="log-box"
            ref={logBoxRef}
            style={{ whiteSpace: "pre-wrap" }}
            dangerouslySetInnerHTML={{
              __html: job.log
                .replace(/\x1b\[[0-9;]*m/g, "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;"),
            }}
          />
        ) : (
          <div style={{ color: "#475569", fontSize: 12 }}>
            No log output yet...
          </div>
        )}
      </div>
    </>
  );
}
