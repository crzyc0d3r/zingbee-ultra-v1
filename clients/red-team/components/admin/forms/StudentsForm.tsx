"use client";

import { useState } from "react";
import type { RowFormProps, ExtColumnInfo } from "./types";
import { getFkOptions } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { FieldGroup, FkSelect, TextInput, ReadOnlyField } from "./fields";
import { ReportCard } from "@/components/shared/ReportCard";
import "@/styles/report-card.css";

export function StudentsForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const fkOpts = getFkOptions(schema);
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);
  const [showReport, setShowReport] = useState(!!editingPk);

  // Identify FK columns dynamically
  const fkCols = cols.filter((c) => fkOpts[c.name]?.length);
  const regularCols = cols.filter((c) => !fkOpts[c.name]?.length && c.name !== "id" && c.name !== "student_id" && c.name !== "created_date" && c.name !== "report_card");

  // Detect subject from form data
  const subjectName = formData["subject_name"] || "Biology";
  const studentId = formData["student_id"] || editingPk || "";

  return (
    <FormShell title={tableLabel} editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose}>
      {editingPk && (
        <FieldGroup label="student_id" hint="uuid, read-only">
          <ReadOnlyField value={formData["student_id"] || ""} />
        </FieldGroup>
      )}

      {/* FK to user */}
      {fkCols.map((c) => (
        <FieldGroup key={c.name} label={c.name} hint="FK">
          <FkSelect
            value={formData[c.name] || ""}
            options={fkOpts[c.name]}
            nullable={c.nullable}
            onChange={(v) => setField(c.name, v)}
            disabled={!!editingPk && filterCol === c.name}
          />
        </FieldGroup>
      ))}

      {/* Name */}
      <FieldGroup label="name" hint="text" full>
        <TextInput value={formData["name"] || ""} onChange={(v) => setField("name", v)} />
      </FieldGroup>

      {/* Remaining regular columns (exclude report_card JSONB) */}
      {regularCols.filter(c => c.name !== "name").map((c) => (
        <FieldGroup key={c.name} label={c.name} hint={c.type}>
          <TextInput value={formData[c.name] || ""} onChange={(v) => setField(c.name, v)} />
        </FieldGroup>
      ))}

      {editingPk ? (
        <FieldGroup label="created_date" hint="timestamptz, read-only">
          <ReadOnlyField value={formData["created_date"] || ""} />
        </FieldGroup>
      ) : cols.find(c => c.name === "created_date") ? (
        <FieldGroup label="created_date" hint="timestamptz" note="Auto-set if empty">
          <ReadOnlyField value="" />
        </FieldGroup>
      ) : null}

      {/* Report Card section (only when editing an existing student) */}
      {editingPk && studentId && (
        <div style={{ gridColumn: "1 / -1", marginTop: 12, borderTop: "1px solid #334155", paddingTop: 12 }}>
          <div
            onClick={() => setShowReport(!showReport)}
            style={{
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: showReport ? 10 : 0,
            }}
          >
            <span style={{ fontSize: 10 }}>{showReport ? "\u25BC" : "\u25B6"}</span>
            Report Card
          </div>
          {showReport && (
            <ReportCard studentId={studentId} subject={subjectName} adminMode />
          )}
        </div>
      )}
    </FormShell>
  );
}
