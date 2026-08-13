"use client";

import { useState, useCallback } from "react";
import type { RowFormProps, ExtColumnInfo } from "./types";
import { getFkOptions } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { FieldGroup, FkSelect, NumberInput, TextInput, ReadOnlyField } from "./fields";
import { FactEditor } from "../FactEditor";

export function CurriculumFactsForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const fkOpts = getFkOptions(schema);
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  // Extract fact text and difficulty_weight from meta_data JSON
  // DB column is "meta_data" (jsonb); the text key is "core_fact" (legacy) or "text" (new)
  let factText = "";
  let difficultyWeight = "";
  try {
    const parsed = JSON.parse(formData["meta_data"] || "{}");
    factText = parsed.text || parsed.core_fact || "";
    difficultyWeight = parsed.difficulty_weight != null ? String(parsed.difficulty_weight) : "";
  } catch {}

  const updateFactText = (newText: string) => {
    try {
      const obj = JSON.parse(formData["meta_data"] || "{}");
      if ("text" in obj) obj.text = newText;
      else obj.core_fact = newText;
      setField("meta_data", JSON.stringify(obj, null, 2));
    } catch {
      setField("meta_data", JSON.stringify({ core_fact: newText }, null, 2));
    }
  };

  const updateDifficulty = (val: string) => {
    try {
      const obj = JSON.parse(formData["meta_data"] || "{}");
      obj.difficulty_weight = val ? parseFloat(val) : null;
      setField("meta_data", JSON.stringify(obj, null, 2));
    } catch {}
  };

  return (
    <FormShell title="Curriculum Fact" editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose} modalClassName="modal-fact">
      {/* Compact metadata strip */}
      <div className="fact-meta-strip">
        {editingPk && (
          <FieldGroup label="id" hint="uuid">
            <ReadOnlyField value={formData["id"] || ""} />
          </FieldGroup>
        )}
        <FieldGroup label="capsule" hint="FK">
          {fkOpts["curriculum_capsule_id"]?.length ? (
            <FkSelect value={formData["curriculum_capsule_id"] || ""} options={fkOpts["curriculum_capsule_id"]} nullable={cols.find(c => c.name === "curriculum_capsule_id")?.nullable} onChange={(v) => setField("curriculum_capsule_id", v)} disabled={!!editingPk && filterCol === "curriculum_capsule_id"} />
          ) : (
            <TextInput value={formData["curriculum_capsule_id"] || ""} onChange={(v) => setField("curriculum_capsule_id", v)} />
          )}
        </FieldGroup>
        <FieldGroup label="order" hint="int4">
          <NumberInput value={formData["order"] || ""} onChange={(v) => setField("order", v)} />
        </FieldGroup>
        <FieldGroup label="difficulty" hint="weight">
          <NumberInput value={difficultyWeight} onChange={updateDifficulty} />
        </FieldGroup>
      </div>

      {/* Fact text - prominent field */}
      <FieldGroup label="fact text" hint="the core fact statement" full>
        <textarea
          className="fact-text-input"
          value={factText}
          onChange={(e) => updateFactText(e.target.value)}
          placeholder="Enter the fact text..."
          rows={2}
        />
      </FieldGroup>

      {/* Fact enrichment editor with tabs */}
      <FieldGroup label="enrichment data" hint="jsonb" full>
        <FactEditor
          value={formData["meta_data"] || ""}
          onChange={useCallback((v: string) => { queueMicrotask(() => setField("meta_data", v)); }, [setField])}
        />
      </FieldGroup>
    </FormShell>
  );
}
