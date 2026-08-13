export type SubjectPhase = { phase: number; age_range: string };

export type SubjectPhasesResponse = {
  subjects: Record<string, { tutor: string; phases: SubjectPhase[] }>;
};

export type ImageEvalOptions = {
  availableImageModels: string[];
  availablePromptStrategies: string[];
  promptVersions: string[];
  models: string[];
  promptStrategies: string[];
};

export type ImageScope = {
  subject: string;
  phase: number;
  theme: string;
  capsule: string;
};

export type ImageJob = {
  id: string;
  status: string;
  command: string;
  scope: { subject?: string; phase?: number; theme?: string; capsule?: string };
  promptVersion: string;
  imageModels?: string[];
  promptStrategies?: string[];
  startedAt?: string | null;
  completedAt?: string | null;
  count?: number;
  durationSec?: number;
};

export type ImageJobDetail = ImageJob & {
  currentStage?: string;
  itemsProcessed?: number;
  totalCandidates?: number;
  errors?: string[];
  result?: Record<string, unknown>;
  logTail?: string;
};

export type JudgePayload = {
  score?: number;
  flags?: string[];
  reasoning?: string;
};

export type ImageVariant = {
  factId: string;
  factOrder: number;
  factText: string;
  variantId: string;
  imageUrl: string;
  provider?: string;
  model?: string;
  promptStrategy?: string;
  combinationId?: string;
  promptVersion: string;
  composite?: number;
  decision?: string;
  reasons?: string[];
  judges?: Record<string, JudgePayload>;
  humanReviewStatus?: string;
  humanReviewNote?: string;
  humanReviewUpdatedBy?: string;
  humanReviewUpdatedAt?: string;
  humanOverride?: Record<string, unknown>;
  evaluatedAt?: string;
};

export type HitlQueueResponse = {
  queue: ImageVariant[];
  count: number;
  queueFilter: string;
};

export type DashboardSummary = {
  total: number;
  ship: number;
  review: number;
  regenerate: number;
  pendingHuman: number;
  needsWorkHuman: number;
  approvedHuman: number;
  byCombo: Record<string, number>;
};
