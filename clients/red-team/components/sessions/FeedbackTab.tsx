"use client";

import type { FeedbackItem } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { fmtDate } from "./helpers";

interface FeedbackTabProps {
  feedback: FeedbackItem[] | null | undefined;
  onImageClick?: (url: string) => void;
}

function parseComment(raw: string): { text: string; images: string[] } {
  const marker = "\n\n[ATTACHMENTS]\n";
  const idx = raw.indexOf(marker);
  if (idx === -1) return { text: raw, images: [] };
  const text = raw.substring(0, idx).trim();
  const lines = raw.substring(idx + marker.length).split("\n").filter(Boolean);
  const seen = new Set<string>();
  const images: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if ((s.startsWith("data:image") || s.startsWith("http")) && !seen.has(s)) {
      seen.add(s);
      images.push(s);
    }
  }
  return { text, images };
}

export default function FeedbackTab({ feedback, onImageClick }: FeedbackTabProps) {
  if (!feedback || !feedback.length) {
    return (
      <div className="empty">
        <div className="ico">
          <Icon name="note" size={32} />
        </div>
        <div>No feedback for this session</div>
      </div>
    );
  }

  return (
    <div>
      {feedback.map((f, i) => {
        const cls = "sentiment-" + (f.sentiment || "neutral");
        const { text, images } = f.comment ? parseComment(f.comment) : { text: "", images: [] };
        const ctx = f.context_messages || [];
        return (
          <div className="feedback-item" key={i}>
            <span className={`sentiment ${cls}`}>{f.sentiment}</span>
            {(f.message_text || ctx.length > 0) && (
              <div
                style={{
                  marginTop: 8,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #334155",
                  background: "#0f172a",
                }}
              >
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Rated message
                </div>
                {ctx.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {ctx.map((m, j) => {
                      const isTarget = m.role === "assistant" && m.content === f.message_text;
                      return (
                        <div
                          key={j}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            background: isTarget ? "#1e293b" : "transparent",
                            borderLeft: isTarget ? "3px solid #38bdf8" : "3px solid transparent",
                          }}
                        >
                          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>
                            {m.role}
                            {isTarget && <span style={{ color: "#38bdf8", marginLeft: 6 }}>(rated)</span>}
                          </div>
                          <div style={{ color: isTarget ? "#e2e8f0" : "#94a3b8", whiteSpace: "pre-wrap" }}>
                            {m.content}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{f.message_text}</div>
                )}
              </div>
            )}
            {text && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                  Tester comment
                </div>
                <div style={{ color: "#cbd5e1" }}>{text}</div>
              </div>
            )}
            {images.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {images.map((src, j) => (
                  <img
                    key={j}
                    src={src}
                    alt="feedback attachment"
                    style={{ maxWidth: 300, borderRadius: 8, border: "1px solid #334155", cursor: "pointer" }}
                    onClick={() => onImageClick?.(src)}
                  />
                ))}
              </div>
            )}
            <div style={{ marginTop: 4, fontSize: 10, color: "#475569" }}>
              {fmtDate(f.created_at)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
