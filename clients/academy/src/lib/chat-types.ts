export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  showFeedback?: boolean;
  latencyMs?: number | null;
  firstByteMs?: number | null;
  textDoneMs?: number | null;
  imageDoneMs?: number | null;
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
