"use client";

import { useState, useMemo, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";
import "@/styles/datagrid.css";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  width?: number | string;
  align?: "left" | "center" | "right";
}

interface ServerPagination {
  total: number;
  offset: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  /** Server-side sort callback - when provided, sorting is delegated to server */
  onSort?: (orderBy: string, orderDir: "ASC" | "DESC") => void;
  /** Current server sort column */
  orderBy?: string | null;
  /** Current server sort direction */
  orderDir?: "ASC" | "DESC";
}

interface DataGridProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  activeRowKey?: string | null;
  pageSize?: number;
  emptyMessage?: string;
  loading?: boolean;
  /** Server-side pagination (and optionally sorting) */
  serverPagination?: ServerPagination;
}

function getValue(row: any, key: string): any {
  return row[key];
}

export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  activeRowKey,
  pageSize = 50,
  emptyMessage = "No rows found",
  loading,
  serverPagination,
}: DataGridProps<T>) {
  // Client-side sort state (used when no server sort callback)
  const [clientSortCol, setClientSortCol] = useState<string | null>(null);
  const [clientSortDir, setClientSortDir] = useState<"ASC" | "DESC">("ASC");
  const [page, setPage] = useState(0);

  const isServerPaged = !!serverPagination;
  const hasServerSort = !!serverPagination?.onSort;

  // Determine active sort state - prefer server sort when available
  const activeSortCol = hasServerSort
    ? (serverPagination.orderBy ?? null)
    : clientSortCol;
  const activeSortDir = hasServerSort
    ? (serverPagination.orderDir ?? "ASC")
    : clientSortDir;

  const handleSort = useCallback(
    (col: Column<T>) => {
      // All columns are sortable by default (sortable !== false)
      if (col.sortable === false) return;

      if (hasServerSort) {
        // Server-side sort
        const newDir =
          serverPagination.orderBy === col.key
            ? serverPagination.orderDir === "ASC"
              ? "DESC"
              : "ASC"
            : "ASC";
        serverPagination.onSort!(col.key, newDir);
      } else {
        // Client-side sort
        if (clientSortCol === col.key) {
          setClientSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
        } else {
          setClientSortCol(col.key);
          setClientSortDir("ASC");
        }
        setPage(0);
      }
    },
    [hasServerSort, serverPagination, clientSortCol],
  );

  // Client-side sort (only when not using server sort)
  const sorted = useMemo(() => {
    if (hasServerSort || !clientSortCol) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getValue(a, clientSortCol);
      const bv = getValue(b, clientSortCol);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number")
        return clientSortDir === "ASC" ? av - bv : bv - av;
      const sa = String(av).toLowerCase();
      const sb = String(bv).toLowerCase();
      const cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
      return clientSortDir === "ASC" ? cmp : -cmp;
    });
    return copy;
  }, [rows, clientSortCol, clientSortDir, hasServerSort]);

  // Pagination
  const displayRows = isServerPaged
    ? sorted
    : sorted.slice(page * pageSize, (page + 1) * pageSize);
  const total = isServerPaged ? serverPagination.total : rows.length;
  const offset = isServerPaged ? serverPagination.offset : page * pageSize;
  const effectivePageSize = isServerPaged
    ? serverPagination.pageSize
    : pageSize;

  const showFrom = total > 0 ? offset + 1 : 0;
  const showTo = Math.min(offset + effectivePageSize, total);
  const canPrev = offset > 0;
  const canNext = offset + effectivePageSize < total;

  const handlePrev = isServerPaged
    ? serverPagination.onPrev
    : () => setPage((p) => Math.max(0, p - 1));
  const handleNext = isServerPaged
    ? serverPagination.onNext
    : () => setPage((p) => p + 1);

  if (loading) {
    return (
      <div className="data-grid">
        <div className="table-wrap">
          <div className="empty">
            <div className="ico">
              <Icon name="hourglass" size={32} />
            </div>
            <div>Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  if (rows.length === 0 && total === 0) {
    return (
      <div className="data-grid">
        <div className="table-wrap">
          <div className="empty">
            <div className="ico">
              <Icon name="note" size={32} />
            </div>
            <div>{emptyMessage}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="data-grid">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((col) => {
                const isSortable = col.sortable !== false;
                const isActive = activeSortCol === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={{
                      width: col.width,
                      textAlign: col.align || "left",
                      cursor: isSortable ? "pointer" : "default",
                    }}
                    aria-sort={
                      isActive
                        ? activeSortDir === "ASC"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    onClick={isSortable ? () => handleSort(col) : undefined}
                  >
                    {col.header}
                    {isActive && (
                      <span className="arrow">
                        {activeSortDir === "ASC" ? " \u25B2" : " \u25BC"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, idx) => {
              const key = rowKey(row, idx);
              return (
                <tr
                  key={key}
                  className={
                    (onRowClick ? "clickable" : "") +
                    (activeRowKey === key ? " active" : "")
                  }
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{ textAlign: col.align || "left" }}
                    >
                      {col.render
                        ? col.render(row)
                        : getValue(row, col.key) != null
                          ? String(getValue(row, col.key))
                          : ""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="pagination">
          <div className="info">
            Showing {showFrom}-{showTo} of {total}
          </div>
          <button className="pg-btn" disabled={!canPrev} onClick={handlePrev}>
            Prev
          </button>
          <button className="pg-btn" disabled={!canNext} onClick={handleNext}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
