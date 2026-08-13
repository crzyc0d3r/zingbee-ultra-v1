"use client";

import { useState } from "react";
import type { RowFormProps, ExtColumnInfo } from "./types";
import { getFkOptions } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { ExpandEditor } from "./ExpandEditor";
import { FieldGroup, FkSelect, NumberInput, TextInput, ReadOnlyField, LongTextarea, TimestampInput } from "./fields";

export function LearningSessionFeedbackForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const fkOpts = getFkOptions(schema);
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  const [expandOpen, setExpandOpen] = useState(false);

  const pkCol = cols.find(c => c.is_pk);
  const fkCols = cols.filter(c => fkOpts[c.name]?.length);
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

        {/* FKs (session, user, student) */}
        {fkCols.map((c) => (
          <FieldGroup key={c.name} label={c.name} hint="FK">
            <FkSelect value={formData[c.name] || ""} options={fkOpts[c.name]} nullable={c.nullable} onChange={(v) => setField(c.name, v)} disabled={!!editingPk && filterCol === c.name} />
          </FieldGroup>
        ))}

        {/* Sentiment */}
        <FieldGroup label="sentiment" hint="text">
          <TextInput value={formData["sentiment"] || ""} onChange={(v) => setField("sentiment", v)} />
        </FieldGroup>

        {/* Comment - full width */}
        <FieldGroup label="comment" hint="text" full expandable onExpand={() => setExpandOpen(true)} charCount={(formData["comment"] || "").length}>
          <LongTextarea value={formData["comment"] || ""} onChange={(v) => setField("comment", v)} minHeight={120} />
        </FieldGroup>

        {/* Numeric fields (message_index, etc) */}
        {cols.filter(c => !c.is_pk && !fkOpts[c.name]?.length && numericTypes.includes(c.type)).map((c) => (
          <FieldGroup key={c.name} label={c.name} hint={c.type}>
            <NumberInput value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} />
          </FieldGroup>
        ))}

        {/* Remaining text fields */}
        {cols.filter(c => !c.is_pk && !fkOpts[c.name]?.length && !numericTypes.includes(c.type) && !tsTypes.includes(c.type) && c.type !== "bool" && c.name !== "sentiment" && c.name !== "comment" && c.type !== "jsonb" && c.type !== "json").map((c) => (
          <FieldGroup key={c.name} label={c.name} hint={c.type}>
            <TextInput value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} />
          </FieldGroup>
        ))}

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
        title="comment"
        isJson={false}
        value={formData["comment"] || ""}
        onChange={(v) => setField("comment", v)}
        onClose={() => setExpandOpen(false)}
      />
    </>
  );
}
