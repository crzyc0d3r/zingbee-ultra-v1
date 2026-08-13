import type { CoverageFact, CoverageFilter, CoverageSummary } from "@/lib/distillations/types";

type CoverageGridProps = {
  filteredCoverage: CoverageFact[];
  coverageSummary: CoverageSummary;
  coverageFilter: CoverageFilter;
  onFilterChange: (filter: CoverageFilter) => void;
  onFactClick: (factId: string) => void;
};

export function CoverageGrid({
  filteredCoverage, coverageSummary, coverageFilter,
  onFilterChange, onFactClick,
}: CoverageGridProps) {
  return (
    <section className="images-panel" role="tabpanel" aria-label="Coverage">
      <h2>Fact Coverage</h2>
      <div className="images-meta" style={{ gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <span><strong>{coverageSummary.totalFacts}</strong> facts</span>
        <span>
          <strong>{coverageSummary.factsWithApprovedExplanation}</strong> with approved explanation
          ({coverageSummary.totalFacts ? Math.round(coverageSummary.factsWithApprovedExplanation / coverageSummary.totalFacts * 100) : 0}%)
        </span>
        <span>
          <strong>{coverageSummary.factsWithShippedImage}</strong> with shipped image
          ({coverageSummary.totalFacts ? Math.round(coverageSummary.factsWithShippedImage / coverageSummary.totalFacts * 100) : 0}%)
        </span>
        <span><strong>{coverageSummary.readyFacts}</strong> fully ready ({coverageSummary.coveragePercent}%)</span>
      </div>
      <div className="images-nav" role="tablist" aria-label="Coverage filters" style={{ marginBottom: 12 }}>
        {(["all", "not_started", "in_progress", "ready"] as const).map((f) => {
          const counts: Record<string, number> = {
            all: coverageSummary.totalFacts,
            not_started: coverageSummary.notStarted,
            in_progress: coverageSummary.inProgress,
            ready: coverageSummary.readyFacts,
          };
          const labels: Record<string, string> = {
            all: "All",
            not_started: "Not Started",
            in_progress: "In Progress",
            ready: "Ready",
          };
          return (
            <button
              key={f}
              role="tab"
              aria-selected={coverageFilter === f}
              className={`images-nav-tab${coverageFilter === f ? " active" : ""}`}
              onClick={() => onFilterChange(f)}
            >
              {labels[f]} ({counts[f]})
            </button>
          );
        })}
      </div>
      <div className="images-cards">
        {filteredCoverage.map((fact) => (
          <div
            key={fact.factId}
            className={`images-card${fact.ready ? "" : " images-card-warn"}`}
            style={{ cursor: "pointer" }}
            onClick={() => onFactClick(fact.factId)}
            title="Click to view explanations"
          >
            <div className="images-card-head">
              <strong>
                {fact.factOrder != null ? `#${fact.factOrder}: ` : ""}
                {fact.factText?.slice(0, 100)}{(fact.factText?.length || 0) > 100 ? "..." : ""}
              </strong>
              <span className={`badge ${fact.ready ? "SHIP" : "REVIEW"}`}>
                {fact.ready ? "Ready" : "Incomplete"}
              </span>
            </div>
            <div className="images-meta">
              <span>Explanations: {fact.explanations.approved} approved / {fact.explanations.total} total</span>
              <span>Images: {fact.images.ship} shipped / {fact.images.total} total</span>
              {fact.pairs.total > 0 && (
                <span>Pairs: {fact.pairs.ship} shipped / {fact.pairs.total} total</span>
              )}
            </div>
          </div>
        ))}
        {!filteredCoverage.length && (
          <div className="images-empty">
            {coverageFilter === "all"
              ? "No coverage data. Generate explanations and images first."
              : `No facts matching "${coverageFilter.replace("_", " ")}" filter.`}
          </div>
        )}
      </div>
    </section>
  );
}
