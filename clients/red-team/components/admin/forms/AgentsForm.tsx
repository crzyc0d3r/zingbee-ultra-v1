"use client";

import { useState, useMemo, useCallback } from "react";
import type { RowFormProps, ExtColumnInfo } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { ExpandEditor } from "./ExpandEditor";
import { FieldGroup, TextInput, ReadOnlyField, NumberInput, BoolSelect } from "./fields";

/** Parse prompts JSON string into individual key-value pairs */
function parsePrompts(json: string): Record<string, string> {
  if (!json || !json.trim()) return {};
  try {
    const obj = JSON.parse(json);
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    }
    return result;
  } catch {
    return {};
  }
}

/** Pretty label from snake_case key */
function promptLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


export function AgentsForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  // Break prompts JSON into individual editable fields
  const initialPrompts = useMemo(() => parsePrompts(formData["prompts"] || ""), []);
  const [promptFields, setPromptFields] = useState<Record<string, string>>(initialPrompts);
  const promptKeys = useMemo(() => Object.keys(promptFields), [promptFields]);

  // Which prompt is open in the editor overlay
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const setPromptField = useCallback((key: string, val: string) => {
    setPromptFields((prev) => {
      const next = { ...prev, [key]: val };
      setField("prompts", JSON.stringify(next));
      return next;
    });
  }, [setField]);

  const pkCol = cols.find(c => c.is_pk);

  return (
    <>
      <FormShell title="Agent" editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose} suppressEscape={!!editingKey} modalClassName="modal-agent">
        {/* Compact metadata row */}
        <div className="agent-meta-strip">
          {editingPk && pkCol && (
            <FieldGroup label={pkCol.name} hint="read-only">
              <ReadOnlyField value={formData[pkCol.name] || ""} />
            </FieldGroup>
          )}
          <FieldGroup label="name" hint="text">
            <TextInput value={formData["name"] || ""} onChange={(v) => setField("name", v)} />
          </FieldGroup>
          <FieldGroup label="model" hint="text">
            <TextInput value={formData["model"] || ""} onChange={(v) => setField("model", v)} />
          </FieldGroup>
          <FieldGroup label="temp" hint="0-1" className="narrow">
            <NumberInput value={formData["temperature"] || ""} onChange={(v) => setField("temperature", v)} />
          </FieldGroup>
          <FieldGroup label="max_tokens" hint="int" className="narrow">
            <NumberInput value={formData["max_tokens"] || ""} onChange={(v) => setField("max_tokens", v)} />
          </FieldGroup>
          <FieldGroup label="active" hint="bool" className="narrow">
            <BoolSelect value={formData["is_active"] || "true"} onChange={(v) => setField("is_active", v)} />
          </FieldGroup>
        </div>

        <FieldGroup label="description" hint="text" full>
          <TextInput value={formData["description"] || ""} onChange={(v) => setField("description", v)} />
        </FieldGroup>

        {/* Prompts grid */}
        {promptKeys.length > 0 && (
          <div className="prompt-grid-container">
            <div className="prompt-grid-header">
              <span>Prompt</span>
              <span>Chars</span>
              <span></span>
            </div>
            <div className="prompt-grid-body">
              {promptKeys.map((key) => (
                <div
                  key={key}
                  className="prompt-grid-row"
                  onDoubleClick={() => setEditingKey(key)}
                >
                  <span className="prompt-grid-name">{promptLabel(key)}</span>
                  <span className="prompt-grid-chars">{promptFields[key]?.length || 0}</span>
                  <button
                    type="button"
                    className="prompt-grid-edit"
                    onClick={() => setEditingKey(key)}
                    title="Edit prompt"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </FormShell>

      {editingKey && (
        <ExpandEditor
          open={true}
          title={promptLabel(editingKey)}
          isJson={false}
          value={promptFields[editingKey] || ""}
          onChange={(v) => setPromptField(editingKey, v)}
          onClose={() => setEditingKey(null)}
        />
      )}
    </>
  );
}
