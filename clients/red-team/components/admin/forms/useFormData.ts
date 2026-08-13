import { useState, useCallback } from "react";
import type { ExtColumnInfo } from "./types";

// Initialize form state from row values, with type-aware string conversion
function initFormData(
  cols: ExtColumnInfo[],
  values: Record<string, any> | null,
  editingPk: string | null,
  filterCol: string | null,
  filterVal: string | null
): Record<string, string> {
  const initial: Record<string, string> = {};
  cols.forEach((c) => {
    let val = values ? values[c.name] : null;
    // Pre-fill FK from parent filter on create
    if (!editingPk && filterCol === c.name && filterVal) val = filterVal;
    if (c.type === "jsonb" || c.type === "json") {
      initial[c.name] = val != null ? JSON.stringify(val, null, 2) : "";
    } else if (c.type === "bool") {
      initial[c.name] = val === true ? "true" : val === false ? "false" : "";
    } else if ((c.type === "timestamptz" || c.type === "timestamp") && val) {
      initial[c.name] = String(val).replace("T", " ").substring(0, 19);
    } else {
      initial[c.name] = val != null ? String(val) : "";
    }
  });
  return initial;
}

// Build submit payload with proper type coercion
function buildPayload(cols: ExtColumnInfo[], formData: Record<string, string>, isCreate: boolean): Record<string, any> {
  const data: Record<string, any> = {};
  cols.forEach((c) => {
    const val = formData[c.name];
    // On create, skip PK and auto-default columns when empty
    if (isCreate && (val === "" || val === undefined) && (c.is_pk || c.has_default)) return;
    if (val === "" || val === undefined) { data[c.name] = null; return; }
    if (c.type === "jsonb" || c.type === "json") {
      try { data[c.name] = JSON.parse(val); } catch { data[c.name] = val; }
      return;
    }
    if (c.type === "bool") {
      data[c.name] = val === "true" ? true : val === "false" ? false : null;
      return;
    }
    if (["int4", "int8", "int2", "numeric", "float4", "float8"].includes(c.type)) {
      const n = parseFloat(val);
      data[c.name] = isNaN(n) ? null : n;
      return;
    }
    data[c.name] = val;
  });
  return data;
}

export function useFormData(
  cols: ExtColumnInfo[],
  values: Record<string, any> | null,
  editingPk: string | null,
  filterCol: string | null,
  filterVal: string | null
) {
  const [formData, setFormData] = useState<Record<string, string>>(() =>
    initFormData(cols, values, editingPk, filterCol, filterVal)
  );

  const setField = useCallback((col: string, val: string) => {
    setFormData((prev) => ({ ...prev, [col]: val }));
  }, []);

  const isCreate = !editingPk;
  const buildSubmitData = useCallback(() => buildPayload(cols, formData, isCreate), [cols, formData, isCreate]);

  return { formData, setField, buildSubmitData };
}
