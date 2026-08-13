"use client";

import type { RowFormProps, ExtColumnInfo } from "./types";
import { getFkOptions } from "./types";
import { useFormData } from "./useFormData";
import { FormShell } from "./FormShell";
import { FieldGroup, FkSelect, NumberInput, TextInput, ReadOnlyField } from "./fields";

export function CurriculumCapsulesForm(props: RowFormProps) {
  const { schema, values, editingPk, filterCol, filterVal, tableLabel, onSave, onClose, saving } = props;
  const cols = schema.columns as ExtColumnInfo[];
  const fkOpts = getFkOptions(schema);
  const { formData, setField, buildSubmitData } = useFormData(cols, values, editingPk, filterCol, filterVal);

  // meta_data is a JSONB column added in db/008. useFormData JSON-stringifies
  // jsonb columns into the form state, so parse before reading. Pull the
  // lifted metaphor + review status so admins editing capsule rows can see
  // authoring state at a glance and click through to the review queue.
  let metaphor = "";
  let reviewStatus = "unset";
  try {
    const raw = formData["meta_data"];
    if (raw) {
      const parsed = JSON.parse(raw) as { metaphor?: string; metaphor_review?: { status?: string } };
      if (typeof parsed?.metaphor === "string") metaphor = parsed.metaphor;
      const rs = parsed?.metaphor_review;
      if (rs?.status) reviewStatus = rs.status;
      else if (metaphor) reviewStatus = "auto_accepted";
    }
  } catch {
    // fall back to defaults if meta_data is malformed
  }

  return (
    <FormShell title="Curriculum Capsule" editingPk={editingPk} saving={saving} onSave={() => onSave(buildSubmitData())} onClose={onClose}>
      {editingPk && (
        <FieldGroup label="id" hint="uuid, read-only">
          <ReadOnlyField value={formData["id"] || ""} />
        </FieldGroup>
      )}

      <FieldGroup label="curriculum_theme_id" hint="FK to curriculum_themes">
        {fkOpts["curriculum_theme_id"]?.length ? (
          <FkSelect value={formData["curriculum_theme_id"] || ""} options={fkOpts["curriculum_theme_id"]} nullable={cols.find(c => c.name === "curriculum_theme_id")?.nullable} onChange={(v) => setField("curriculum_theme_id", v)} disabled={!!editingPk && filterCol === "curriculum_theme_id"} />
        ) : (
          <TextInput value={formData["curriculum_theme_id"] || ""} onChange={(v) => setField("curriculum_theme_id", v)} />
        )}
      </FieldGroup>

      <FieldGroup label="name" hint="text" full>
        <TextInput value={formData["name"] || ""} onChange={(v) => setField("name", v)} />
      </FieldGroup>

      <FieldGroup label="capsule_order" hint="int4">
        <NumberInput value={formData["capsule_order"] || ""} onChange={(v) => setField("capsule_order", v)} />
      </FieldGroup>

      {editingPk && (
        <FieldGroup label="metaphor" hint="meta_data.metaphor — authored via Metaphor Review" full>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <ReadOnlyField value={metaphor || "(no proposals yet)"} />
            <span className="sr-only">Review status:</span>
            <span
              role="status"
              aria-label={`Review status: ${reviewStatus.replace(/_/g, " ")}`}
              style={{
                fontSize: 12, padding: "3px 10px", borderRadius: 999,
                // Darker text on the red badge to clear WCAG AA at 12px (4.5:1).
                background: reviewStatus === "auto_accepted" || reviewStatus === "human_approved" ? "#10b981"
                  : reviewStatus === "needs_review" ? "#f59e0b"
                  : reviewStatus === "auto_rejected" ? "#ef4444"
                  : "#94a3b8",
                color: reviewStatus === "auto_rejected" ? "#1a0707" : "#0f172a",
                fontWeight: 700,
              }}
            >
              {reviewStatus.replace(/_/g, " ")}
            </span>
            <a
              // status=all so the linked capsule is visible regardless of its
              // review state (the review page defaults to needs_review which
              // hides auto_accepted capsules — pass-2 first-time-UX).
              href={`/metaphor-review?capsule=${formData["id"]}&status=all`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open this capsule in Metaphor Review (opens in new tab)"
              style={{ fontSize: 12, color: "#93c5fd" }}
            >
              Open in Metaphor Review →
            </a>
          </div>
        </FieldGroup>
      )}

      {editingPk && (
        <FieldGroup label="created_date" hint="timestamptz, read-only">
          <ReadOnlyField value={formData["created_date"] || ""} />
        </FieldGroup>
      )}
    </FormShell>
  );
}
