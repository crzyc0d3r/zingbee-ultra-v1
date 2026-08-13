"use client";

import { useState } from "react";
import type { RowFormProps, ExtColumnInfo } from "./types";
import { validateJson } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { ExpandEditor } from "./ExpandEditor";
import { FieldGroup, TextInput, NumberInput, ReadOnlyField, JsonTextarea, TimestampInput } from "./fields";

export function EvalRunsForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  const [expandOpen, setExpandOpen] = useState(false);
  const [expandCol, setExpandCol] = useState("");
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  const validateField = (col: string, val: string) => {
    const res = validateJson(val);
    setJsonErrors((prev) => {
      if (res.valid) { const { [col]: _, ...rest } = prev; return rest; }
      return { ...prev, [col]: res.error };
    });
  };

  const pkCol = cols.find(c => c.is_pk);
  const jsonCols = cols.filter(c => (c.type === "jsonb" || c.type === "json") && !c.is_pk);
  const numericTypes = ["int4", "int8", "int2", "numeric", "float4", "float8"];
  const tsTypes = ["timestamptz", "timestamp"];

  return (
    <>
      <FormShell title={tableLabel} editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose} suppressEscape={expandOpen}>
        {editingPk && pkCol && (
          <FieldGroup label={pkCol.name} hint="read-only">
            <ReadOnlyField value={formData[pkCol.name] || ""} />
          </FieldGroup>
        )}

        {/* job_id */}
        {cols.find(c => c.name === "job_id") && (
          <FieldGroup label="job_id" hint="text">
            <TextInput value={formData["job_id"] || ""} onChange={(v) => setField("job_id", v)} />
          </FieldGroup>
        )}

        {/* Status */}
        {cols.find(c => c.name === "status") && (
          <FieldGroup label="status" hint="text">
            <TextInput value={formData["status"] || ""} onChange={(v) => setField("status", v)} />
          </FieldGroup>
        )}

        {/* Numeric fields */}
        {cols.filter(c => !c.is_pk && numericTypes.includes(c.type)).map((c) => (
          <FieldGroup key={c.name} label={c.name} hint={c.type}>
            <NumberInput value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} />
          </FieldGroup>
        ))}

        {/* Remaining text fields */}
        {cols.filter(c => !c.is_pk && !numericTypes.includes(c.type) && !tsTypes.includes(c.type) && c.type !== "bool" && c.type !== "jsonb" && c.type !== "json" && c.name !== "job_id" && c.name !== "status").map((c) => (
          <FieldGroup key={c.name} label={c.name} hint={c.type}>
            <TextInput value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} />
          </FieldGroup>
        ))}

        {/* Config JSON fields */}
        {jsonCols.map((c) => (
          <FieldGroup key={c.name} label={c.name} hint="jsonb" full expandable onExpand={() => { setExpandCol(c.name); setExpandOpen(true); }} charCount={(formData[c.name] || "").length} jsonError={jsonErrors[c.name]}>
            <JsonTextarea value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} onBlur={() => validateField(c.name, formData[c.name] || "")} hasError={!!jsonErrors[c.name]} />
          </FieldGroup>
        ))}

        {/* Timestamps - read-only */}
        {cols.filter(c => tsTypes.includes(c.type)).map((c) => (
          <FieldGroup key={c.name} label={c.name} hint="timestamptz, read-only">
            <ReadOnlyField value={formData[c.name] || ""} />
          </FieldGroup>
        ))}
      </FormShell>

      <ExpandEditor
        open={expandOpen}
        title={expandCol}
        isJson={true}
        value={formData[expandCol] || ""}
        onChange={(v) => { setField(expandCol, v); validateField(expandCol, v); }}
        onClose={() => setExpandOpen(false)}
      />
    </>
  );
}
