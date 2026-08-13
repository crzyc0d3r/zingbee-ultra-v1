"use client";

import { useState, useEffect, useRef } from "react";
import type { SessionDetail, ExecStep, LearningSessionMessage, FeedbackItem } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { renderMarkdownWithMath, escapeHtml } from "@/lib/markdown";
import { fmtDate, fmtDuration, accuracyClass, stripImageBlocks, parseSuggestions } from "./helpers";
import { getStepLabel, getStepClass } from "@/components/chat/ExecStep";
import { JsonViewer } from "@/components/audits/JsonViewer";

type SessionDetailExt = SessionDetail & { facts_taught_count?: number };

// Split feedback comment into text + screenshot attachments (same marker the
// frontend uses when posting the feedback).
function parseFeedbackComment(raw: string): { text: string; images: string[] } {
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

// A unified entry that can be a chat message OR an exec log step
interface TimelineEntry {
  kind: "message" | "exec";
  time: number; // epoch ms for sorting
  order: number; // original insertion order for stable sort
  // message fields
  msg?: LearningSessionMessage;
  msgIndex?: number;
  // exec fields
  exec?: ExecStep;
  execIndex?: number;
  // image fields (extracted from exec log IMAGE entries)
  imageUrl?: string;
  imageTopic?: string;
}

function normalizeTimestamp(ts: string | undefined): number {
  if (!ts) return 0;
  let s = ts;
  if (s && !s.endsWith("Z") && !s.includes("+") && !/\d{2}:\d{2}$/.test(s.slice(-6))) {
    s += "Z";
  }
  return new Date(s).getTime() || 0;
}

function fmtTime(ts: string | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Steps that are too noisy or redundant for the timeline
const HIDDEN_STEPS = new Set([
  "IMAGE_SKIP",
  "PROGRESS_SAVED",
]);

interface TimelineTabProps {
  session: SessionDetailExt;
  onImageClick: (url: string) => void;
}

export default function TimelineTab({ session, onImageClick }: TimelineTabProps) {
  const [openExecIndices, setOpenExecIndices] = useState<Set<number>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);

  const d = session;

  // Map each assistant message to the feedback it received so we can render
  // a small panel inline under the rated message. We try two lookups:
  //   1. by *stripped* assistant text — the feedback's message_text is what
  //      the student saw, which has <EDUCATIONAL_IMAGE>/<SUGGESTIONS> tags
  //      removed, while session.messages stores the raw LLM output. Comparing
  //      against the same stripping the timeline uses makes the match work.
  //   2. by assistant ordinal (message_index in the feedback row) — robust
  //      fallback when text drifts (e.g. retry, edits, encoding nits).
  // Both maps are populated unconditionally so either lookup can succeed.
  const feedbackByText = new Map<string, FeedbackItem[]>();
  const feedbackByIndex = new Map<number, FeedbackItem[]>();
  const normFb = (s: string) =>
    parseSuggestions(stripImageBlocks(s || "")).clean.trim();
  for (const fb of d.feedback || []) {
    if (fb.message_text) {
      const key = normFb(fb.message_text);
      if (key) {
        const arr = feedbackByText.get(key) || [];
        arr.push(fb);
        feedbackByText.set(key, arr);
      }
    }
    if (typeof fb.message_index === "number" && fb.message_index >= 0) {
      const arr = feedbackByIndex.get(fb.message_index) || [];
      arr.push(fb);
      feedbackByIndex.set(fb.message_index, arr);
    }
  }
  // Pre-compute assistant ordinal per message index so we can match
  // index-based feedback to the right message.
  const assistantOrdinalByMsgIndex = new Map<number, number>();
  {
    let ord = 0;
    (d.messages || []).forEach((m, i) => {
      if (m.role === "assistant") {
        assistantOrdinalByMsgIndex.set(i, ord);
        ord++;
      }
    });
  }

  // Build unified timeline.
  // Conversation flow: user msg -> [exec entries: thinking, assessment, image] -> assistant msg
  // Exec entries go AFTER user input and BEFORE assistant reply.
  // Nothing between assistant reply and next user input (keeps conversation tight).
  const entries: TimelineEntry[] = [];
  let orderCounter = 0;

  // Collect filtered exec entries in original order
  const execList: TimelineEntry[] = [];
  if (d.execution_log) {
    d.execution_log.forEach((ex, i) => {
      if (HIDDEN_STEPS.has(ex.step)) return;
      const det = typeof ex.details === "string"
        ? (() => { try { return JSON.parse(ex.details); } catch { return {}; } })()
        : (ex.details || {});
      const isImage = (ex.step === "IMAGE_GENERATE_FULL" || ex.step === "IMAGE_GENERATE_RESULT") &&
        det.success && det.image_url;
      execList.push({
        kind: "exec", time: normalizeTimestamp(ex.timestamp), order: 0,
        exec: ex, execIndex: i,
        imageUrl: isImage ? det.image_url : undefined,
        imageTopic: isImage ? (det.topic || "") : undefined,
      });
    });
  }

  // Build timeline by walking messages and inserting exec entries
  const messages = d.messages || [];
  let ei = 0;

  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    const mTime = normalizeTimestamp(m.created_at || m.timestamp);

    // Before each assistant message, flush exec entries that occurred up to this point
    if (m.role === "assistant") {
      while (ei < execList.length && execList[ei].time <= mTime) {
        entries.push({ ...execList[ei], order: orderCounter++ });
        ei++;
      }
    }

    // Add the message itself
    entries.push({ kind: "message", time: mTime, order: orderCounter++, msg: m, msgIndex: mi });
  }

  // Append remaining exec entries after last message
  while (ei < execList.length) {
    entries.push({ ...execList[ei], order: orderCounter++ });
    ei++;
  }

  const toggleExec = (idx: number) => {
    setOpenExecIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

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
          <div className={`value${d.accuracy != null ? " " + accuracyClass(d.accuracy) : ""}`}>
            {d.accuracy != null ? d.accuracy.toFixed(0) + "%" : "-"}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Tokens</div>
          <div className="value">{(d.total_tokens || 0).toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Facts Taught</div>
          <div className="value">{d.facts_taught_count ?? 0}</div>
        </div>
      </div>

      {/* Timeline */}
      {entries.length === 0 ? (
        <div className="empty">
          <div className="ico"><Icon name="chat" size={32} /></div>
          <div>No activity in this session</div>
        </div>
      ) : (
        <div className="session-timeline">
          {entries.map((entry, i) => {
            if (entry.kind === "message" && entry.msg) {
              let msgFeedback: FeedbackItem[] = [];
              if (entry.msg.role === "assistant") {
                const key = normFb(entry.msg.content);
                msgFeedback = feedbackByText.get(key) || [];
                if (msgFeedback.length === 0 && entry.msgIndex !== undefined) {
                  const ord = assistantOrdinalByMsgIndex.get(entry.msgIndex);
                  if (ord !== undefined) {
                    msgFeedback = feedbackByIndex.get(ord) || [];
                  }
                }
              }
              return (
                <TimelineMessage
                  key={`msg-${i}`}
                  msg={entry.msg}
                  feedback={msgFeedback}
                  onImageClick={onImageClick}
                />
              );
            }
            if (entry.kind === "exec" && entry.exec) {
              const idx = entry.execIndex ?? i;
              return (
                <TimelineExecEntry
                  key={`exec-${i}`}
                  entry={entry}
                  isOpen={openExecIndices.has(idx)}
                  onToggle={() => toggleExec(idx)}
                  onImageClick={onImageClick}
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function TimelineMessage({
  msg,
  feedback,
  onImageClick,
}: {
  msg: LearningSessionMessage;
  feedback?: FeedbackItem[];
  onImageClick: (url: string) => void;
}) {
  const cls = msg.role === "user" ? "user" : msg.role === "system" ? "system" : "assistant";
  const roleLabel = msg.role === "user" ? "Student" : msg.role === "system" ? "System" : "Tutor";

  const stripped = cls === "assistant" ? stripImageBlocks(msg.content) : msg.content;
  const { clean: cleanContent, suggestions } =
    cls === "assistant" ? parseSuggestions(stripped) : { clean: stripped, suggestions: [] };

  const content = cls === "user" ? escapeHtml(cleanContent) : renderMarkdownWithMath(cleanContent);

  return (
    <div className={`timeline-entry timeline-msg ${cls}`}>
      <div className="timeline-dot" />
      <div className="timeline-body">
        <div className="msg-content" dangerouslySetInnerHTML={{ __html: content }} />
        {suggestions.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {suggestions.map((s, j) => (
              <span key={j} className="timeline-suggestion">{s}</span>
            ))}
          </div>
        )}
        <div className="msg-meta">{roleLabel} &middot; {fmtDate(msg.created_at)}</div>
        {feedback && feedback.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {feedback.map((fb, k) => {
              const { text: fbText, images: fbImages } = fb.comment
                ? parseFeedbackComment(fb.comment)
                : { text: "", images: [] };
              const sCls = "sentiment-" + (fb.sentiment || "neutral");
              return (
                <div
                  key={k}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid #334155",
                    background: "#0f172a",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: fbText || fbImages.length ? 6 : 0 }}>
                    <span className={`sentiment ${sCls}`}>{fb.sentiment}</span>
                    <span style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Tester feedback
                    </span>
                    {fb.created_at && (
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569" }}>
                        {fmtDate(fb.created_at)}
                      </span>
                    )}
                  </div>
                  {fbText && (
                    <div style={{ color: "#cbd5e1", whiteSpace: "pre-wrap", fontSize: 13 }}>
                      {fbText}
                    </div>
                  )}
                  {fbImages.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {fbImages.map((src, j) => (
                        <img
                          key={j}
                          src={src}
                          alt="feedback attachment"
                          style={{
                            maxWidth: 220,
                            borderRadius: 6,
                            border: "1px solid #334155",
                            cursor: "pointer",
                          }}
                          onClick={() => onImageClick(src)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineExecEntry({
  entry,
  isOpen,
  onToggle,
  onImageClick,
}: {
  entry: TimelineEntry;
  isOpen: boolean;
  onToggle: () => void;
  onImageClick: (url: string) => void;
}) {
  const ex = entry.exec!;
  const stepClass = getStepClass(ex.step);
  const label = getStepLabel(ex.step);
  const agent = ex.agent || "";
  const ts = ex.timestamp ? fmtTime(ex.timestamp) : "";

  // If this is an image entry, show label + image inline
  if (entry.imageUrl) {
    return (
      <div className="timeline-entry timeline-exec timeline-image media">
        <div className="timeline-dot media" />
        <div className="timeline-body">
          <div className="timeline-exec-header">
            <span className="timeline-exec-label">{label}</span>
            {agent && <span className="agent-badge">{agent}</span>}
            <span className="timeline-exec-time">{ts}</span>
          </div>
          <img
            src={entry.imageUrl}
            alt={entry.imageTopic || "Educational image"}
            className="timeline-img"
            loading="lazy"
            onClick={() => onImageClick(entry.imageUrl!)}
          />
          {entry.imageTopic && <div className="img-caption">{entry.imageTopic}</div>}
        </div>
      </div>
    );
  }

  const details = ex.details;
  const hasDetails = details && Object.keys(details).length > 0;

  return (
    <div className={`timeline-entry timeline-exec ${stepClass}`}>
      <div className={`timeline-dot ${stepClass}`} />
      <div className="timeline-body">
        <div className="timeline-exec-header" onClick={hasDetails ? onToggle : undefined} style={hasDetails ? { cursor: "pointer" } : undefined}>
          <span className="timeline-exec-label">{label}</span>
          {agent && <span className="agent-badge">{agent}</span>}
          <span className="timeline-exec-time">{ts}</span>
          {hasDetails && <span className="timeline-expand">{isOpen ? "\u25BC" : "\u25B6"}</span>}
        </div>
        {isOpen && hasDetails && (
          <div className="timeline-exec-details">
            <JsonViewer
              data={typeof details === "string" ? (() => { try { return JSON.parse(details); } catch { return details; } })() : details}
            />
          </div>
        )}
      </div>
    </div>
  );
}
