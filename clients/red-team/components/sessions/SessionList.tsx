"use client";

import { useState } from "react";
import type { SessionListItem } from "@/lib/types";
import { DataGrid, type Column } from "@/components/ui/DataGrid";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  fmtDate,
  fmtDuration,
  subjectBadgeClass,
  accuracyClass,
} from "./helpers";

interface SessionListProps {
  sessions: SessionListItem[];
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  serverPagination?: {
    total: number;
    offset: number;
    pageSize: number;
    onPrev: () => void;
    onNext: () => void;
    onSort?: (orderBy: string, orderDir: "ASC" | "DESC") => void;
    orderBy?: string | null;
    orderDir?: "ASC" | "DESC";
  };
}

export default function SessionList({
  sessions,
  currentSessionId,
  onSelect,
  onDelete,
  serverPagination,
}: SessionListProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const columns: Column<SessionListItem>[] = [
    { key: "student_name", header: "Student" },
    {
      key: "subject_name",
      header: "Subject",
      render: (s) => (
        <span className={`badge ${subjectBadgeClass(s.subject_name)}`}>
          {s.subject_name || "-"}
        </span>
      ),
    },
    { key: "capsule_name", header: "Capsule" },
    {
      key: "start_time",
      header: "Started",
      render: (s) => fmtDate(s.start_time),
    },
    {
      key: "duration_seconds",
      header: "Duration",
      render: (s) => fmtDuration(s.duration_seconds),
    },
    {
      key: "questions_asked",
      header: "Q&A",
      render: (s) => `${s.correct_answers}/${s.questions_asked}`,
    },
    {
      key: "accuracy",
      header: "Accuracy",
      render: (s) => {
        const str = s.accuracy != null ? s.accuracy.toFixed(0) + "%" : "-";
        return <span className={accuracyClass(s.accuracy)}>{str}</span>;
      },
    },
    {
      key: "total_tokens",
      header: "Tokens",
      render: (s) => (s.total_tokens || 0).toLocaleString(),
    },
    { key: "message_count", header: "Messages" },
    ...(onDelete
      ? [
          {
            key: "_actions",
            header: "",
            sortable: false,
            render: (s: SessionListItem) => (
              <button
                className="btn btn-danger"
                style={{ fontSize: 10, padding: "3px 8px" }}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setDeleteTarget(s.id);
                }}
              >
                Delete
              </button>
            ),
          } as Column<SessionListItem>,
        ]
      : []),
  ];

  return (
    <>
      <DataGrid
        columns={columns}
        rows={sessions}
        rowKey={(s) => s.id}
        onRowClick={(s) => onSelect(s.id)}
        activeRowKey={currentSessionId}
        emptyMessage="No sessions found"
        serverPagination={serverPagination}
      />
      {onDelete && (
        <ConfirmModal
          open={!!deleteTarget}
          title="Delete Session"
          message="Are you sure you want to delete this session?"
          onConfirm={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
