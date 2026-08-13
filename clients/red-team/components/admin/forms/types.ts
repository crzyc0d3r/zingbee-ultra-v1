import type { TableSchema, FkOption } from "@/lib/types";

// Extended column info from API
export interface ExtColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  has_default?: boolean;
  max_length?: number | null;
}

// Props shared by all per-table form components
export interface RowFormProps {
  schema: TableSchema;
  values: Record<string, any> | null;
  editingPk: string | null;
  filterCol: string | null;
  filterVal: string | null;
  tableLabel: string;
  onSave: (data: Record<string, any>) => void;
  onClose: () => void;
  saving?: boolean;
}

export function validateJson(value: string): { valid: boolean; error: string } {
  if (!value.trim()) return { valid: true, error: "" };
  try {
    JSON.parse(value);
    return { valid: true, error: "" };
  } catch (e: any) {
    return { valid: false, error: e.message || "Invalid JSON" };
  }
}

export function getFkOptions(schema: TableSchema): Record<string, FkOption[]> {
  return schema.fk_options || {};
}
