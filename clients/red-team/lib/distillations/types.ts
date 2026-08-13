// --- Core data types for distillation pipeline ---

export type ExplanationVariant = {
  factId: string;
  factOrder: number;
  factText: string;
  variantId: string;
  status: string;
  strategy: string;
  text: string;
  wordCount: number;
  suggestions: string[];
  imagePrompt: string | null;
  compositeScore: number | null;
  decision: string | null;
  scores: Record<string, { score: number; flags: string[]; reasoning: string }>;
  reasons: string[];
  humanReviewStatus: string | null;
  createdAt: string;
};

export type DistillationImageVariant = {
  factId: string;
  factOrder: number;
  factText: string;
  variantId: string;
  imageUrl: string;
  imagePrompt: string;
  composite: number | null;
  decision: string | null;
  scores: Record<string, { score: number; flags?: string[] }>;
  humanReviewStatus: string | null;
};

export type CoverageFact = {
  factId: string;
  factText: string;
  factOrder: number | null;
  explanations: { total: number; approved: number; review: number };
  images: { total: number; ship: number; review: number };
  pairs: { total: number; ship: number };
  ready: boolean;
};

export type PairData = {
  factId: string;
  factOrder: number;
  factText: string;
  explanation: {
    variantId: string;
    strategy: string;
    text: string;
    wordCount: number;
    suggestions: string[];
    imagePrompt: string;
    compositeScore: number | null;
    decision: string | null;
    scores: Record<string, { score: number; flags?: string[]; reasoning?: string }>;
  };
  image: {
    variantId: string;
    imageUrl: string;
    provider: string;
    model: string;
    promptStrategy: string;
    promptVersion: string;
    composite: number | null;
    decision: string | null;
    judges: Record<string, { score: number; flags?: string[] }>;
  };
  pairEvaluation: {
    composite: number | null;
    decision: string | null;
    reasons: string[];
    judges: Record<string, { score: number; flags?: string[]; reasoning?: string }>;
    evaluatedAt: string | null;
  };
};

export type DistillationJob = {
  id: string;
  status: string;
  command: string;
  scope: Record<string, unknown>;
  currentStage: string;
  itemsProcessed: number;
  totalCandidates: number;
  startedAt: string | null;
  completedAt: string | null;
};

export type CoverageSummary = {
  totalFacts: number;
  readyFacts: number;
  coveragePercent: number;
  factsWithApprovedExplanation: number;
  factsWithShippedImage: number;
  notStarted: number;
  inProgress: number;
};

export type PairSummary = {
  total: number;
  ship: number;
  review: number;
  regenerate: number;
  unevaluated: number;
};

export type ExplanationStats = {
  total: number;
  approved: number;
  review: number;
  draft: number;
  regenerating: number;
};

// --- UI state types ---

export type ReviewTab = "dashboard" | "explanations" | "images" | "coverage" | "pairs" | "optimize";
export type StatusFilter = "all" | "draft" | "review" | "approved" | "rejected" | "regenerating";
export type SortMode = "order" | "score_asc" | "score_desc";
export type CoverageFilter = "all" | "not_started" | "in_progress" | "ready";
export type PairFilter = "all" | "SHIP" | "REVIEW" | "REGENERATE" | "unevaluated";

// --- Analytics types (PR 2) ---

export type StrategyStats = {
  total: number;
  approved: number;
  rejected: number;
  avgScore: number;
  sampleSize: number;
};

export type SubjectHealth = {
  subject: string;
  totalFacts: number;
  distillations: { total: number; approved: number; review: number; draft: number; rejected: number };
  images: { total: number; ship: number; review: number; regenerate: number };
  pairs: { total: number; ship: number; review: number; regenerate: number };
  coveragePercent: number;
};

export type PipelineHealthSummary = {
  health: {
    totalFacts: number;
    factsWithDistillations: number;
    factsWithApprovedDistillation: number;
    factsWithImages: number;
    factsWithShippedImage: number;
    factsWithShippedPair: number;
    pipelineComplete: number;
    coveragePercent: number;
  };
  bySubject: SubjectHealth[];
  byPhase: (Omit<SubjectHealth, "pairs"> & { phase: number })[];
  byStrategy: Record<string, StrategyStats>;
  qualityDistribution: {
    explanations: Record<string, number>;
    images: Record<string, number>;
  };
  rejectionRates: {
    explanations: { total: number; rejected: number; rate: number };
    images: { total: number; regenerated: number; rate: number };
  };
  recentActivity: {
    jobsLast24h: number;
  };
};

// --- Scope type ---

export type DistillationScope = {
  subject: string;
  phase: number;
  theme: string;
  capsule: string;
};
