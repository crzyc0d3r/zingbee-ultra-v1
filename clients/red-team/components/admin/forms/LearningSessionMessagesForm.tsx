"use client";

import { useState } from "react";
import type { RowFormProps, ExtColumnInfo } from "./types";
import { getFkOptions } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { ExpandEditor } from "./ExpandEditor";
import { FieldGroup, FkSelect, TextInput, ReadOnlyField, LongTextarea, TimestampInput } from "./fields";

export function LearningSessionMessagesForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const fkOpts = getFkOptions(schema);
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  const [expandOpen, setExpandOpen] = useState(false);

  const pkCol = cols.find(c => c.is_pk);
  const tsTypes = ["timestamptz", "timestamp"];

  return (
    <>
      <FormShell title={tableLabel} editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose} suppressEscape={expandOpen}>
        {editingPk && pkCol && (
          <FieldGroup label={pkCol.name} hint="read-only">
            <ReadOnlyField value={formData[pkCol.name] || ""} />
          </FieldGroup>
        )}

        {/* FK to session */}
        {cols.filter(c => fkOpts[c.name]?.length).map((c) => (
          <FieldGroup key={c.name} label={c.name} hint="FK">
            <FkSelect value={formData[c.name] || ""} options={fkOpts[c.name]} nullable={c.nullable} onChange={(v) => setField(c.name, v)} disabled={!!editingPk && filterCol === c.name} />
          </FieldGroup>
        ))}

        {/* Role */}
        <FieldGroup label="role" hint="text">
          <TextInput value={formData["role"] || ""} onChange={(v) => setField("role", v)} />
        </FieldGroup>

        {/* Content - full width textarea */}
        <FieldGroup label="content" hint="text" full expandable onExpand={() => setExpandOpen(true)} charCount={(formData["content"] || "").length}>
          <LongTextarea value={formData["content"] || ""} onChange={(v) => setField("content", v)} minHeight={200} />
        </FieldGroup>

        {/* Timestamps */}
        {cols.filter(c => tsTypes.includes(c.type)).map((c) => (
          <FieldGroup key={c.name} label={c.name} hint="timestamptz" note={!editingPk && c.has_default ? "Auto-set if empty" : undefined}>
            {editingPk ? (
              <ReadOnlyField value={formData[c.name] || ""} />
            ) : (
              <TimestampInput value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} />
            )}
          </FieldGroup>
        ))}
      </FormShell>

      <ExpandEditor
        open={expandOpen}
        title="content"
        isJson={false}
        value={formData["content"] || ""}
        onChange={(v) => setField("content", v)}
        onClose={() => setExpandOpen(false)}
      />
    </>
  );
}
