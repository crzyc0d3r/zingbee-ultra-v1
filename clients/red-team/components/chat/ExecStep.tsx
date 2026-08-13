"use client";

import { escapeHtml } from "@/lib/markdown";

const STEP_LABELS: Record<string, string> = {
  IMAGE_REQUEST: "Image Requested",
  IMAGE_GENERATE_FULL: "Image Ready",
  IMAGE_GENERATE_RESULT: "Image Ready",
  IMAGE_GENERATION_FAILED: "Image Failed",
  IMAGE_GENERATION_ERROR: "Image Error",
  IMAGE_REQUEST_ERROR: "Image Request Failed",
  IMAGE_SKIP: "Image Skipped",
  LLM_REQUEST: "Tutor Thinking",
  LLM_RESPONSE: "Tutor Replied",
  LLM_ERROR: "Tutor Error",
  LLM_CALL: "LLM Call",
  ASSESSMENT_LLM_REQUEST: "Assessing Student",
  ASSESSMENT_LLM_RESPONSE: "Assessment Done",
  USER_INPUT: "Student Message",
  GREETING_SENT: "Greeting Sent",
  SESSION_START: "Session Started",
  SESSION_END: "Session Ended",
  STEP_TRANSITION: "Step Change",
  FACT_TAUGHT: "Fact Taught",
  FACT_MASTERED: "Fact Mastered",
  COMPREHENSION_CHECK: "Comprehension Check",
  GUARDRAIL_TRIGGERED: "Guardrail Triggered",
  PROGRESS_SAVED: "Progress Saved",
  PROGRESS_LOADED: "Progress Loaded",
  CURRICULUM_LOADED: "Curriculum Loaded",
  CAPSULE_COMPLETE: "Capsule Complete",
  ERROR: "Error",
  STEP_UPDATE: "Step Update",
  CROSS_FACT_REDIRECT: "Cross-Fact Redirect",
  CROSS_FACT_SKIP_MASTERED: "Cross-Fact Skip",
  STATE_MACHINE_FALLTHROUGH: "State Fallthrough",
  FACT_ASSESSED: "Fact Assessed",
  CYCLE_ADVANCE: "Cycle Advance",
};

const STEP_ICONS: Record<string, string> = {
  "user-input": "\uD83D\uDC64",
  llm: "\uD83E\uDD16",
  error: "\u274C",
  success: "\u2705",
  data: "\uD83D\uDCC2",
  media: "\uD83D\uDDBC\uFE0F",
  complete: "\u2705",
};

export function getStepLabel(step: string): string {
  return (
    STEP_LABELS[step] ||
    step
      .replace(/_/g, " ")
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
  );
}

export function getStepClass(step: string): string {
  if (step === "CYCLE_ADVANCE") return "cycle";
  if (step.includes("USER")) return "user-input";
  if (step.includes("LLM") || step.includes("ASSESSMENT")) return "llm";
  if (step.includes("ERROR") || step.includes("SKIPPED")) return "error";
  if (
    step.includes("SESSION") ||
    step.includes("CORRECT") ||
    step.includes("SUCCESS") ||
    step.includes("MASTERED") ||
    step.includes("COMPLETE")
  )
    return "success";
  if (step.includes("LOAD") || step.includes("PROGRESS") || step.includes("CURRICULUM"))
    return "data";
  if (step.includes("IMAGE") || step.includes("MEDIA")) return "media";
  return "";
}

