export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  showFeedback?: boolean;
  msgIndex?: number;
  latencyMs?: number | null;
  firstByteMs?: number | null;
  textDoneMs?: number | null;
  imageDoneMs?: number | null;
  timestamp?: string;
  imageUrl?: string;
  imageCaption?: string;
  imageLoading?: boolean;
}

export interface ExecStep {
  step: string;
  details?: Record<string, any> | string;
  agent?: string;
  timestamp?: string;
}

export interface StudentInfo {
  student_id: string;
  name: string;
}

export interface SessionListItem {
  id: string;
  student_id: string;
  student_name: string;
  capsule_name: string;
  subject_name: string;
  start_time: string | null;
  end_time?: string | null;
  duration_seconds: number | null;
  questions_asked: number;
  correct_answers: number;
  total_tokens: number;
  facts_taught_count?: number;
  accuracy: number | null;
  message_count: number;
}

export interface LearningSessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  created_at?: string;
}

export interface InteractionMessage {
  role: string;
  content: string;
}

export interface InteractionItem {
  fact_text: string;
  type: string;
  understood?: boolean | null;
  exposure?: number | null;
  is_meaningful?: boolean | null;
  step?: number | null;
  created_at?: string;
  timestamp?: string;
  messages?: InteractionMessage[];
}

export interface FeedbackItem {
  message_index: number;
  sentiment: string;
  comment?: string;
  created_at?: string;
  timestamp?: string;
  message_text?: string;
  context_messages?: { role: string; content: string }[];
}

export interface SessionDetail {
  session_db_id: string;
  id?: string;
  student_id: string;
  student_name?: string;
  subject_name: string;
  capsule: string;
  capsule_name?: string;
  tutor?: string;
  duration_seconds?: number;
  start_time?: string;
  end_time?: string;
  messages: LearningSessionMessage[];
  execution_log?: ExecStep[];
  system_log?: any[];
  interactions?: InteractionItem[];
  feedback?: FeedbackItem[];
  total_tokens?: number;
  questions_asked?: number;
  correct_answers?: number;
  facts_taught_count?: number;
  accuracy?: number | null;
}

export interface AdminHierarchy {
  root_groups: Array<{ tables: string[] }>;
  labels: Record<string, string>;
  label_col: Record<string, string>;
  children: Record<string, ChildDef[]>;
  pk_map: Record<string, string>;
}

export interface TableSchema {
  table: string;
  pk: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
    is_pk: boolean;
    has_default?: boolean;
    max_length?: number | null;
  }>;
  fk_options?: Record<string, FkOption[]>;
}

export interface TableInfo {
  name: string;
  row_count: number;
}

export interface ChildDef {
  table: string;
  fk: string;
}

export interface FkOption {
  value: string;
  label: string;
}
