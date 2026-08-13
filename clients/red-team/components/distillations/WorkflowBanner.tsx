import type { CoverageSummary, DistillationImageVariant, ExplanationStats, PairSummary, ReviewTab } from "@/lib/distillations/types";

type WorkflowBannerProps = {
  stats: ExplanationStats;
  coverageSummary: CoverageSummary;
  images: DistillationImageVariant[];
  pairSummary: PairSummary;
  loading: boolean;
  onRunCommand: (command: string) => void;
  onSwitchTab: (tab: ReviewTab) => void;
};

type BannerState = {
  message: string;
  action?: { label: string; onClick: () => void };
  color: string;
};

function detectState(props: WorkflowBannerProps): BannerState | null {
  const { stats, coverageSummary, images, pairSummary } = props;

  // All coverage ready
  if (coverageSummary.totalFacts > 0 && coverageSummary.readyFacts === coverageSummary.totalFacts) {
    return {
      message: `Pipeline complete — full coverage for this capsule (${coverageSummary.totalFacts} facts)`,
      color: "#22c55e",
    };
  }

  // No explanations at all
  if (stats.total === 0) {
    return {
      message: "Start by generating explanations (Stage 1)",
      action: { label: "Generate", onClick: () => props.onRunCommand("generate_explanations") },
      color: "#3b82f6",
    };
  }

  // All draft, none evaluated
  if (stats.draft > 0 && stats.approved === 0 && stats.review === 0) {
    return {
      message: `${stats.draft} draft explanations ready to evaluate (Stage 2)`,
      action: { label: "Evaluate", onClick: () => props.onRunCommand("evaluate_explanations") },
      color: "#8b5cf6",
    };
  }

  // Some drafts remain
  if (stats.draft > 0) {
    return {
      message: `${stats.draft} drafts still need evaluation — ${stats.approved} approved so far`,
      action: { label: "Evaluate Remaining", onClick: () => props.onRunCommand("evaluate_explanations") },
      color: "#8b5cf6",
    };
  }

  // Has approved, no images
  if (coverageSummary.factsWithApprovedExplanation > 0 && images.length === 0) {
    return {
      message: `${coverageSummary.factsWithApprovedExplanation} approved explanations ready for image generation (Stage 3)`,
      action: { label: "Generate Images", onClick: () => props.onRunCommand("generate_images") },
      color: "#f59e0b",
    };
  }

  // Images exist but unevaluated
  const unevaluatedImages = images.filter((i) => !i.decision).length;
  if (unevaluatedImages > 0) {
    return {
      message: `${unevaluatedImages} images ready to evaluate (Stage 4)`,
      action: { label: "Evaluate Images", onClick: () => props.onRunCommand("evaluate_images") },
      color: "#06b6d4",
    };
  }

  // Pairs need attention
  const reviewPairs = pairSummary.review + pairSummary.regenerate;
  if (reviewPairs > 0) {
    return {
      message: `${reviewPairs} pairs need attention`,
      action: { label: "View Pairs", onClick: () => props.onSwitchTab("pairs") },
      color: "#f59e0b",
    };
  }

  // Everything evaluated but coverage not 100%
  if (coverageSummary.readyFacts < coverageSummary.totalFacts && coverageSummary.totalFacts > 0) {
    const remaining = coverageSummary.totalFacts - coverageSummary.readyFacts;
    return {
      message: `${remaining} facts still need approved explanation + shipped image`,
      color: "#94a3b8",
    };
  }

  return null;
}

export function WorkflowBanner(props: WorkflowBannerProps) {
  if (props.loading) return null;

  const state = detectState(props);
  if (!state) return null;

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", borderRadius: 8, marginBottom: 8,
        border: `1px solid ${state.color}33`,
        background: `${state.color}0d`,
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: state.color, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13 }}>{state.message}</span>
      {state.action && (
        <button
          onClick={state.action.onClick}
          style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            border: `1px solid ${state.color}`,
            background: `${state.color}1a`,
            color: state.color,
            cursor: "pointer",
          }}
        >
          {state.action.label}
        </button>
      )}
    </div>
  );
}
