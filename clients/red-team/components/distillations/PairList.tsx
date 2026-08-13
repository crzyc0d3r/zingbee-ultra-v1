import type { PairData, PairFilter, PairSummary } from "@/lib/distillations/types";
import { PairCard } from "./PairCard";

type PairListProps = {
  filteredPairs: PairData[];
  pairSummary: PairSummary;
  pairFilter: PairFilter;
  actionBusy: string;
  onAction: (type: string, factId: string, variantId: string, action: string) => void;
  onDirectAction: (type: string, factId: string, variantId: string, action: string) => void;
  onFilterChange: (filter: PairFilter) => void;
};

export function PairList({
  filteredPairs, pairSummary, pairFilter,
  actionBusy, onAction, onDirectAction, onFilterChange,
}: PairListProps) {
  return (
    <section className="images-panel" role="tabpanel" aria-label="Pairs">
      <h2>Explanation + Image Pairs</h2>
      <div className="images-card-head" style={{ marginBottom: 8 }}>
        <div className="images-meta">
          <span>Total: {pairSummary.total}</span>
          <span>SHIP: {pairSummary.ship}</span>
          <span>REVIEW: {pairSummary.review}</span>
          <span>REGENERATE: {pairSummary.regenerate}</span>
          <span>Unevaluated: {pairSummary.unevaluated}</span>
        </div>
        <select
          value={pairFilter}
          onChange={(e) => onFilterChange(e.target.value as PairFilter)}
          aria-label="Filter pairs by decision"
        >
          <option value="all">All pairs</option>
          <option value="SHIP">SHIP only</option>
          <option value="REVIEW">REVIEW only</option>
          <option value="REGENERATE">REGENERATE only</option>
          <option value="unevaluated">Unevaluated</option>
        </select>
      </div>
      <div className="images-cards">
        {filteredPairs.map((pair) => (
          <PairCard
            key={`${pair.factId}-${pair.explanation.variantId}-${pair.image.variantId}`}
            pair={pair}
            actionBusy={actionBusy}
            onAction={onAction}
            onDirectAction={onDirectAction}
          />
        ))}
        {!filteredPairs.length && (
          <div className="images-empty">
            {pairFilter !== "all"
              ? `No pairs matching "${pairFilter}" filter.`
              : "No pairs found. Run the full loop or generate explanations + images first, then evaluate pairs."}
          </div>
        )}
      </div>
    </section>
  );
}
