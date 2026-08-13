"use client";

import { useState } from "react";
import type { RowFormProps } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { ExpandEditor } from "./ExpandEditor";
import { FieldGroup, TextInput, ReadOnlyField, LongTextarea } from "./fields";
import type { ExtColumnInfo } from "./types";

export function SubjectsForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  const [expandOpen, setExpandOpen] = useState(false);
  const [expandCol, setExpandCol] = useState("");

  return (
    <>
      <FormShell title={tableLabel} editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose} suppressEscape={expandOpen}>
        {/* ID + created_at side by side at top on edit */}
        {editingPk && (
          <>
            <FieldGroup label="id" hint="uuid, read-only">
              <ReadOnlyField value={formData["id"] || ""} />
            </FieldGroup>
            <FieldGroup label="created_at" hint="timestamptz, read-only">
              <ReadOnlyField value={formData["created_at"] || ""} />
            </FieldGroup>
          </>
        )}

        {/* Name - full width single line */}
        <FieldGroup label="name" hint="text" full>
          <TextInput value={formData["name"] || ""} onChange={(v) => setField("name", v)} />
        </FieldGroup>

        {/* Description - full width textarea */}
        <FieldGroup label="description" hint="text" full expandable onExpand={() => { setExpandCol("description"); setExpandOpen(true); }} charCount={(formData["description"] || "").length}>
          <LongTextarea value={formData["description"] || ""} onChange={(v) => setField("description", v)} minHeight={120} />
        </FieldGroup>
      </FormShell>

      <ExpandEditor
        open={expandOpen}
        title={expandCol}
        isJson={false}
        value={formData[expandCol] || ""}
        onChange={(v) => setField(expandCol, v)}
        onClose={() => setExpandOpen(false)}
      />
    </>
  );
}
