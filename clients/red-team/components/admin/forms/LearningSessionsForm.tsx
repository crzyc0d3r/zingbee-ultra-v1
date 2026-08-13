"use client";

import { useState } from "react";
import type { RowFormProps, ExtColumnInfo } from "./types";
import { getFkOptions, validateJson } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { ExpandEditor } from "./ExpandEditor";
import { FieldGroup, FkSelect, NumberInput, TextInput, BoolSelect, ReadOnlyField, TimestampInput, JsonTextarea } from "./fields";

export function LearningSessionsForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const fkOpts = getFkOptions(schema);
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
  const fkCols = cols.filter(c => fkOpts[c.name]?.length);
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

        {/* FK selects (user, student, capsule) */}
        {fkCols.map((c) => (
          <FieldGroup key={c.name} label={c.name} hint="FK">
            <FkSelect value={formData[c.name] || ""} options={fkOpts[c.name]} nullable={c.nullable} onChange={(v) => setField(c.name, v)} disabled={!!editingPk && filterCol === c.name} />
          </FieldGroup>
        ))}

        {/* Status field */}
        {cols.filter(c => c.name === "status").map((c) => (
          <FieldGroup key={c.name} label="status" hint="text">
            <TextInput value={formData["status"] || ""} onChange={(v) => setField("status", v)} />
          </FieldGroup>
        ))}

        {/* Numeric fields */}
        {cols.filter(c => !c.is_pk && !fkOpts[c.name]?.length && numericTypes.includes(c.type)).map((c) => (
          <FieldGroup key={c.name} label={c.name} hint={c.type}>
            <NumberInput value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} />
          </FieldGroup>
        ))}

        {/* Bool fields */}
        {cols.filter(c => c.type === "bool").map((c) => (
          <FieldGroup key={c.name} label={c.name} hint="bool">
            <BoolSelect value={formData[c.name] || ""} nullable={c.nullable} onChange={(v) => setField(c.name, v)} />
          </FieldGroup>
        ))}

        {/* Remaining text fields (not FK, not status, not timestamps) */}
        {cols.filter(c => !c.is_pk && !fkOpts[c.name]?.length && !numericTypes.includes(c.type) && c.type !== "bool" && !tsTypes.includes(c.type) && c.type !== "jsonb" && c.type !== "json" && c.name !== "status").map((c) => (
          <FieldGroup key={c.name} label={c.name} hint={c.type}>
            <TextInput value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} />
          </FieldGroup>
        ))}

        {/* JSON fields */}
        {jsonCols.map((c) => (
          <FieldGroup key={c.name} label={c.name} hint="jsonb" full expandable onExpand={() => { setExpandCol(c.name); setExpandOpen(true); }} charCount={(formData[c.name] || "").length} jsonError={jsonErrors[c.name]}>
            <JsonTextarea value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} onBlur={() => validateField(c.name, formData[c.name] || "")} hasError={!!jsonErrors[c.name]} />
          </FieldGroup>
        ))}

        {/* Timestamps - read-only on edit */}
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