function formatStepDetails(name: string, detailsStr: string): string {
  try {
    const parsed = JSON.parse(detailsStr);

    if (name === "COMPREHENSION_CHECK") {
      return (
        `<span style="color:#60a5fa;">Result:</span> ${escapeHtml(parsed.result || "?")}<br>` +
        `<span style="color:#60a5fa;">Fact:</span> ${escapeHtml((parsed.fact_discussed || "?").substring(0, 80))}<br>` +
        (parsed.reason
          ? `<span style="color:#60a5fa;">Reason:</span> ${escapeHtml(parsed.reason.substring(0, 120))}`
          : "")
      );
    }
    if (name === "STEP_TRANSITION") {
      return (
        `<span style="color:#f59e0b;font-weight:bold;">${escapeHtml(parsed.from || "?")} -> ${escapeHtml(parsed.to || "?")}</span><br>` +
        `<span style="color:#60a5fa;">Fact:</span> ${escapeHtml((parsed.fact || "?").substring(0, 80))}`
      );
    }
    if (name === "FACT_TAUGHT") {
      return `<span style="color:#22c55e;">Taught ${parsed.taught_count}/${parsed.total}:</span> ${escapeHtml((parsed.fact || "?").substring(0, 100))}`;
    }
    if (name === "FACT_MASTERED") {
      return `<span style="color:#a855f7;font-weight:bold;">MASTERED (${parsed.mastered_count}/${parsed.total}):</span> ${escapeHtml((parsed.fact || "?").substring(0, 100))}`;
    }
    if (name === "STEP_UPDATE") {
      const sub = parsed.sub_step || parsed.step_name || "?";
      const prog = `${parsed.mastered_count ?? "?"}/${parsed.total_facts ?? "?"}`;
      const teach = parsed.teach_done !== undefined ? `T:${parsed.teach_done}/${parsed.teach_required ?? "?"}` : "";
      const tryP = parsed.try_done !== undefined ? `P:${parsed.try_done}/${parsed.try_required ?? "?"}` : "";
      return (
        `<span style="color:#f59e0b;font-weight:bold;">${escapeHtml(sub)}</span> ` +
        `<span style="color:#888;">[${prog} mastered]</span><br>` +
        (parsed.fact ? `<span style="color:#60a5fa;">Fact:</span> ${escapeHtml(String(parsed.fact).substring(0, 80))}<br>` : "") +
        `<span style="color:#60a5fa;">${teach} ${tryP}</span>` +
        (parsed.resets ? ` <span style="color:#ef4444;">resets: ${parsed.resets}</span>` : "")
      );
    }
    if (name === "ASSESSMENT_LLM_RESPONSE" && parsed.full_response) {
      try {
        const resp = typeof parsed.full_response === "string" ? JSON.parse(parsed.full_response) : parsed.full_response;
        const lines: string[] = [];
        if (resp.interaction_type) lines.push(`<span style="color:#f59e0b;font-weight:bold;">${escapeHtml(resp.interaction_type)}</span>`);
        if (resp.fact_discussed) lines.push(`<span style="color:#60a5fa;">Fact:</span> ${escapeHtml(String(resp.fact_discussed).substring(0, 80))}`);
        if (resp.understood !== undefined) lines.push(`<span style="color:#60a5fa;">Understood:</span> ${resp.understood ? '<span style="color:#22c55e;">Yes</span>' : '<span style="color:#ef4444;">No</span>'}`);
        if (resp.score !== undefined) lines.push(`<span style="color:#60a5fa;">Score:</span> ${escapeHtml(String(resp.score))}`);
        if (resp.reason) lines.push(`<span style="color:#60a5fa;">Reason:</span> ${escapeHtml(String(resp.reason).substring(0, 100))}`);
        if (lines.length > 0) return lines.join("<br>");
      } catch { /* fall through to generic */ }
    }

    // Generic: show first 3 keys
    const entries = Object.entries(parsed);
    let result = entries
      .slice(0, 3)
      .map(
        ([k, v]) =>
          `<span style="color:#60a5fa">${k}:</span> ${typeof v === "string" ? v.substring(0, 50) : JSON.stringify(v).substring(0, 50)}`
      )
      .join("<br>");
    if (entries.length > 3) {
      result += '<br><span style="color:#888;">... click for more</span>';
    }
    return result;
  } catch {
    return escapeHtml(detailsStr).substring(0, 150);
  }
}

interface ExecStepProps {
  name: string;
  details: string;
  className: string;
  agent?: string;
  timestamp?: string;
  onClick: () => void;
}

export function ExecStepItem({
  name,
  details,
  className,
  agent,
  timestamp,
  onClick,
}: ExecStepProps) {
  const icon = STEP_ICONS[className] || "\uD83D\uDCCC";
  const agentBadge = agent ? (
    <span className="agent-badge">{agent}</span>
  ) : null;

  const formattedDetails = formatStepDetails(name, details);
  const timeStr = timestamp || new Date().toLocaleTimeString();

  return (
    <div className={`exec-step ${className}`} onClick={onClick}>
      <div className="exec-step-header">
        <span className="exec-step-name">
          {icon} {getStepLabel(name)}
          {agentBadge}
        </span>
        <span className="exec-step-time">{timeStr}</span>
      </div>
      <div
        className="exec-step-details"
        dangerouslySetInnerHTML={{ __html: formattedDetails }}
      />
    </div>
  );
}
