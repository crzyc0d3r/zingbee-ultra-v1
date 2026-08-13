import { Icon } from "@/components/ui/Icon";
import type { CoverageSummary, DistillationImageVariant, ExplanationStats } from "@/lib/distillations/types";
import type { PipelineLimits } from "@/hooks/use-distillation-data";

type PipelinePanelProps = {
  stats: ExplanationStats;
  coverageSummary: CoverageSummary;
  images: DistillationImageVariant[];
  uniqueFactCount: number;
  loading: boolean;
  showOptions: boolean;
  limits: PipelineLimits;
  onRunCommand: (command: string) => void;
  onToggleOptions: () => void;
  onLimitChange: (update: Partial<PipelineLimits>) => void;
};

export function PipelinePanel({
  stats, coverageSummary, images, uniqueFactCount, loading,
  showOptions, limits, onRunCommand, onToggleOptions, onLimitChange,
}: PipelinePanelProps) {
  return (
    <section className="dist-pipeline-panel">
      <div className="dist-pipeline-header">
        <h2>Pipeline</h2>
        <div className="dist-pipeline-actions">
          <button
            className="dist-pipeline-full-loop"
            disabled={loading}
            onClick={() => onRunCommand("full_loop")}
            title="Run all 4 stages sequentially"
          >
            <Icon name="lightning" /> Full Loop
          </button>
          <button
            className={`dist-pipeline-toggle ${showOptions ? "active" : ""}`}
            onClick={onToggleOptions}
          >
            <Icon name="wrench" />{showOptions ? " Hide Limits" : " Limits"}
          </button>
        </div>
      </div>

      <div className="dist-pipeline-stages">
        {/* Stage 1: Generate Distillations */}
        <div className={`dist-stage${stats.total > 0 ? " dist-stage-done" : ""}`}>
          <div className="dist-stage-num">1</div>
          <div className="dist-stage-body">
            <div className="dist-stage-top">
              <strong>Generate Distillations</strong>
              <button
                disabled={loading}
                onClick={() => onRunCommand("generate_explanations")}
                title={`Generate explanation variants (max ${limits.genMaxFacts} facts)`}
              >
                <Icon name="plus" /> Run
              </button>
            </div>
            <div className="dist-stage-meta">
              {stats.total > 0
                ? `${stats.total} variants across ${uniqueFactCount} facts (${stats.draft} draft, ${stats.approved} approved, ${stats.review} review)`
                : `5 strategies per fact`}
              {showOptions ? "" : ` \u00b7 max ${limits.genMaxFacts} facts`}
            </div>
            {showOptions && (
              <div className="dist-stage-options">
                <label>
                  Max facts{" "}
                  <input
                    type="number" min={1} max={500}
                    value={limits.genMaxFacts}
                    onChange={(e) => onLimitChange({ genMaxFacts: Math.max(1, parseInt(e.target.value) || 1) })}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="dist-stage-arrow">&darr;</div>

        {/* Stage 2: Evaluate Distillations */}
        <div className={`dist-stage${stats.draft === 0 && stats.total > 0 ? " dist-stage-done" : stats.draft === 0 ? " dist-stage-blocked" : ""}`}>
          <div className="dist-stage-num">2</div>
          <div className="dist-stage-body">
            <div className="dist-stage-top">
              <strong>Evaluate Distillations</strong>
              <button
                disabled={loading || stats.draft === 0}
                onClick={() => onRunCommand("evaluate_explanations")}
                title={stats.draft === 0 ? "No draft explanations to evaluate" : `Evaluate up to ${limits.evalMaxEvaluations} drafts`}
              >
                <Icon name="check" /> Run
              </button>
            </div>
            <div className="dist-stage-meta">
              {stats.draft > 0
                ? `${stats.draft} drafts to evaluate`
                : stats.total > 0
                  ? `${stats.approved} approved, ${stats.review} in review`
                  : "Needs distillations first"}
              {showOptions ? "" : ` \u00b7 max ${limits.evalMaxEvaluations}`}
            </div>
            {showOptions && (
              <div className="dist-stage-options">
                <label>
                  Max evaluations{" "}
                  <input
                    type="number" min={1} max={1000}
                    value={limits.evalMaxEvaluations}
                    onChange={(e) => onLimitChange({ evalMaxEvaluations: Math.max(1, parseInt(e.target.value) || 1) })}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="dist-stage-arrow">&darr;</div>

        {/* Stage 3: Generate Images */}
        <div className={`dist-stage${coverageSummary.factsWithApprovedExplanation === 0 ? " dist-stage-blocked" : ""}`}>
          <div className="dist-stage-num">3</div>
          <div className="dist-stage-body">
            <div className="dist-stage-top">
              <strong>Generate Images</strong>
              <button
                disabled={loading || coverageSummary.factsWithApprovedExplanation === 0}
                onClick={() => onRunCommand("generate_images")}
                title={coverageSummary.factsWithApprovedExplanation === 0 ? "No approved distillations \u2014 run stages 1 & 2 first" : "Generate images for approved distillations"}
              >
                <Icon name="plus" /> Run
              </button>
            </div>
            <div className="dist-stage-meta">
              {coverageSummary.factsWithApprovedExplanation > 0
                ? `${coverageSummary.factsWithApprovedExplanation} approved distillations`
                : "Needs approved distillations"}
              {showOptions ? "" : ` \u00b7 ${limits.imgVariantsPerExplanation} per explanation, max ${limits.imgMaxExplanations}`}
            </div>
            {showOptions && (
              <div className="dist-stage-options">
                <label>
                  Max explanations{" "}
                  <input
                    type="number" min={1} max={200}
                    value={limits.imgMaxExplanations}
                    onChange={(e) => onLimitChange({ imgMaxExplanations: Math.max(1, parseInt(e.target.value) || 1) })}
                  />
                </label>
                <label>
                  Variants each{" "}
                  <input
                    type="number" min={1} max={10}
                    value={limits.imgVariantsPerExplanation}
                    onChange={(e) => onLimitChange({ imgVariantsPerExplanation: Math.max(1, parseInt(e.target.value) || 1) })}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="dist-stage-arrow">&darr;</div>

        {/* Stage 4: Evaluate Images */}
        <div className={`dist-stage${images.length === 0 ? " dist-stage-blocked" : ""}`}>
          <div className="dist-stage-num">4</div>
          <div className="dist-stage-body">
            <div className="dist-stage-top">
              <strong>Evaluate Images</strong>
              <button
                disabled={loading || images.length === 0}
                onClick={() => onRunCommand("evaluate_images")}
                title={images.length === 0 ? "No images to evaluate" : "Evaluate images vs distillation + fact"}
              >
                <Icon name="check" /> Run
              </button>
            </div>
            <div className="dist-stage-meta">
              {images.length > 0
                ? `${images.length} images (${images.filter((i) => !i.decision).length} unevaluated) \u00b7 10 judges`
                : "Needs images first"}
              {showOptions ? "" : ` \u00b7 max ${limits.imgEvalMaxEvaluations}`}
            </div>
            {showOptions && (
              <div className="dist-stage-options">
                <label>
                  Max evaluations{" "}
                  <input
                    type="number" min={1} max={1000}
                    value={limits.imgEvalMaxEvaluations}
                    onChange={(e) => onLimitChange({ imgEvalMaxEvaluations: Math.max(1, parseInt(e.target.value) || 1) })}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
