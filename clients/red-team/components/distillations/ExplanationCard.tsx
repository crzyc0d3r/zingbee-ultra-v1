import { Icon } from "@/components/ui/Icon";
import type { ExplanationVariant } from "@/lib/distillations/types";

type ExplanationCardProps = {
  explanation: ExplanationVariant;
  actionBusy: string;
  onAction: (type: string, factId: string, variantId: string, action: string) => void;
  onDirectAction: (type: string, factId: string, variantId: string, action: string) => void;
};

export function ExplanationCard({ explanation: exp, actionBusy, onAction, onDirectAction }: ExplanationCardProps) {
  const busyKey = `${exp.factId}:${exp.variantId}`;
  const isBusy = !!actionBusy;

  return (
    <article className="images-card" style={{ marginTop: 8 }}>
      <div className="images-card-head">
        <strong>{exp.strategy}</strong>
        <span className={`badge ${exp.decision || exp.status}`}>{exp.decision || exp.status}</span>
        {exp.compositeScore != null && <span>Quality: {(exp.compositeScore * 100).toFixed(0)}%</span>}
      </div>
      {exp.factText && (
        <div style={{ fontSize: 11, opacity: 0.5, padding: "2px 0 4px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          Fact: {exp.factText.slice(0, 100)}{exp.factText.length > 100 ? "..." : ""}
        </div>
      )}
      <div className="images-fact" style={{ whiteSpace: "pre-wrap" }}>{exp.text}</div>
      {exp.suggestions.length > 0 && (
        <div className="images-meta">
          <span>Suggestions: {exp.suggestions.join(" | ")}</span>
        </div>
      )}
      {exp.scores && Object.keys(exp.scores).length > 0 && (
        <div className="images-judges">
          {Object.entries(exp.scores).map(([name, data]) => (
            <div key={name} className="images-judge">
              <span className="images-judge-name">{name}</span>
              <span className="images-judge-score">
                {data.score != null ? `${(data.score * 100).toFixed(0)}%` : "-"}
              </span>
              {data.flags?.length > 0 && (
                <span className="images-judge-flags">{data.flags.join(", ")}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="images-actions">
        <button
          className="images-btn-approve"
          disabled={isBusy}
          onClick={() => onDirectAction("explanation", exp.factId, exp.variantId, "approve")}
          aria-label={`Approve ${exp.strategy}`}
        >
          {actionBusy === busyKey ? "..." : "Approve"}
        </button>
        <button
          className="images-btn-danger"
          disabled={isBusy}
          onClick={() => onAction("explanation", exp.factId, exp.variantId, "reject")}
          aria-label={`Reject ${exp.strategy}`}
        >
          Reject
        </button>
        <button
          disabled={isBusy}
          onClick={() => onAction("explanation", exp.factId, exp.variantId, "regenerate")}
          aria-label={`Regenerate ${exp.strategy}`}
        >
          <Icon name="refresh" /> Regenerate
        </button>
      </div>
    </article>
  );
}
