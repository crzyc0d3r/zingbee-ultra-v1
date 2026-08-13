"use client";

import type { ImageVariant } from "@/lib/images/types";

type VariantCardProps = {
  variant: ImageVariant;
  /** Optional action buttons rendered below the card content */
  children?: React.ReactNode;
  /** Show judge scores inline */
  showScores?: boolean;
};

export function VariantCard({ variant, children, showScores }: VariantCardProps) {
  return (
    <article className="images-card">
      <div className="images-card-head">
        <strong>Fact {variant.factOrder}</strong>
        <span className={`badge ${variant.decision || "none"}`}>
          {variant.decision || "UNEVALUATED"}
        </span>
        {variant.humanReviewStatus && (
          <span className={`badge human-${variant.humanReviewStatus}`}>
            {variant.humanReviewStatus}
          </span>
        )}
      </div>
      <div className="images-fact">{variant.factText}</div>
      <div className="images-meta">
        <span>Model: {variant.provider || "?"}:{variant.model || "?"}</span>
        <span>Strategy: {variant.promptStrategy || "baseline"}</span>
        <span>Prompt: {variant.promptVersion || "-"}</span>
        {variant.composite != null && (
          <span>Score: {(variant.composite * 100).toFixed(0)}%</span>
        )}
      </div>
      {variant.imageUrl && (
        <>
          <img
            src={variant.imageUrl}
            alt={`Fact ${variant.factOrder} image`}
            className="images-preview"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <a href={variant.imageUrl} target="_blank" rel="noreferrer" className="images-link">Open image</a>
        </>
      )}
      {showScores && variant.judges && Object.keys(variant.judges).length > 0 && (
        <div className="images-judges">
          {Object.entries(variant.judges).map(([name, payload]) => (
            <div key={name} className="images-judge">
              <span className="images-judge-name">{name}</span>
              <span className="images-judge-score">
                {payload.score != null ? `${(payload.score * 100).toFixed(0)}%` : "-"}
              </span>
              {payload.flags?.length ? (
                <span className="images-judge-flags">{payload.flags.join(", ")}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {variant.reasons?.length ? (
        <div className="images-reasons">
          {variant.reasons.map((r, i) => <div key={i} className="images-reason">{r}</div>)}
        </div>
      ) : null}
      {children}
    </article>
  );
}
