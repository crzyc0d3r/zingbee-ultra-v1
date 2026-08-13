"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { FactEditor } from "./FactEditor";
import type { TableSchema, FkOption } from "@/lib/types";

// Per-table read-only columns (beyond the PK which is always read-only on edit)
const TABLE_READONLY_COLS: Record<string, string[]> = {
  subjects: ["id", "created_at"],
};

// Per-table columns forced to single-line input (overrides textarea detection)
const TABLE_FORCE_SHORT: Record<string, string[]> = {
  subjects: ["name"],
};

// Per-table columns forced to full-width row
const TABLE_FORCE_FULL: Record<string, string[]> = {
  subjects: ["name"],
};

// Extended column info from API
interface ExtColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  has_default?: boolean;
  max_length?: number | null;
}

interface RowFormProps {
  schema: TableSchema;
  values: Record<string, any> | null;
  editingPk: string | null;
  filterCol: string | null;
  filterVal: string | null;
  tableLabel: string;
  onSave: (data: Record<string, any>) => void;
  onClose: () => void;
  saving?: boolean;
}

const SHORT_TYPES = [
  "uuid",
  "bool",
  "int4",
  "int8",
  "int2",
  "numeric",
  "float4",
  "float8",
  "timestamptz",
  "timestamp",
];

function isShortField(
  c: ExtColumnInfo,
  fkOpts: Record<string, FkOption[]>
): boolean {
  if (SHORT_TYPES.includes(c.type)) return true;
  if (fkOpts[c.name] && fkOpts[c.name].length > 0) return true;
  if (
    (c.type === "text" ||
      c.type === "varchar" ||
      c.type === "name" ||
      c.type === "bpchar") &&
    c.max_length &&
    c.max_length <= 200
  )
    return true;
  return false;
}

function isLongField(
  c: ExtColumnInfo,
  fkOpts: Record<string, FkOption[]>
): boolean {
  if (c.type === "jsonb" || c.type === "json") return true;
  if (
    (c.type === "text" || c.type === "varchar") &&
    (!c.max_length || c.max_length > 200)
  ) {
    if (fkOpts[c.name] && fkOpts[c.name].length > 0) return false;
    return true;
  }
  return false;
}

function fieldSortOrder(
  c: ExtColumnInfo,
  pk: string,
  fkOpts: Record<string, FkOption[]>
): number {
  if (c.name === pk) return 0;
  if (fkOpts[c.name] && fkOpts[c.name].length > 0) return 1;
  if (isShortField(c, fkOpts)) return 2;
  return 3;
}

function validateJson(value: string): { valid: boolean; error: string } {
  if (!value.trim()) return { valid: true, error: "" };
  try {
    JSON.parse(value);
    return { valid: true, error: "" };
  } catch (e: any) {
    return { valid: false, error: e.message || "Invalid JSON" };
  }
}

// -- Expand Editor Overlay --
interface ExpandEditorProps {
  open: boolean;
  title: string;
  isJson: boolean;
  value: string;
  onChange: (val: string) => void;
  onClose: () => void;
}

function ExpandEditor({
  open,
  title,
  isJson,
  value,
  onChange,
  onClose,
}: ExpandEditorProps) {
  const [localVal, setLocalVal] = useState(value);
  const [jsonError, setJsonError] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setLocalVal(value);
      setJsonError("");
      setTimeout(() => taRef.current?.focus(), 50);
    }
  }, [open, value]);

  const handleDone = () => {
    onChange(localVal);
    onClose();
  };

  const handleFormat = () => {
    try {
      const obj = JSON.parse(localVal);
      const formatted = JSON.stringify(obj, null, 2);
      setLocalVal(formatted);
      setJsonError("");
    } catch (e: any) {
      setJsonError("Invalid JSON: " + (e.message || ""));
    }
  };

  const handleBlur = () => {
    if (isJson && localVal.trim()) {
      const res = validateJson(localVal);
      setJsonError(res.valid ? "" : "Invalid JSON: " + res.error);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDone();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, localVal]);

  return (
    <div className={`editor-overlay${open ? " active" : ""}`}>
      <div className="editor-overlay-hd">
        <h3>{title}</h3>
        <button className="modal-x" onClick={handleDone}>
          &times;
        </button>
      </div>
      <div className="editor-overlay-bd">
        <textarea
          ref={taRef}
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={handleBlur}
          spellCheck={false}
          style={{
            fontFamily: isJson
              ? "'SF Mono',Consolas,monospace"
              : "inherit",
          }}
          className={jsonError ? "json-invalid" : undefined}
        />
      </div>
      <div className="editor-overlay-ft">
        <span className="json-error">{jsonError}</span>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          {localVal.length} chars
        </span>
        {isJson && (
          <button
            className="btn btn-secondary"
            onClick={handleFormat}
          >
            <Icon name="edit" /> Format JSON
          </button>
        )}
        <button className="btn btn-primary" onClick={handleDone}>
          <Icon name="save" /> Done
        </button>
      </div>
    </div>
  );
}

