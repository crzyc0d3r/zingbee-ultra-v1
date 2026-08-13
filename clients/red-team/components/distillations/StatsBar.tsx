import type { CoverageSummary, ExplanationStats } from "@/lib/distillations/types";

type StatsBarProps = {
  stats: ExplanationStats;
  coverageSummary: CoverageSummary;
};

export function StatsBar({ stats, coverageSummary }: StatsBarProps) {
  return (
    <section className="images-panel" aria-label="Stats">
      <div className="images-meta">
        <span>
          Explanations: {stats.total} ({stats.approved} approved, {stats.review} review, {stats.draft} draft
          {stats.regenerating > 0 ? `, ${stats.regenerating} regenerating` : ""})
        </span>
        <span>
          Coverage: {coverageSummary.readyFacts}/{coverageSummary.totalFacts} facts ready ({coverageSummary.coveragePercent}%)
        </span>
      </div>
    </section>
  );
}
