"use client";

import { useState } from "react";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatDate } from "./helpers";

interface Job {
  id: string;
  status: string;
  targets: string[];
  config: string;
  persona: string;
  pid?: number;
  startedAt?: string;
  completedAt?: string;
}

interface JobsListProps {
  jobs: Job[];
  onJobClick: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
}

export function JobsList({
  jobs,
  onJobClick,
  onCancelJob,
  onDeleteJob,
}: JobsListProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const columns: Column<Job>[] = [
    {
      key: "id",
      header: "ID",
      render: (j) =>
        j.status === "running" ? (
          <span
            className="badge badge-blue"
            style={{ animation: "pulse 1.5s infinite" }}
          >
            {j.id}
          </span>
        ) : (
          j.id
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (j) => {
        const badge =
          j.status === "running"
            ? "badge-blue"
            : j.status === "completed"
              ? "badge-green"
              : j.status === "cancelled"
                ? "badge-yellow"
                : "badge-red";
        return <span className={`badge ${badge}`}>{j.status}</span>;
      },
    },
    {
      key: "targets",
      header: "Targets",
      sortable: false,
      render: (j) => j.targets.join(", "),
    },
    {
      key: "config",
      header: "Config",
      render: (j) => <span className="badge badge-blue">{j.config}</span>,
    },
    { key: "persona", header: "Persona" },
    {
      key: "startedAt",
      header: "Started",
      render: (j) => (j.startedAt ? formatDate(j.startedAt) : "-"),
    },
    {
      key: "completedAt",
      header: "Completed",
      render: (j) => (j.completedAt ? formatDate(j.completedAt) : "-"),
    },
    {
      key: "_actions",
      header: "",
      sortable: false,
      render: (j) =>
        j.status === "running" ? (
          <button
            className="btn btn-danger"
            style={{ fontSize: 10, padding: "3px 8px" }}
            onClick={(e) => {
              e.stopPropagation();
              onCancelJob(j.id);
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            className="btn btn-danger"
            style={{ fontSize: 10, padding: "3px 8px" }}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(j.id);
            }}
          >
            Delete
          </button>
        ),
    },
  ];

  return (
    <>
      <DataGrid
        columns={columns}
        rows={jobs}
        rowKey={(j) => j.id}
        onRowClick={(j) => onJobClick(j.id)}
        pageSize={25}
        emptyMessage="No jobs yet"
      />
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Job"
        message={`Are you sure you want to delete job ${deleteTarget}?`}
        onConfirm={() => { if (deleteTarget) onDeleteJob(deleteTarget); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
