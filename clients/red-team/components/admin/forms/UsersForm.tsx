"use client";

import type { RowFormProps, ExtColumnInfo } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { FieldGroup, TextInput, ReadOnlyField } from "./fields";

export function UsersForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  return (
    <FormShell title={tableLabel} editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose}>
      {editingPk && (
        <FieldGroup label="id" hint="uuid, read-only">
          <ReadOnlyField value={formData["id"] || ""} />
        </FieldGroup>
      )}

      <FieldGroup label="display_name" hint="text">
        <TextInput value={formData["display_name"] || ""} onChange={(v) => setField("display_name", v)} />
      </FieldGroup>

      <FieldGroup label="email" hint="text">
        <TextInput value={formData["email"] || ""} onChange={(v) => setField("email", v)} />
      </FieldGroup>

      <FieldGroup label="role" hint="text">
        <TextInput value={formData["role"] || ""} onChange={(v) => setField("role", v)} />
      </FieldGroup>

      {editingPk ? (
        <FieldGroup label="created_at" hint="timestamptz, read-only">
          <ReadOnlyField value={formData["created_at"] || ""} />
        </FieldGroup>
      ) : (
        <FieldGroup label="created_at" hint="timestamptz" note="Auto-set if empty">
          <ReadOnlyField value="" />
        </FieldGroup>
      )}
    </FormShell>
  );
}
