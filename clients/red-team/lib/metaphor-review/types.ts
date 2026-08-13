// Types for the metaphor authoring review UI.
// Mirrors backend shapes from api/metaphor_eval_routes.py + api/metaphor_eval_service.py.

export type MetaphorReviewStatus =
  | "auto_accepted"
  | "human_approved"
  | "needs_review"
  | "auto_rejected"
  | "unset";

export interface MetaphorJudgeBreakdown {
  score: number;
  reasoning: string;
  flags: string[];
  provider: string;
  model: string;
}

export interface MetaphorCandidate {
  id: string;
  metaphor: string;
  rationale: string;
  sustained_examples_per_fact: Record<string, string>;
  judge_breakdown: Record<string, MetaphorJudgeBreakdown>;
  composite: number;
  variance: number;
  decision: "AUTO_ACCEPT" | "NEEDS_REVIEW" | "AUTO_REJECT";
  reasons: string[];
  proposer_provider: string;
  proposer_model: string;
  proposed_at: string;
  proposed_by: string;
  run_id: string;
}

export interface MetaphorProposalRun {
  run_id: string;
  proposed_at: string;
  proposed_by: string;
  eval_identity: {
    rubric_version: number;
    judge_names: string[];
    weights: Record<string, number>;
  };
  candidates: MetaphorCandidate[];
  winner_id: string | null;
}

export interface MetaphorReviewState {
  status: MetaphorReviewStatus;
  reviewer: string | null;
  reviewed_at: string | null;
  winner_run_id?: string;
  winner_id?: string | null;
  edited?: boolean;
  rejected?: boolean;
  note?: string;
}

export interface MetaphorCapsuleListEntry {
  capsuleId: string;
  capsuleName: string;
  subjectName: string;
  themeName: string;
  phase: number;
  ageRange: string;
  metaphor: string;
  reviewStatus: MetaphorReviewStatus;
  lastRunId: string;
  proposalRuns: number;
}

export interface MetaphorCapsuleDetail {
  capsuleId: string;
  capsuleName: string;
  subjectName: string;
  themeName: string;
  phase: number;
  ageRange: string;
  metaphor: string;
  metaphorSustainedExamples: Record<string, string>;
  metaphorReview: MetaphorReviewState;
  metaphorProposals: MetaphorProposalRun[];
  facts: { factId: string; factOrder: number; factText: string }[];
  evalIdentity: { rubric_version: number; judge_names: string[]; weights: Record<string, number> };
}

export interface MetaphorCoverage {
  total: number;
  counts: Record<MetaphorReviewStatus, number>;
  acceptedCount: number;
  coveragePct: number;
  judgeNames: string[];
}

export interface MetaphorJob {
  id: string;
  status: string;
  command: "evaluate" | "regenerate";
  scope: { capsule_id?: string; subject?: string; phase?: number };
  currentStage: string;
  itemsProcessed: number;
  totalCandidates: number;
  startedAt: string | null;
  completedAt: string | null;
  count: number;
  durationSec: number;
}
