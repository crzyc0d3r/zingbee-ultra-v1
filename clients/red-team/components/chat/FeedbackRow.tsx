"use client";

interface FeedbackRowProps {
  msgIndex: number;
  latencyMs?: number | null;
  onFeedback: (msgIndex: number, sentiment: string) => void;
  feedbackSent?: boolean;
}

export function FeedbackRow({
  msgIndex,
  latencyMs,
  onFeedback,
  feedbackSent,
}: FeedbackRowProps) {
  if (feedbackSent) {
    return (
      <div className="feedback-row">
        <span className="fb-sent">Feedback recorded</span>
      </div>
    );
  }

  const latencyHtml =
    latencyMs != null ? (
      <span
        style={{
          marginLeft: "auto",
          fontSize: "10px",
          color: "#475569",
          whiteSpace: "nowrap",
        }}
      >
        {(latencyMs / 1000).toFixed(1)}s
      </span>
    ) : null;

  return (
    <div className="feedback-row" data-msg-index={msgIndex}>
      <button
        className="fb-btn fb-up"
        onClick={() => onFeedback(msgIndex, "positive")}
      >
        <span className="fb-tooltip">Good response</span>
        {"\uD83D\uDC4D"}
      </button>
      <button
        className="fb-btn fb-down"
        onClick={() => onFeedback(msgIndex, "negative")}
      >
        <span className="fb-tooltip">Needs improvement</span>
        {"\uD83D\uDC4E"}
      </button>
      <button
        className="fb-btn fb-idea"
        onClick={() => onFeedback(msgIndex, "idea")}
      >
        <span className="fb-tooltip">Share an idea</span>
        {"\uD83D\uDCA1"}
      </button>
      <button
        className="fb-btn fb-question"
        onClick={() => onFeedback(msgIndex, "question")}
      >
        <span className="fb-tooltip">Ask a question</span>
        {"\u2753"}
      </button>
      {latencyHtml}
    </div>
  );
}
