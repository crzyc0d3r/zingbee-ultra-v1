import type { ExecStep, InteractionItem } from "@/lib/types";

// --- Content parsing helpers (shared by TranscriptTab & InteractionsTab) ---

export type ContentSegment =
  | { type: "text"; content: string }
  | { type: "image"; url: string; topic: string };

/**
 * Normalize legacy bracket tags to XML format.
 */
function normalizeTags(text: string): string {
  return text
    .replace(/\[IMAGE\]/g, "<IMAGE>").replace(/\[\/IMAGE\]/g, "</IMAGE>")
    .replace(/\[DIAGRAM\]/g, "<IMAGE>").replace(/\[\/DIAGRAM\]/g, "</IMAGE>")
    .replace(/\[SUGGESTIONS\]/g, "<SUGGESTIONS>").replace(/\[\/SUGGESTIONS\]/g, "</SUGGESTIONS>")
    .replace(/\[SUGGESTED\]/g, "<SUGGESTIONS>").replace(/\[\/SUGGESTED\]/g, "</SUGGESTIONS>");
}

/**
 * Split message text into interleaved text and image segments.
 * <IMAGE> blocks are matched to actual generated images by topic.
 * This preserves the inline position of each image in the message.
 */
export function parseContentSegments(
  text: string,
  imageMap: Map<string, { url: string; topic: string }>,
): ContentSegment[] {
  text = normalizeTags(text);
  const segments: ContentSegment[] = [];

  // Match paired <IMAGE>...</IMAGE> blocks
  const regex = /<IMAGE>([\s\S]*?)<\/IMAGE>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before this image block
    if (match.index > lastIndex) {
      const part = text.slice(lastIndex, match.index).trim();
      if (part) segments.push({ type: "text", content: part });
    }

    // Extract topic and embedded url from block content
    const block = match[1];
    const topicLine = block.match(/topic:\s*(.+)/i);
    const topic = topicLine ? topicLine[1].trim() : "";
    const urlLine = block.match(/url:\s*(\S+)/i);
    const embeddedUrl = urlLine ? urlLine[1].trim() : "";

    if (embeddedUrl) {
      segments.push({ type: "image", url: embeddedUrl, topic });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last image block (also handle unclosed <IMAGE>)
  if (lastIndex < text.length) {
    let remaining = text.slice(lastIndex);
    const unclosed = remaining.indexOf("<IMAGE>");
    if (unclosed !== -1) remaining = remaining.slice(0, unclosed);
    remaining = remaining.replace(/<IMAGE>/g, "").replace(/<\/IMAGE>/g, "").trim();
    if (remaining) segments.push({ type: "text", content: remaining });
  }

  return segments;
}

/**
 * Build a topic -> image lookup from execution log image entries.
 * Keys are lowercased for fuzzy matching.
 */
export function buildImageMap(
  log: ExecStep[] | null | undefined,
): Map<string, { url: string; topic: string }> {
  const map = new Map<string, { url: string; topic: string }>();
  if (!log) return map;
  for (const entry of log) {
    if (
      (entry.step === "IMAGE_GENERATE_FULL" || entry.step === "IMAGE_GENERATE_RESULT") &&
      entry.details?.success &&
      entry.details?.image_url
    ) {
      const topic = entry.details.topic || "";
      map.set(topic.toLowerCase(), { url: entry.details.image_url, topic });
    }
  }
  return map;
}

export interface TimedImage {
  topic: string;
  url: string;
  time: number;
}

/** Extract all images from exec log with timestamps for temporal matching. */
export function buildTimedImageList(log: ExecStep[] | null | undefined): TimedImage[] {
  if (!log) return [];
  const images: TimedImage[] = [];
  for (const entry of log) {
    if (
      (entry.step === "IMAGE_GENERATE_FULL" || entry.step === "IMAGE_GENERATE_RESULT") &&
      entry.details?.success &&
      entry.details?.image_url
    ) {
      // Normalize timestamp: exec log timestamps may lack timezone info (naive UTC).
      // Append 'Z' if no timezone indicator present so JS parses as UTC, matching
      // DB timestamps which always include timezone offset.
      let ts = entry.timestamp || "";
      if (ts && !ts.endsWith("Z") && !ts.includes("+") && !/\d{2}:\d{2}$/.test(ts.slice(-6))) {
        ts += "Z";
      }
      images.push({
        topic: entry.details.topic || "",
        url: entry.details.image_url,
        time: ts ? new Date(ts).getTime() : 0,
      });
    }
  }
  return images;
}

/**
 * Build a scoped image map for a specific interaction by temporal proximity.
 * Only includes images generated within windowMs of the interaction timestamp.
 * Falls back to exact topic match from the full list if no temporal match.
 */
export function buildScopedImageMap(
  images: TimedImage[],
  interactionTime: string | null | undefined,
  windowMs = 90_000,
): Map<string, { url: string; topic: string }> {
  const map = new Map<string, { url: string; topic: string }>();
  if (!images.length) return map;
  if (!interactionTime) {
    // No timestamp — fall back to all images
    for (const img of images) map.set(img.topic.toLowerCase(), { url: img.url, topic: img.topic });
    return map;
  }
  const t = new Date(interactionTime).getTime();
  for (const img of images) {
    if (img.time && Math.abs(img.time - t) <= windowMs) {
      map.set(img.topic.toLowerCase(), { url: img.url, topic: img.topic });
    }
  }
  // No fallback: if no image was generated within the time window,
  // this interaction simply has no image. The old fallback found the
  // "closest" image globally, which caused every interaction to show
  // the same image when only one was generated in the session.
  return map;
}

export function stripImageBlocks(text: string): string {
  text = normalizeTags(text);
  // Paired <IMAGE>...</IMAGE>
  let clean = text.replace(/<IMAGE>[\s\S]*?<\/IMAGE>/g, "");
  // Unclosed <IMAGE> (no closing tag) — strip to end
  const idx = clean.indexOf("<IMAGE>");
  if (idx !== -1) clean = clean.slice(0, idx);
  // Orphaned tags
  clean = clean.replace(/<IMAGE>/g, "").replace(/<\/IMAGE>/g, "");
  return clean.trim();
}

export function parseSuggestions(text: string): { clean: string; suggestions: string[] } {
  text = normalizeTags(text);
  const suggestions: string[] = [];
  let clean = text;

  // Paired <SUGGESTIONS>...</SUGGESTIONS>
  const paired = /<SUGGESTIONS>([\s\S]*?)<\/SUGGESTIONS>/g;
  clean = clean.replace(paired, (_m, block: string) => {
    for (const line of block.trim().split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) suggestions.push(trimmed.slice(2).trim().replace(/^"|"$/g, ""));
      else if (trimmed && trimmed !== "<SUGGESTIONS>" && trimmed !== "</SUGGESTIONS>") suggestions.push(trimmed.replace(/^"|"$/g, ""));
    }
    return "";
  });

  // Unclosed <SUGGESTIONS> (no closing tag)
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

  // Clean up any remaining orphaned tags
  clean = clean.replace(/<SUGGESTIONS>/g, "").replace(/<\/SUGGESTIONS>/g, "");

  return { clean: clean.trim(), suggestions: suggestions.slice(0, 4) };
}

