"use client";

import type { RowFormProps, ExtColumnInfo } from "./types";
import { getFkOptions } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { FieldGroup, FkSelect, NumberInput, TextInput, ReadOnlyField } from "./fields";

export function CurriculumThemesForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const fkOpts = getFkOptions(schema);
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  return (
    <FormShell title="Curriculum Theme" editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose}>
      {editingPk && (
        <FieldGroup label="id" hint="uuid, read-only">
          <ReadOnlyField value={formData["id"] || ""} />
        </FieldGroup>
      )}

      {/* FK to curriculum */}
      <FieldGroup label="subject_curriculum_id" hint="FK to subject_curriculum">
        {fkOpts["subject_curriculum_id"]?.length ? (
          <FkSelect value={formData["subject_curriculum_id"] || ""} options={fkOpts["subject_curriculum_id"]} nullable={cols.find(c => c.name === "subject_curriculum_id")?.nullable} onChange={(v) => setField("subject_curriculum_id", v)} disabled={!!editingPk && filterCol === "subject_curriculum_id"} />
        ) : (
          <TextInput value={formData["subject_curriculum_id"] || ""} onChange={(v) => setField("subject_curriculum_id", v)} />
        )}
      </FieldGroup>

      {/* Name - full width */}
      <FieldGroup label="name" hint="text" full>
        <TextInput value={formData["name"] || ""} onChange={(v) => setField("name", v)} />
      </FieldGroup>

      {/* Theme order */}
      <FieldGroup label="theme_order" hint="int4">
        <NumberInput value={formData["theme_order"] || ""} onChange={(v) => setField("theme_order", v)} />
      </FieldGroup>

      {/* created_date */}
      {editingPk ? (
        <FieldGroup label="created_date" hint="timestamptz, read-only">
          <ReadOnlyField value={formData["created_date"] || ""} />
        </FieldGroup>
      ) : (
        <FieldGroup label="created_date" hint="timestamptz" note="Auto-set if empty">
          <ReadOnlyField value="" />
        </FieldGroup>
      )}
    </FormShell>
  );
}
