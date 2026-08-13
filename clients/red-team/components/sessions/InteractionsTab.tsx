"use client";

import { useState } from "react";
import type { InteractionItem, InteractionMessage } from "@/lib/types";
import type { ExecStep } from "@/lib/types";
import { renderMarkdownWithMath, escapeHtml } from "@/lib/markdown";
import { fmtDate, parseSuggestions, buildTimedImageList, buildScopedImageMap, parseContentSegments } from "./helpers";
import type { ContentSegment } from "./helpers";

interface InteractionsTabProps {
  interactions: InteractionItem[] | null | undefined;
  executionLog?: ExecStep[] | null;
  onImageClick: (url: string) => void;
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    student_correct: "#22c55e",
    student_incorrect: "#ef4444",
    teaching: "#3b82f6",
    confirmation: "#94a3b8",
  };
  const color = colors[type] || "#94a3b8";
  return (
    <span
      style={{
        color,
        fontWeight: 600,
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

function UnderstoodCell({ val }: { val?: boolean | null }) {
  if (val === true) return <span style={{ color: "#22c55e" }}>Yes</span>;
  if (val === false) return <span style={{ color: "#ef4444" }}>No</span>;
  return <span style={{ color: "#475569" }}>-</span>;
}

/** Suggestion pill chip — matches TranscriptTab styling */
function SuggestionChips({ suggestions }: { suggestions: string[] }) {
  if (!suggestions.length) return null;
  return (
    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
      {suggestions.map((s, j) => (
        <span
          key={j}
          style={{
            display: "inline-block",
            padding: "3px 8px",
            fontSize: 10,
            borderRadius: 12,
            background: "rgba(99,102,241,0.15)",
            color: "#a5b4fc",
            border: "1px solid rgba(99,102,241,0.3)",
          }}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function InlineImage({ seg, onImageClick }: { seg: ContentSegment & { type: "image" }; onImageClick: (url: string) => void }) {
  return (
    <div
      style={{ margin: "8px 0", cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); onImageClick(seg.url); }}
    >
      <img
        src={seg.url}
        alt={seg.topic}
        loading="lazy"
        style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, display: "block" }}
      />
      {seg.topic && (
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{seg.topic}</div>
      )}
    </div>
  );
}

function MessagePreview({
  messages,
  imageMap,
  onImageClick,
}: {
  messages?: InteractionMessage[];
  imageMap: Map<string, { url: string; topic: string }>;
  onImageClick: (url: string) => void;
}) {
  if (!messages || messages.length === 0) return null;

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {messages.map((m, i) => {
        const isAssistant = m.role !== "user";

        if (isAssistant) {
          // Parse suggestions first (before image parsing)
          const { clean: noSuggestions, suggestions } = parseSuggestions(m.content);
          // Split into text + image segments, matching <IMAGE> blocks to actual URLs
          const segments = parseContentSegments(noSuggestions, imageMap);

          return (
            <div key={i}>
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.6,
                  background: "rgba(34,197,94,0.08)",
                  borderLeft: "3px solid #22c55e",
                  color: "#cbd5e1",
                  wordBreak: "break-word",
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", textTransform: "uppercase", marginRight: 8 }}>
                  Tutor
                </span>
                {segments.map((seg, j) =>
                  seg.type === "image" ? (
                    <InlineImage key={j} seg={seg} onImageClick={onImageClick} />
                  ) : (
                    <div
                      key={j}
                      className="msg-content"
                      style={{ marginTop: j === 0 ? 4 : 0 }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdownWithMath(seg.content) }}
                    />
                  )
                )}
                <SuggestionChips suggestions={suggestions} />
              </div>
            </div>
          );
        }

        return (
          <div
            key={i}
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.6,
              background: "rgba(59,130,246,0.08)",
              borderLeft: "3px solid #3b82f6",
              color: "#cbd5e1",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", marginRight: 8 }}>
              Student
            </span>
            <span dangerouslySetInnerHTML={{ __html: escapeHtml(m.content) }} />
          </div>
        );
      })}
    </div>
  );
}

export default function InteractionsTab({ interactions, executionLog, onImageClick }: InteractionsTabProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const items = interactions || [];
  const timedImages = buildTimedImageList(executionLog);

  if (items.length === 0) {
    return (
      <div className="empty" style={{ padding: 40, color: "#475569" }}>
        No fact interactions recorded
      </div>
    );
  }

  return (
    <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Fact</th>
            <th style={thStyle}>Type</th>
            <th style={{ ...thStyle, textAlign: "center" }}>Understood</th>
            <th style={{ ...thStyle, textAlign: "center" }}>Exposure</th>
            <th style={{ ...thStyle, textAlign: "center" }}>Step</th>
            <th style={thStyle}>Time</th>
          </tr>
        </thead>
        <tbody>
          {items.map((ix, i) => {
            const hasMessages = ix.messages && ix.messages.length > 0;
            const isExpanded = expandedIdx === i;
            return (
              <tr
                key={`${ix.fact_text}-${ix.type}-${i}`}
                style={{ cursor: hasMessages ? "pointer" : "default" }}
                onClick={() => hasMessages && setExpandedIdx(isExpanded ? null : i)}
              >
                <td style={tdStyle} colSpan={isExpanded ? 6 : 1}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    {hasMessages && (
                      <span style={{ color: "#475569", fontSize: 10, flexShrink: 0, marginTop: 2 }}>
                        {isExpanded ? "\u25BC" : "\u25B6"}
                      </span>
                    )}
                    <div style={{ whiteSpace: "normal", width: "100%" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <span>{ix.fact_text}</span>
                        {isExpanded && (
                          <>
                            <TypeBadge type={ix.type} />
                            <UnderstoodCell val={ix.understood} />
                            <span style={{ color: "#64748b", fontSize: 11 }}>{fmtDate(ix.created_at)}</span>
                          </>
                        )}
                      </div>
                      {isExpanded && (
                        <MessagePreview
                          messages={ix.messages}
                          imageMap={buildScopedImageMap(timedImages, ix.created_at)}
                          onImageClick={onImageClick}
                        />
                      )}
                    </div>
                  </div>
                </td>
                {!isExpanded && (
                  <>
                    <td style={tdStyle}><TypeBadge type={ix.type} /></td>
                    <td style={{ ...tdStyle, textAlign: "center" }}><UnderstoodCell val={ix.understood} /></td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{ix.exposure || "-"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{ix.step || "-"}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{fmtDate(ix.created_at)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  background: "#0f172a",
  padding: "7px 10px",
  textAlign: "left",
  fontWeight: 600,
  color: "#94a3b8",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "2px solid #334155",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid #1e293b",
  verticalAlign: "top",
};