// --- Formatting helpers ---

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return (
    d.toLocaleDateString() +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

export function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return "-";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + "m " + s + "s";
}

export function subjectBadgeClass(name: string | null | undefined): string {
  if (!name) return "badge-default";
  const n = name.toLowerCase();
  if (n === "biology") return "badge-bio";
  if (n === "math" || n === "mathematics") return "badge-math";
  if (n === "english") return "badge-eng";
  if (n === "chemistry") return "badge-chem";
  if (n === "physics") return "badge-phy";
  return "badge-default";
}

export function accuracyClass(val: number | null | undefined): string {
  if (val == null) return "";
  if (val >= 70) return "accuracy-good";
  if (val >= 40) return "accuracy-ok";
  return "accuracy-bad";
}

// --- Data extraction from execution log ---

export interface LatencyPoint {
  turn: number;
  ms: number;
  tokens: number;
}

export interface LatencyData {
  tutor: LatencyPoint[];
  assess: LatencyPoint[];
}

export function extractLatencies(log: ExecStep[] | null | undefined): LatencyData {
  const tutor: LatencyPoint[] = [];
  const assess: LatencyPoint[] = [];
  if (!log) return { tutor, assess };
  let turn = 0;
  log.forEach((entry) => {
    const d = entry.details || {};
    if (entry.step === "LLM_RESPONSE" && d.latency_ms != null) {
      turn++;
      tutor.push({ turn, ms: d.latency_ms, tokens: d.tokens_used || 0 });
    }
    if (entry.step === "ASSESSMENT_LLM_RESPONSE" && d.latency_ms != null) {
      assess.push({ turn, ms: d.latency_ms, tokens: d.tokens_used || 0 });
    }
  });
  return { tutor, assess };
}

export interface AssessmentData {
  correct: number;
  incorrect: number;
  confused: number;
}

