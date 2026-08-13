"use client";

import { Icon } from "@/components/ui/Icon";
import type { TableSchema, ChildDef } from "@/lib/types";

// Extended column info from API (has_default, max_length come from server)
interface ExtColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  has_default?: boolean;
  max_length?: number | null;
}

// Per-table visible columns for the grid display.
// Tables not listed here show all columns.
const TABLE_DISPLAY_COLS: Record<string, string[]> = {
  subjects: ["name", "description", "created_at"],
  subject_curriculum: ["subject_id", "phase", "age_range"],
  curriculum_themes: ["name", "theme_order", "tutor_name", "learning_system_name"],
  curriculum_capsules: ["name", "capsule_order"],
  curriculum_facts: ["fact_name", "order"],
  users: ["email", "display_name", "first_name", "last_name", "role", "is_active", "created_at", "last_login"],
  students: ["student_id", "name", "user_id", "created_date", "last_session", "total_credits"],
  learning_sessions: ["user_id", "student_id", "curriculum_capsule_id", "start_time", "end_time", "questions_asked", "correct_answers", "total_tokens", "facts_taught_count", "accuracy"],
  tutors: ["tutor_name", "persona"],
  learning_system_schemas: ["name", "create_date"],
};

// Fixed column widths: global or per-table (table.col)
const COL_WIDTHS: Record<string, number> = {
  "subjects.name": 100,
  "subjects.created_at": 120,
  "curriculum_themes.created_at": 120,
  theme_order: 100,
  capsule_order: 100,
  credit_value: 100,
  fact_order: 100,
  difficulty_weighting: 80,
  "curriculum_facts.created_at": 120,
  "agents.name": 80,
  "agents.model": 100,
  "agents.temperature": 80,
  "agents.max_tokens": 80,
  "agents.is_active": 50,
};