// -- Main Form --
export function RowForm({
  schema,
  values,
  editingPk,
  filterCol,
  filterVal,
  tableLabel,
  onSave,
  onClose,
  saving,
}: RowFormProps) {
  const cols = schema.columns as ExtColumnInfo[];
  const pk = schema.pk;
  const fkOpts = (schema.fk_options || {}) as Record<string, FkOption[]>;

  // Form data state keyed by column name
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    cols.forEach((c) => {
      let val = values ? values[c.name] : null;
      // Pre-fill FK from parent filter on create
      if (!editingPk && filterCol === c.name && filterVal) {
        val = filterVal;
      }
      if (c.type === "jsonb" || c.type === "json") {
        initial[c.name] = val != null ? JSON.stringify(val, null, 2) : "";
      } else if (c.type === "bool") {
        initial[c.name] =
          val === true ? "true" : val === false ? "false" : "";
      } else if (
        (c.type === "timestamptz" || c.type === "timestamp") &&
        val
      ) {
        initial[c.name] = String(val).replace("T", " ").substring(0, 19);
      } else {
        initial[c.name] = val != null ? String(val) : "";
      }
    });
    return initial;
  });

  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  // Expand editor state
  const [expandOpen, setExpandOpen] = useState(false);
  const [expandCol, setExpandCol] = useState("");
  const [expandIsJson, setExpandIsJson] = useState(false);

  // Close on Escape (skip when expand editor is open — it has its own handler)
  useEffect(() => {
    if (expandOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, expandOpen]);

  // Sort columns: PK first, FK selects, short fields, long fields
  const sorted = [...cols].sort(
    (a, b) => fieldSortOrder(a, pk, fkOpts) - fieldSortOrder(b, pk, fkOpts)
  );

  const setField = useCallback((col: string, val: string) => {
    setFormData((prev) => ({ ...prev, [col]: val }));
  }, []);

  const validateJsonField = useCallback((col: string, val: string) => {
    if (!val.trim()) {
      setJsonErrors((prev) => {
        const next = { ...prev };
        delete next[col];
        return next;
      });
      return;
    }
    const res = validateJson(val);
    setJsonErrors((prev) =>
      res.valid ? (() => { const n = { ...prev }; delete n[col]; return n; })() : { ...prev, [col]: res.error }
    );
  }, []);

  const handleSubmit = () => {
    const data: Record<string, any> = {};
    cols.forEach((c) => {
      const val = formData[c.name];
      if (val === "" || val === undefined) {
        data[c.name] = null;
        return;
      }
      if (c.type === "jsonb" || c.type === "json") {
        try {
          data[c.name] = JSON.parse(val);
        } catch {
          data[c.name] = val;
        }
        return;
      }
      if (c.type === "bool") {
        data[c.name] =
          val === "true" ? true : val === "false" ? false : null;
        return;
      }
      if (
        ["int4", "int8", "int2", "numeric", "float4", "float8"].includes(
          c.type
        )
      ) {
        const n = parseFloat(val);
        data[c.name] = isNaN(n) ? null : n;
        return;
      }
      data[c.name] = val;
    });
    onSave(data);
  };

  const openExpand = (col: string, isJson: boolean) => {
    setExpandCol(col);
    setExpandIsJson(isJson);
    setExpandOpen(true);
  };

  const handleExpandChange = (val: string) => {
    setField(expandCol, val);
    if (expandIsJson) validateJsonField(expandCol, val);
  };

  return (
    <>
      <div className="overlay active">
        <div className="modal">
          <div className="modal-hd">
            <h3>{editingPk ? "Edit" : "Create"} {tableLabel}</h3>
            <button className="modal-x" onClick={onClose}>&times;</button>
          </div>
          <div className="modal-bd">
            <div className="form-grid">
              {/* Fact text as a regular field for curriculum_facts */}
              {schema.table === "curriculum_facts" && (() => {
                let factText = "";
                try {
                  const p = JSON.parse(formData["meta_data"] || "{}");
                  factText = p.text || p.core_fact || "";
                } catch {}
                return (
                  <div className="fg compact">
                    <label>fact text</label>
                    <input
                      type="text"
                      value={factText}
                      onChange={(e) => {
                        try {
                          const obj = JSON.parse(formData["meta_data"] || "{}");
                          if ("text" in obj) obj.text = e.target.value;
                          else obj.core_fact = e.target.value;
                          setField("meta_data", JSON.stringify(obj, null, 2));
                        } catch {}
                      }}
                      placeholder="Fact text..."
                    />
                  </div>
                );
              })()}
              {sorted.map((c) => {
                // Skip auto-generated PK on create
                if (!editingPk && c.name === pk && c.has_default) return null;
                const roList = TABLE_READONLY_COLS[schema.table];
                const isRO = !!(editingPk && c.name === pk) || !!(editingPk && roList && roList.includes(c.name));
                const forceShort = TABLE_FORCE_SHORT[schema.table]?.includes(c.name);
                const hint =
                  c.type +
                  (c.max_length ? "(" + c.max_length + ")" : "") +
                  (c.nullable ? ", nullable" : "");
                const isLong = forceShort ? false : isLongField(c, fkOpts);
                const forceFull = TABLE_FORCE_FULL[schema.table]?.includes(c.name);
                const isJson = c.type === "jsonb" || c.type === "json";
                const val = formData[c.name] ?? "";

                return (
                  <div key={c.name} className={`fg ${isLong || forceFull ? "full" : "compact"}`}>
                    <label>
                      {c.name}
                      <span className="hint">{hint}</span>
                      {isLong && !isRO && !(schema.table === "curriculum_facts" && c.name === "meta_data") && (
                        <button
                          className="expand-btn"
                          type="button"
                          title="Expand editor"
                          onClick={() => openExpand(c.name, isJson)}
                        >
                          <Icon name="expand" size={12} />
                        </button>
                      )}
                    </label>

                    {/* FK dropdown */}
                    {fkOpts[c.name] && fkOpts[c.name].length > 0 && !isRO ? (
                      <select
                        value={val}
                        onChange={(e) => setField(c.name, e.target.value)}
                      >
                        {c.nullable && <option value="">(null)</option>}
                        {fkOpts[c.name].map((opt) => (
                          <option key={String(opt.value)} value={String(opt.value)}>
                            {opt.label} ({String(opt.value).substring(0, 8)})
                          </option>
                        ))}
                      </select>
                    ) : isJson && schema.table === "curriculum_facts" && c.name === "meta_data" ? (
                      <FactEditor
                        value={val}
                        onChange={(v) => setField(c.name, v)}
                        readOnly={isRO}
                      />
                    ) : isJson ? (
                      <textarea
                        value={val}
                        onChange={(e) => setField(c.name, e.target.value)}
                        onBlur={() => validateJsonField(c.name, val)}
                        style={{ minHeight: 180 }}
                        spellCheck={false}
                        readOnly={isRO}
                        className={jsonErrors[c.name] ? "json-invalid" : undefined}
                      />
                    ) : c.type === "bool" ? (
                      <select
                        value={val}
                        onChange={(e) => setField(c.name, e.target.value)}
                        disabled={isRO}
                      >
                        {c.nullable && (
                          <option value="">(null)</option>
                        )}
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : !forceShort && c.type === "text" &&
                      (!c.max_length || c.max_length > 200) &&
                      !(fkOpts[c.name] && fkOpts[c.name].length > 0) ? (
                      <textarea
                        value={val}
                        onChange={(e) => setField(c.name, e.target.value)}
                        style={{ minHeight: 140 }}
                        readOnly={isRO}
                      />
                    ) : ["int4", "int8", "int2", "numeric", "float4", "float8"].includes(
                        c.type
                      ) ? (
                      <input
                        type="number"
                        step="any"
                        value={val}
                        onChange={(e) => setField(c.name, e.target.value)}
                        readOnly={isRO}
                      />
                    ) : c.type === "timestamptz" || c.type === "timestamp" ? (
                      <input
                        type="text"
                        placeholder="YYYY-MM-DD HH:MM:SS"
                        value={val}
                        onChange={(e) => setField(c.name, e.target.value)}
                        readOnly={isRO}
                      />
                    ) : (
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => setField(c.name, e.target.value)}
                        readOnly={isRO}
                      />
                    )}

                    {/* Auto-set note for timestamps */}
                    {(c.type === "timestamptz" || c.type === "timestamp") &&
                      c.has_default &&
                      !editingPk && (
                        <div className="note">Auto-set if empty</div>
                      )}

                    {/* Field info row for long fields */}
                    {isLong && !isRO && (
                      <div className="field-info">
                        {isJson && (
                          <span className="json-err-msg">
                            {jsonErrors[c.name] || ""}
                          </span>
                        )}
                        <span>{val.length} chars</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="modal-ft">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={saving}
            >
              <Icon name="save" /> {saving ? "Saving..." : editingPk ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>

      {/* Expand editor overlay */}
      <ExpandEditor
        open={expandOpen}
        title={expandCol}
        isJson={expandIsJson}
        value={formData[expandCol] ?? ""}
        onChange={handleExpandChange}
        onClose={() => setExpandOpen(false)}
      />
    </>
  );
}
