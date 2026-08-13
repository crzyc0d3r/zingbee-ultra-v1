import { Icon } from "@/components/ui/Icon";
import type { PairData } from "@/lib/distillations/types";

type PairCardProps = {
  pair: PairData;
  actionBusy: string;
  onAction: (type: string, factId: string, variantId: string, action: string) => void;
  onDirectAction: (type: string, factId: string, variantId: string, action: string) => void;
};

export function PairCard({ pair, actionBusy, onAction, onDirectAction }: PairCardProps) {
  const pairDecision = pair.pairEvaluation.decision || "pending";
  const isBusy = actionBusy === `${pair.factId}:${pair.image.variantId}`;

  return (
    <article className="images-card">
      <div className="images-card-head">
        <strong>
          Fact {pair.factOrder}: {pair.factText?.slice(0, 80)}
          {(pair.factText?.length || 0) > 80 ? "..." : ""}
        </strong>
        <span className={`badge ${pairDecision}`}>{pairDecision}</span>
        {pair.pairEvaluation.composite != null && (
          <span>Pair: {(pair.pairEvaluation.composite * 100).toFixed(0)}%</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
        {/* Explanation side */}
        <div className="images-card" style={{ margin: 0 }}>
          <div className="images-card-head">
            <strong>Explanation ({pair.explanation.strategy})</strong>
            <span className={`badge ${pair.explanation.decision || "draft"}`}>
              {pair.explanation.decision || "draft"}
            </span>
            {pair.explanation.compositeScore != null && (
              <span>{(pair.explanation.compositeScore * 100).toFixed(0)}%</span>
            )}
          </div>
          <div className="images-fact" style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 200, overflow: "auto" }}>
            {pair.explanation.text}
          </div>
          {pair.explanation.suggestions.length > 0 && (
            <div className="images-meta" style={{ fontSize: 11 }}>
              <span>Suggestions: {pair.explanation.suggestions.join(" | ")}</span>
            </div>
          )}
          {pair.explanation.scores && Object.keys(pair.explanation.scores).length > 0 && (
            <div className="images-judges">
              {Object.entries(pair.explanation.scores).map(([name, data]) => (
                <div key={name} className="images-judge">
                  <span className="images-judge-name">{name}</span>
                  <span className="images-judge-score">
                    {data.score != null ? `${(data.score * 100).toFixed(0)}%` : "-"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Image side */}
        <div className="images-card" style={{ margin: 0 }}>
          <div className="images-card-head">
            <strong>Image ({pair.image.model})</strong>
            <span className={`badge ${pair.image.decision || "pending"}`}>
              {pair.image.decision || "pending"}
            </span>
            {pair.image.composite != null && (
              <span>{(pair.image.composite * 100).toFixed(0)}%</span>
            )}
          </div>
          {pair.image.imageUrl && (
            <div style={{ margin: "8px 0" }}>
              <img
                src={pair.image.imageUrl}
                alt={pair.factText || "Generated image"}
                style={{ maxWidth: "100%", maxHeight: 250, borderRadius: 8, cursor: "pointer" }}
                onClick={() => window.open(pair.image.imageUrl, "_blank")}
                title="Click to view full size"
              />
            </div>
          )}
          {pair.image.judges && Object.keys(pair.image.judges).length > 0 && (
            <div className="images-judges">
              {Object.entries(pair.image.judges).map(([name, data]) => (
                <div key={name} className="images-judge">
                  <span className="images-judge-name">{name}</span>
                  <span className="images-judge-score">
                    {data.score != null ? `${(data.score * 100).toFixed(0)}%` : "-"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pair evaluation scores */}
      {pair.pairEvaluation.judges && Object.keys(pair.pairEvaluation.judges).length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(100,200,255,0.08)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#94a3b8" }}>
            Pair Coherence Scores
          </div>
          <div className="images-judges">
            {Object.entries(pair.pairEvaluation.judges).map(([name, data]) => (
              <div key={name} className="images-judge">
                <span className="images-judge-name">{name.replace(/_/g, " ")}</span>
                <span className="images-judge-score">
                  {data.score != null ? `${(data.score * 100).toFixed(0)}%` : "-"}
                </span>
                {data.flags && data.flags.length > 0 && (
                  <span className="images-judge-flags">{data.flags.join(", ")}</span>
                )}
              </div>
            ))}
          </div>
          {pair.pairEvaluation.reasons.length > 0 && (
            <div className="images-meta" style={{ fontSize: 11, marginTop: 4 }}>
              <span>Reasons: {pair.pairEvaluation.reasons.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      <div className="images-actions" style={{ marginTop: 8 }}>
        <button
          className="images-btn-approve"
          disabled={isBusy}
          onClick={() => onDirectAction("pair", pair.factId, pair.image.variantId, "approve")}
          aria-label="Approve pair"
        >
          Approve Pair
        </button>
        <button
          className="images-btn-danger"
          disabled={isBusy}
          onClick={() => onAction("pair", pair.factId, pair.image.variantId, "reject")}
          aria-label="Reject pair"
        >
          Reject Pair
        </button>
        <button
          disabled={isBusy}
          onClick={() => onAction("image", pair.factId, pair.image.variantId, "regenerate")}
          aria-label="Regenerate image"
        >
          <Icon name="refresh" /> Regen Image
        </button>
      </div>
    </article>
  );
}