interface DataTableProps {
  schema: TableSchema | null;
  rows: Record<string, any>[];
  fkLabels: Record<string, Record<string, string>>;
  children: ChildDef[];
  orderBy: string | null;
  orderDir: "ASC" | "DESC";
  onSort: (col: string) => void;
  onEdit: (pk: string) => void;
  onDelete: (pk: string) => void;
  onDrillDown: (row: Record<string, any>) => void;
  loading?: boolean;
}

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function DataTable({
  schema,
  rows,
  fkLabels,
  children,
  orderBy,
  orderDir,
  onSort,
  onEdit,
  onDelete,
  onDrillDown,
  loading,
}: DataTableProps) {
  if (loading) {
    return (
      <div className="table-wrap">
        <div className="empty">
          <div className="ico">
            <Icon name="hourglass" size={32} />
          </div>
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  if (!schema || !schema.columns) return <div className="table-wrap" />;

  const allCols = schema.columns as ExtColumnInfo[];
  const pk = schema.pk;
  const hasChildren = children.length > 0;
  // Virtual columns — server-side computed columns included in API response
  const VIRTUAL_COLS: Record<string, { label: string; extract: (row: Record<string, any>) => string }> = {
    fact_name: { label: "Fact", extract: (row) => row.fact_name || "" },
    tutor_name: { label: "Tutor", extract: (row) => row.tutor_name || "" },
    learning_system_name: { label: "Schema", extract: (row) => row.learning_system_name || "" },
  };

  const displayList = TABLE_DISPLAY_COLS[schema.table];
  const cols = displayList
    ? displayList.map((name) => VIRTUAL_COLS[name] ? { name, type: "text", nullable: false, default: null, is_pk: false } as ExtColumnInfo : allCols.find((c) => c.name === name)).filter(Boolean) as ExtColumnInfo[]
    : allCols;

  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty">
          <div className="ico">
            <Icon name="note" size={32} />
          </div>
          <div>No rows found</div>
        </div>
      </div>
    );
  }

  const handleRowClick = (e: React.MouseEvent, row: Record<string, any>) => {
    // Don't drill if clicking on buttons
    const target = e.target as HTMLElement;
    if (target.closest("[data-action]")) return;
    if (!hasChildren) return;
    onDrillDown(row);
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: hasChildren ? 110 : 80 }}>Actions</th>
            {cols.map((c) => (
              <th key={c.name} data-col={c.name} onClick={() => VIRTUAL_COLS[c.name] ? undefined : onSort(c.name)} style={COL_WIDTHS[schema.table + "." + c.name] || COL_WIDTHS[c.name] ? { width: COL_WIDTHS[schema.table + "." + c.name] || COL_WIDTHS[c.name] } : undefined}>
                {VIRTUAL_COLS[c.name]?.label || c.name}
                {orderBy === c.name && (
                  <span className="arrow">
                    {orderDir === "ASC" ? " \u25B2" : " \u25BC"}
                  </span>
                )}
              </th>
            ))}
            {hasChildren && <th style={{ width: 30 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const pkVal = String(row[pk] ?? "");
            return (
              <tr
                key={pkVal || ri}
                className={hasChildren ? "clickable" : undefined}
                data-pk={pkVal}
                onClick={(e) => handleRowClick(e, row)}
              >
                {/* Actions cell */}
                <td className="acts">
                  <button
                    className="btn btn-sm btn-secondary"
                    data-action="edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(pkVal);
                    }}
                  >
                    <Icon name="edit" /> Edit
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    data-action="del"
                    style={{ marginLeft: 3 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(pkVal);
                    }}
                  >
                    <Icon name="trash" /> Del
                  </button>
                </td>
                {/* Data cells */}
                {cols.map((c) => {
                  // Virtual column
                  if (VIRTUAL_COLS[c.name]) {
                    const display = VIRTUAL_COLS[c.name].extract(row);
                    return <td key={c.name} title={display}>{display.length > 80 ? display.substring(0, 80) + "..." : display}</td>;
                  }
                  const val = row[c.name];

                  // FK column - show label + short UUID
                  if (fkLabels[c.name] && val != null) {
                    const label = fkLabels[c.name][String(val)];
                    const shortId = String(val).substring(0, 8);
                    if (label) {
                      const displayLabel =
                        label.length > 35 ? label.substring(0, 35) + "..." : label;
                      return (
                        <td
                          key={c.name}
                          title={label + "\n" + String(val)}
                        >
                          <span style={{ color: "#93c5fd" }}>{esc(displayLabel)}</span>{" "}
                          <span className="pk">{esc(shortId)}</span>
                        </td>
                      );
                    }
                    return (
                      <td key={c.name}>
                        <span className="pk" title={String(val)}>
                          {shortId}...
                        </span>
                      </td>
                    );
                  }

                  // JSON columns
                  if (c.type === "jsonb" || c.type === "json") {
                    const preview = val != null ? JSON.stringify(val) : "null";
                    return (
                      <td
                        key={c.name}
                        className="js"
                        title={val != null ? JSON.stringify(val, null, 2) : "null"}
                      >
                        {preview.length > 50 ? preview.substring(0, 50) + "..." : preview}
                      </td>
                    );
                  }

                  // Boolean
                  if (c.type === "bool") {
                    return (
                      <td key={c.name} className="bl">
                        {val === true ? "\u2713" : val === false ? "" : ""}
                      </td>
                    );
                  }

                  // Primary key
                  if (c.name === pk) {
                    const sv = String(val ?? "");
                    return (
                      <td key={c.name}>
                        <span className="pk" title={sv}>
                          {sv.substring(0, 12)}
                          {sv.length > 12 ? "..." : ""}
                        </span>
                      </td>
                    );
                  }

                  // Default
                  const display = val != null ? String(val) : "";
                  return (
                    <td key={c.name} title={display}>
                      {display.length > 60 ? display.substring(0, 60) + "..." : display}
                    </td>
                  );
                })}
                {/* Drill arrow */}
                {hasChildren && (
                  <td>
                    <span className="drill-arrow">&#9656;</span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
