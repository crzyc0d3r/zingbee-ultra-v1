import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { DistillationImageVariant } from "@/lib/distillations/types";

type ImageCardProps = {
  image: DistillationImageVariant;
  actionBusy: string;
  onAction: (type: string, factId: string, variantId: string, action: string) => void;
  onDirectAction: (type: string, factId: string, variantId: string, action: string, note?: string) => void;
  factText?: string;
  explanationText?: string;
};

export function ImageCard({ image: img, actionBusy, onAction, onDirectAction, factText, explanationText }: ImageCardProps) {
  const badge = img.decision || "pending";
  const busyKey = `${img.factId}:${img.variantId}`;
  const isBusy = !!actionBusy;
  const [contextOpen, setContextOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [note, setNote] = useState("");
  const hasContext = factText || explanationText;

  return (
    <article className="images-card" style={{ marginTop: 8 }}>
      <div className="images-card-head">
        <span className={`badge ${badge}`}>{badge}</span>
        {img.composite != null && <span>Quality: {(img.composite * 100).toFixed(0)}%</span>}
        {img.humanReviewStatus && <span className="badge">{img.humanReviewStatus}</span>}
        {hasContext && (
          <button
            onClick={() => setContextOpen((v) => !v)}
            style={{ fontSize: 11, opacity: 0.6, padding: "2px 8px", marginLeft: "auto" }}
            title={contextOpen ? "Hide context" : "Show fact & explanation context"}
          >
            {contextOpen ? "Hide Context" : "Show Context"}
          </button>
        )}
      </div>

      {/* Collapsible fact/explanation context */}
      {contextOpen && hasContext && (
        <div style={{ padding: "8px 12px", background: "rgba(100,200,255,0.06)", borderRadius: 6, marginBottom: 8, fontSize: 12 }}>
          {factText && (
            <div style={{ marginBottom: explanationText ? 6 : 0 }}>
              <span style={{ fontWeight: 600, opacity: 0.5, marginRight: 6 }}>Fact:</span>
              {factText}
            </div>
          )}
          {explanationText && (
            <div style={{ maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap" }}>
              <span style={{ fontWeight: 600, opacity: 0.5, marginRight: 6 }}>Explanation:</span>
              {explanationText}
            </div>
          )}
        </div>
      )}

      {img.imageUrl && (
        <div style={{ margin: "8px 0" }}>
          <img
            src={img.imageUrl}
            alt={img.imagePrompt || img.factText || "Generated image"}
            style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8, cursor: "pointer" }}
            onClick={() => window.open(img.imageUrl, "_blank")}
            title="Click to view full size"
          />
        </div>
      )}
      {img.imagePrompt && (
        <div className="images-meta">
          <span>Prompt: {img.imagePrompt.slice(0, 120)}{img.imagePrompt.length > 120 ? "..." : ""}</span>
        </div>
      )}
      {img.scores && Object.keys(img.scores).length > 0 && (
        <div className="images-judges">
          {Object.entries(img.scores).map(([name, data]) => (
            <div key={name} className="images-judge">
              <span className="images-judge-name">{name}</span>
              <span className="images-judge-score">
                {data.score != null ? `${(data.score * 100).toFixed(0)}%` : "-"}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="images-actions">
        <button
          className="images-btn-approve"
          disabled={isBusy}
          onClick={() => onDirectAction("image", img.factId, img.variantId, "approve", note || undefined)}
          aria-label="Approve image"
        >
          {actionBusy === busyKey ? "..." : "Approve"}
        </button>
        <button
          className="images-btn-warn"
          disabled={isBusy}
          onClick={() => onAction("image", img.factId, img.variantId, "needs_work")}
          aria-label="Needs work"
        >
          Needs Work
        </button>
        <button
          className="images-btn-danger"
          disabled={isBusy}
          onClick={() => onAction("image", img.factId, img.variantId, "reject")}
          aria-label="Reject image"
        >
          Reject
        </button>
        <button
          disabled={isBusy}
          onClick={() => onAction("image", img.factId, img.variantId, "regenerate")}
          aria-label="Regenerate image"
        >
          <Icon name="refresh" /> Regenerate
        </button>
        <button
          style={{ fontSize: 11, opacity: 0.6, padding: "2px 8px", marginLeft: "auto" }}
          onClick={() => setReviewOpen((v) => !v)}
        >
          {reviewOpen ? "Hide Note" : "Add Note"}
        </button>
      </div>
      {reviewOpen && (
        <div style={{ padding: "6px 0" }}>
          <textarea
            placeholder="Review note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            style={{ width: "100%", fontSize: 12, borderRadius: 6, padding: "6px 8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)", color: "inherit", resize: "vertical" }}
          />
        </div>
      )}
    </article>
  );
}
