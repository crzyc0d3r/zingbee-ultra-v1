"use client";

import { useEffect, useRef } from "react";
import type { SessionDetail } from "@/lib/types";

type SessionDetailExt = SessionDetail & { facts_taught_count?: number };
import { Icon } from "@/components/ui/Icon";
import { renderMarkdownWithMath } from "@/lib/markdown";
import { escapeHtml } from "@/lib/markdown";
import { fmtDate, fmtDuration, accuracyClass, extractImages } from "./helpers";

function normalizeTags(text: string): string {
  return text
    .replace(/\[IMAGE\]/g, "<IMAGE>").replace(/\[\/IMAGE\]/g, "</IMAGE>")
    .replace(/\[DIAGRAM\]/g, "<IMAGE>").replace(/\[\/DIAGRAM\]/g, "</IMAGE>")
    .replace(/\[SUGGESTIONS\]/g, "<SUGGESTIONS>").replace(/\[\/SUGGESTIONS\]/g, "</SUGGESTIONS>");
}

function stripImageBlocks(text: string): string {
  text = normalizeTags(text);
  let clean = text.replace(/<IMAGE>[\s\S]*?<\/IMAGE>/g, "");
  const idx = clean.indexOf("<IMAGE>");
  if (idx !== -1) clean = clean.slice(0, idx);
  clean = clean.replace(/<IMAGE>/g, "").replace(/<\/IMAGE>/g, "");
  return clean.trim();
}

function parseSuggestions(text: string): { clean: string; suggestions: string[] } {
  text = normalizeTags(text);
  const suggestions: string[] = [];
  let clean = text;

  const paired = /<SUGGESTIONS>([\s\S]*?)<\/SUGGESTIONS>/g;
  clean = clean.replace(paired, (_m, block: string) => {
    for (const line of block.trim().split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) suggestions.push(trimmed.slice(2).trim().replace(/^"|"$/g, ""));
      else if (trimmed && trimmed !== "<SUGGESTIONS>" && trimmed !== "</SUGGESTIONS>") suggestions.push(trimmed.replace(/^"|"$/g, ""));
    }
    return "";
  });

  if (clean.includes("<SUGGESTIONS>")) {
    const idx = clean.indexOf("<SUGGESTIONS>");
    const block = clean.slice(idx + "<SUGGESTIONS>".length);
    for (const line of block.trim().split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) suggestions.push(trimmed.slice(2).trim().replace(/^"|"$/g, ""));
      else if (trimmed) suggestions.push(trimmed.replace(/^"|"$/g, ""));
    }
    clean = clean.slice(0, idx);
  }

  clean = clean.replace(/<SUGGESTIONS>/g, "").replace(/<\/SUGGESTIONS>/g, "");

  return { clean: clean.trim(), suggestions: suggestions.slice(0, 4) };
}

interface TranscriptTabProps {
  session: SessionDetailExt;
  onImageClick: (url: string) => void;
}

export default function TranscriptTab({
  session,
  onImageClick,
}: TranscriptTabProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // KaTeX auto-render is already handled by renderMarkdownWithMath,
  // but we keep a ref in case we need additional DOM processing.
  useEffect(() => {
    // No-op: KaTeX is rendered server-side via renderMarkdownWithMath
  }, [session]);

  const d = session;
  const images = extractImages(d.execution_log);
  let imageIdx = 0;

  return (
    <div ref={bodyRef}>
      {/* Stats header */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Duration</div>
          <div className="value">{fmtDuration(d.duration_seconds)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Questions</div>
          <div className="value">{d.questions_asked}</div>
        </div>
        <div className="stat-card">
          <div className="label">Correct</div>
          <div className="value">{d.correct_answers}</div>
        </div>
        <div className="stat-card">
          <div className="label">Accuracy</div>
          <div
            className={`value${d.accuracy != null ? " " + accuracyClass(d.accuracy) : ""}`}
          >
            {d.accuracy != null ? d.accuracy.toFixed(0) + "%" : "-"}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Tokens</div>
          <div className="value">
            {(d.total_tokens || 0).toLocaleString()}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Facts Taught</div>
          <div className="value">{d.facts_taught_count ?? 0}</div>
        </div>
      </div>

      {/* Chat transcript */}
      {!d.messages.length ? (
        <div className="empty">
          <div className="ico">
            <Icon name="chat" size={32} />
          </div>
          <div>No messages in this session</div>
        </div>
      ) : (
        <div className="chat-transcript">
          {d.messages.map((m, i) => {
            const cls =
              m.role === "user"
                ? "user"
                : m.role === "system"
                  ? "system"
                  : "assistant";
            const roleLabel =
              m.role === "user"
                ? "Student"
                : m.role === "system"
                  ? "System"
                  : "Tutor";

            // Strip <IMAGE> blocks and parse <SUGGESTIONS> from assistant messages
            const stripped = cls === "assistant" ? stripImageBlocks(m.content) : m.content;
            const { clean: cleanContent, suggestions } =
              cls === "assistant" ? parseSuggestions(stripped) : { clean: stripped, suggestions: [] };

            const content =
              cls === "user"
                ? escapeHtml(cleanContent)
                : renderMarkdownWithMath(cleanContent);

            // Check if we should show an image before this assistant message
            let inlineImage = null;
            if (cls === "assistant" && imageIdx < images.length) {
              const img = images[imageIdx];
              inlineImage = (
                <div className="chat-img" key={`img-${i}`}>
                  <img
                    src={img.url}
                    alt={img.topic}
                    loading="lazy"
                    onClick={() => onImageClick(img.url)}
                  />
                  <div className="img-caption">{img.topic}</div>
                </div>
              );
              imageIdx++;
            }

            return (
              <div key={i} style={{ display: "contents" }}>
                {inlineImage}
                <div className={`chat-msg ${cls}`}>
                  <div
                    className="msg-content"
                    dangerouslySetInnerHTML={{ __html: content }}
                  />
                  {suggestions.length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {suggestions.map((s, j) => (
                        <span
                          key={j}
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            fontSize: 11,
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
                  )}
                  <div className="msg-meta">
                    {roleLabel} &middot; {fmtDate(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
