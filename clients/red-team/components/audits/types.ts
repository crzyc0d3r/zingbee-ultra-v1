export interface AuditSummary {
  subjects_count: number;
  capsules_count: number;
  facts_count: number;
  phases_count: number;
  insights_count: number;
  concern_count: number;
  suggestion_count: number;
  strength_count: number;
  health_score: number;
  // Legacy fields for backward compat with old audits
  issues_count?: number;
  critical_count?: number;
  warning_count?: number;
  info_count?: number;
}

export interface FieldCompleteness {
  processes: string;
  applications: string;
  misconceptions: string;
  micro_checks: string;
  evidence: string;
  stretch: string;
  vocabulary: string;
}

export interface SubjectStats {
  phases: number;
  themes: number;
  capsules: number;
  total_facts: number;
  avg_facts: number;
  min_facts: number;
  max_facts: number;
  zero_fact_capsules: number;
  field_completeness: FieldCompleteness;
}

export interface FactDetail {
  text: string;
  processes: unknown[];
  applications: unknown[];
  misconceptions: unknown[];
  micro_checks: unknown[];
  vocabulary: unknown[];
}

export interface CapsuleDetail {
  order: number;
  name: string;
  facts: number;
  facts_text: string[];
  facts_data?: FactDetail[];
  n_processes: number;
  d_processes: unknown[];
  n_applications: number;
  d_applications: unknown[];
  n_misconceptions: number;
  d_misconceptions: unknown[];
  n_micro_checks: number;
  d_micro_checks: unknown[];
  n_evidence: number;
  d_evidence: unknown[];
  n_stretch: number;
  d_stretch: unknown[];
  n_vocabulary: number;
  d_vocabulary: unknown[];
  has_mastery: boolean;
}

export interface PhaseData {
  age_range: string | null;
  themes: Record<string, CapsuleDetail[]>;
}

export interface AuditInsight {
  subject: string;
  phase: string;
  theme: string;
  capsule: string;
  severity: "strength" | "suggestion" | "concern";
  title: string;
  detail: string;
}

export interface AuditData {
  version: number;
  generated_at: string;
  summary: AuditSummary;
  insights?: AuditInsight[];
  subject_stats: Record<string, SubjectStats>;
  phase_detail: Record<string, Record<string, PhaseData>>;
  // Legacy
  issues?: unknown[];
}

export interface AuditDetailResponse {
  id: string;
  title: string;
  description: string | null;
  audit_date: string | null;
  subjects_count: number | null;
  capsules_count: number | null;
  facts_count: number | null;
  issues_count: number | null;
  health_score: number | null;
  created_at: string | null;
  data: AuditData | null;
}
