"use client";

import { memo, useMemo } from "react";
import { renderMarkdownWithMath } from "@/lib/markdown";
import { FeedbackRow } from "./FeedbackRow";

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  tutorName: string;
  showFeedback?: boolean;
  msgIndex?: number;
  latencyMs?: number | null;
  firstByteMs?: number | null;
  textDoneMs?: number | null;
  imageDoneMs?: number | null;
  onFeedback?: (msgIndex: number, sentiment: string) => void;
  feedbackSent?: boolean;
}

export const ChatMessage = memo(function ChatMessage({
  role,
  content,
  tutorName,
  showFeedback = false,
  msgIndex,
  latencyMs,
  firstByteMs,
  textDoneMs,
  imageDoneMs,
  onFeedback,
  feedbackSent,
}: ChatMessageProps) {
  const formattedContent = useMemo(() => {
    if (role === "assistant" || role === "system") {
      return renderMarkdownWithMath(content);
    }
    // Escape user messages
    return content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }, [content, role]);

  const meta = role === "assistant" ? tutorName : "You";
  const timeStr = new Date().toLocaleTimeString();
  const hasTimingStats = role === "assistant" && (firstByteMs != null || textDoneMs != null || imageDoneMs != null);

  return (
    <div className={`message ${role}`}>
      <div
        className="message-content"
        dangerouslySetInnerHTML={{ __html: formattedContent }}
      />
      <div className="message-meta">
        {meta} &bull; {timeStr}
        {hasTimingStats && (
          <span className="timing-stats">
            {firstByteMs != null && <span className="timing-stat">TTFB {(firstByteMs / 1000).toFixed(1)}s</span>}
            {textDoneMs != null && <span className="timing-stat">Text {(textDoneMs / 1000).toFixed(1)}s</span>}
            {imageDoneMs != null && <span className="timing-stat">Image {(imageDoneMs / 1000).toFixed(1)}s</span>}
          </span>
        )}
      </div>
      {role === "assistant" && showFeedback && msgIndex != null && onFeedback && (
        <FeedbackRow
          msgIndex={msgIndex}
          latencyMs={latencyMs}
          onFeedback={onFeedback}
          feedbackSent={feedbackSent}
        />
      )}
    </div>
  );
});