export function extractAssessments(log: ExecStep[] | null | undefined): AssessmentData {
  let correct = 0;
  let incorrect = 0;
  let confused = 0;
  if (!log) return { correct, incorrect, confused };
  log.forEach((entry) => {
    if (entry.step === "ASSESSMENT_LLM_RESPONSE" && entry.details) {
      const d = typeof entry.details === "string"
        ? (() => { try { return JSON.parse(entry.details); } catch { return {}; } })()
        : entry.details;
      const resp = d.full_response
        ? (typeof d.full_response === "string" ? (() => { try { return JSON.parse(d.full_response); } catch { return {}; } })() : d.full_response)
        : d;
      const itype = resp.interaction_type || "";
      if (itype === "student_correct" || itype === "student_understands") correct++;
      else if (itype === "student_incorrect" || itype === "student_partially_correct") incorrect++;
      if (resp.student_is_confused) confused++;
    }
  });
  return { correct, incorrect, confused };
}

export interface ImageData {
  url: string;
  topic: string;
  timestamp: string;
}

export function extractImages(log: ExecStep[] | null | undefined): ImageData[] {
  const images: ImageData[] = [];
  if (!log) return images;
  log.forEach((entry) => {
    if (
      (entry.step === "IMAGE_GENERATE_FULL" ||
        entry.step === "IMAGE_GENERATE_RESULT") &&
      entry.details
    ) {
      const d = entry.details;
      if (d.success && d.image_url) {
        images.push({
          url: d.image_url,
          topic: d.topic || "",
          timestamp: entry.timestamp || "",
        });
      }
    }
  });
  return images;
}

export interface StepTransition {
  name: string;
  timestamp: string;
}

export function extractSteps(log: ExecStep[] | null | undefined): StepTransition[] {
  const steps: StepTransition[] = [];
  if (!log) return steps;
  log.forEach((entry) => {
    if (entry.step === "STEP_TRANSITION" || entry.step === "STEP_UPDATE") {
      const d = entry.details || {};
      const name = d.to || d.to_step || d.step_name || d.new_step || "";
      if (name) steps.push({ name, timestamp: entry.timestamp || "" });
    }
  });
  return steps;
}

export interface CumToken {
  turn: number;
  tokens: number;
  type: "tutor" | "assess";
}

export function extractCumulativeTokens(log: ExecStep[] | null | undefined): CumToken[] {
  const cumTokens: CumToken[] = [];
  if (!log) return cumTokens;
  let running = 0;
  let turn = 0;
  log.forEach((entry) => {
    if (
      entry.step === "LLM_RESPONSE" &&
      entry.details &&
      entry.details.tokens_used
    ) {
      turn++;
      running += entry.details.tokens_used;
      cumTokens.push({ turn, tokens: running, type: "tutor" });
    }
    if (
      entry.step === "ASSESSMENT_LLM_RESPONSE" &&
      entry.details &&
      entry.details.tokens_used
    ) {
      running += entry.details.tokens_used;
      cumTokens.push({ turn, tokens: running, type: "assess" });
    }
  });
  return cumTokens;
}

export interface FactSummary {
  mastered: number;
  taught: number;
  notUnderstood: number;
  totalFacts: number;
}

export function summarizeFacts(interactions: InteractionItem[] | null | undefined): FactSummary {
  if (!interactions || !interactions.length)
    return { mastered: 0, taught: 0, notUnderstood: 0, totalFacts: 0 };
  const facts: Record<
    string,
    { taught: boolean; mastered: boolean; notUnderstood: boolean }
  > = {};
  interactions.forEach((ix) => {
    const key = ix.fact_text || "unknown";
    if (!key || key === "unknown") return;
    if (!facts[key])
      facts[key] = { taught: false, mastered: false, notUnderstood: false };
    const action = ix.type || "";
    // Legacy types
    if (action === "teach") facts[key].taught = true;
    if (ix.understood === true && action === "assess") facts[key].mastered = true;
    // V6 transition actions
    if (action === "advance_fact" || action === "scaffold_to_try" || action.startsWith("scaffold_teach")) facts[key].taught = true;
    if (action === "check_next" || action === "start_check") facts[key].mastered = true;
    if (action.includes("incorrect") || action === "try_reteach") facts[key].notUnderstood = true;
    if (ix.understood === false) facts[key].notUnderstood = true;
  });
  let mastered = 0;
  let taught = 0;
  let notUnderstood = 0;
  Object.values(facts).forEach((f) => {
    if (f.mastered) mastered++;
    else if (f.taught) taught++;
    if (f.notUnderstood) notUnderstood++;
  });
  return { mastered, taught, notUnderstood, totalFacts: Object.keys(facts).length };
}
