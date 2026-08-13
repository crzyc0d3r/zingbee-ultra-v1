"use client";

import { useState } from "react";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ScoreBarInline } from "./ScoreBar";
import { formatDuration, SCORE_KEYS } from "./helpers";

interface RunSummary {
  id: string;
  config: string;
  subjects: string[];
  capsuleCount: number;
  avgScores: Record<string, number | null>;
  totalTokens: number;
  totalDuration: number;
}

interface RunsListProps {
  runs: RunSummary[];
  onRunClick: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
}

function parseRunDate(id: string): string {
  const ds = id.substring(0, 8);
  const ts = id.substring(9, 15);
  return `${ds.substring(4, 6)}/${ds.substring(6, 8)} ${ts.substring(0, 2)}:${ts.substring(2, 4)}`;
}

export function RunsList({ runs, onRunClick, onDeleteRun }: RunsListProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const columns: Column<RunSummary>[] = [
    {
      key: "id",
      header: "Date",
      render: (r) => parseRunDate(r.id),
    },
    {
      key: "config",
      header: "Config",
      render: (r) => <span className="badge badge-blue">{r.config}</span>,
    },
    {
      key: "subjects",
      header: "Subjects",
      sortable: false,
      render: (r) => r.subjects.join(", "),
    },
    {
      key: "capsuleCount",
      header: "Capsules",
      align: "center",
    },
    ...SCORE_KEYS.map(
      (k): Column<RunSummary> => ({
        key: k,
        header:
          k === "age_appropriateness"
            ? "Age Approp."
            : k.charAt(0).toUpperCase() + k.slice(1),
        render: (r) => <ScoreBarInline value={r.avgScores[k]} />,
      }),
    ),
    {
      key: "totalTokens",
      header: "Tokens",
      render: (r) => (r.totalTokens || 0).toLocaleString(),
    },
    {
      key: "totalDuration",
      header: "Duration",
      render: (r) => formatDuration(r.totalDuration || 0),
    },
    {
      key: "_actions",
      header: "",
      sortable: false,
      render: (r) => (
        <button
          className="btn btn-danger"
          style={{ fontSize: 10, padding: "3px 8px" }}
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(r.id);
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
        rows={runs}
        rowKey={(r) => r.id}
        onRowClick={(r) => onRunClick(r.id)}
        pageSize={25}
        emptyMessage="No completed runs yet"
      />
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Run"
        message={`Are you sure you want to delete run ${deleteTarget}?`}
        onConfirm={() => { if (deleteTarget) onDeleteRun(deleteTarget); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
