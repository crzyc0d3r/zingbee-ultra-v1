"use client";

import type { RowFormProps, ExtColumnInfo } from "./types";
import { getFkOptions } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { FieldGroup, FkSelect, NumberInput, TextInput, ReadOnlyField } from "./fields";

export function SubjectCurriculumForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const fkOpts = getFkOptions(schema);
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  return (
    <FormShell title={tableLabel} editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose}>
      {editingPk && (
        <FieldGroup label="id" hint="uuid, read-only">
          <ReadOnlyField value={formData["id"] || ""} />
        </FieldGroup>
      )}

      <FieldGroup label="subject_id" hint="FK to subjects">
        {fkOpts["subject_id"]?.length ? (
          <FkSelect value={formData["subject_id"] || ""} options={fkOpts["subject_id"]} nullable={cols.find(c => c.name === "subject_id")?.nullable} onChange={(v) => setField("subject_id", v)} disabled={!!editingPk && filterCol === "subject_id"} />
        ) : (
          <TextInput value={formData["subject_id"] || ""} onChange={(v) => setField("subject_id", v)} />
        )}
      </FieldGroup>

      <FieldGroup label="phase" hint="int4">
        <NumberInput value={formData["phase"] || ""} onChange={(v) => setField("phase", v)} />
      </FieldGroup>

      <FieldGroup label="age_range" hint="text">
        <TextInput value={formData["age_range"] || ""} onChange={(v) => setField("age_range", v)} />
      </FieldGroup>

      {editingPk && (
        <FieldGroup label="created_date" hint="timestamptz, read-only">
          <ReadOnlyField value={formData["created_date"] || ""} />
        </FieldGroup>
      )}
    </FormShell>
  );
}
