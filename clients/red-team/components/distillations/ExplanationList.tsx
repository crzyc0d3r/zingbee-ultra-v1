import type { ExplanationStats, ExplanationVariant, SortMode, StatusFilter } from "@/lib/distillations/types";
import { ExplanationCard } from "./ExplanationCard";

type ExplanationListProps = {
  groupedExplanations: [string, ExplanationVariant[]][];
  stats: ExplanationStats;
  statusFilter: StatusFilter;
  sortMode: SortMode;
  actionBusy: string;
  onAction: (type: string, factId: string, variantId: string, action: string) => void;
  onDirectAction: (type: string, factId: string, variantId: string, action: string) => void;
  onBulkAction: (action: "approve" | "reject", minScore?: number, itemType?: string) => void;
  onFilterChange: (filter: StatusFilter) => void;
  onSortChange: (sort: SortMode) => void;
};

export function ExplanationList({
  groupedExplanations, stats, statusFilter, sortMode,
  actionBusy, onAction, onDirectAction, onBulkAction,
  onFilterChange, onSortChange,
}: ExplanationListProps) {
  return (
    <section className="images-panel" role="tabpanel" aria-label="Explanations">
      <div className="images-card-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Explanations by Fact</h2>
        <div className="images-meta" style={{ gap: 8 }}>
          <select
            value={statusFilter}
            onChange={(e) => onFilterChange(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="regenerating">Regenerating</option>
          </select>
          <select
            value={sortMode}
            onChange={(e) => onSortChange(e.target.value as SortMode)}
            aria-label="Sort by"
          >
            <option value="order">Fact order</option>
            <option value="score_asc">Score (low first)</option>
            <option value="score_desc">Score (high first)</option>
          </select>
          <button onClick={() => onBulkAction("approve", 0.85)} title="Approve all scoring 85%+">
            Approve all 85%+
          </button>
        </div>
      </div>
      <div className="images-cards">
        {groupedExplanations.map(([factId, factExps]) => (
          <div key={factId} data-fact-id={factId} className="images-card">
            <div className="images-card-head">
              <strong>
                Fact {factExps[0]?.factOrder}: {factExps[0]?.factText?.slice(0, 80)}
                {(factExps[0]?.factText?.length || 0) > 80 ? "..." : ""}
              </strong>
              <span>{factExps.length} variants</span>
            </div>
            {factExps.map((exp) => (
              <ExplanationCard
                key={exp.variantId}
                explanation={exp}
                actionBusy={actionBusy}
                onAction={onAction}
                onDirectAction={onDirectAction}
              />
            ))}
          </div>
        ))}
        {!groupedExplanations.length && (
          <div className="images-empty">
            No explanations matching filter.{" "}
            {statusFilter !== "all" ? "Try changing the status filter." : "Generate some first."}
          </div>
        )}
      </div>
    </section>
  );
}
