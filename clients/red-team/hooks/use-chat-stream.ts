"use client";

import { useState, useRef, useCallback } from "react";
import type { ChatMessage, ExecStep } from "@/lib/types";

// Keep in sync with clients/academy/src/hooks/use-chat-stream.ts VocabTerm.
export interface VocabTerm {
  term: string;
  definition: string;
  fact_id: string;
  status: "current" | "taught" | "mastered";
}

interface KnowledgeStats {
  total_facts: number;
  facts_taught: number;
  facts_assessed: number;
  facts_mastered: number;
  capsule_switched?: boolean;
  capsule_name?: string;
  vocab_bank?: VocabTerm[];
  definitions_hidden?: boolean;
}

interface ChatStreamState {
  messages: ChatMessage[];
  execLog: ExecStep[];
  streaming: boolean;
  waitingForImage: boolean;
  thinkingLabel: string | null;
  factsState: { taught: number; assessed: number; mastered: number };
  totalFacts: number;
  tokenCount: number;
  questionsAsked: number;
  correctAnswers: number;
  suggestions: string[];
  currentPhase: number;
  currentStep: string;
  sessionActive: boolean;
  endSessionData: any | null;
  vocabBank: VocabTerm[];
  definitionsHidden: boolean;
}

interface UseChatStreamReturn extends ChatStreamState {
  fetchGreeting: (studentId: string, subject: string, tutorId?: string | null) => Promise<void>;
  sendMessage: (studentId: string, text: string, subject: string) => Promise<void>;
  resetState: () => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setExecLog: React.Dispatch<React.SetStateAction<ExecStep[]>>;
  setFactsState: React.Dispatch<React.SetStateAction<{ taught: number; assessed: number; mastered: number }>>;
  setTotalFacts: React.Dispatch<React.SetStateAction<number>>;
  setQuestionsAsked: React.Dispatch<React.SetStateAction<number>>;
  setCorrectAnswers: React.Dispatch<React.SetStateAction<number>>;
  setTokenCount: React.Dispatch<React.SetStateAction<number>>;
  setEndSessionData: React.Dispatch<React.SetStateAction<any>>;
  setSuggestions: React.Dispatch<React.SetStateAction<string[]>>;
}

const THINKING_WORDS = [
  "Pondering", "Contemplating", "Analyzing", "Reasoning", "Synthesizing",
  "Connecting dots", "Processing", "Evaluating", "Formulating", "Reflecting",
];

// Tags that should be stripped from displayed text (content is for server-side processing only)
const STRIP_TAGS = ["EDUCATIONAL_IMAGE", "SUGGESTIONS", "IMAGE"];

/** Remove XML-style tag blocks from streamed text. Handles both closed and unclosed tags. */
function stripTagBlocks(text: string): string {
  let result = text;
  for (const tag of STRIP_TAGS) {
    // Remove closed blocks: <TAG>...</TAG>
    result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "gi"), "");
    // Remove unclosed opening tag and everything after it (still streaming)
    result = result.replace(new RegExp(`<${tag}>[\\s\\S]*$`, "gi"), "");
    // Remove orphaned closing tags
    result = result.replace(new RegExp(`</${tag}>`, "gi"), "");
  }
  return result.trimEnd();
}


export function useChatStream(): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [execLog, setExecLog] = useState<ExecStep[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [waitingForImage, setWaitingForImage] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState<string | null>(null);
  const [factsState, setFactsState] = useState({ taught: 0, assessed: 0, mastered: 0 });
  const [totalFacts, setTotalFacts] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [questionsAsked, setQuestionsAsked] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [currentPhase, setCurrentPhase] = useState(1);
  const [currentStep, setCurrentStep] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [endSessionData, setEndSessionData] = useState<any>(null);
  const [vocabBank, setVocabBank] = useState<VocabTerm[]>([]);
  const [definitionsHidden, setDefinitionsHidden] = useState(false);

  const thinkingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Callback for toast notifications — set by the page component
  const toastRef = useRef<((msg: string, type: string) => void) | null>(null);
  // Ref to track the streaming assistant message index for token accumulation
  const streamingMsgIdxRef = useRef<number>(-1);
  // Raw accumulated text (before tag stripping) so we can strip correctly on each token
  const rawContentRef = useRef<string>("");

  const startThinking = useCallback(() => {
    let idx = 0;
    setThinkingLabel(THINKING_WORDS[0]);
    thinkingIntervalRef.current = setInterval(() => {
      idx = (idx + 1) % THINKING_WORDS.length;
      setThinkingLabel(THINKING_WORDS[idx]);
    }, 2000);
  }, []);

  const stopThinking = useCallback(() => {
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current);
      thinkingIntervalRef.current = null;
    }
    setThinkingLabel(null);
  }, []);

  // Safety net: auto-reset streaming after 120s to prevent permanent stuck state
  const startStreamingTimeout = useCallback(() => {
    if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current);
    streamingTimeoutRef.current = setTimeout(() => {
      console.warn("[SSE] Streaming timeout — auto-resetting after 120s");
      setStreaming(false);
      setThinkingLabel(null);
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current);
        thinkingIntervalRef.current = null;
      }
    }, 120_000);
  }, []);

  const clearStreamingTimeout = useCallback(() => {
    if (streamingTimeoutRef.current) {
      clearTimeout(streamingTimeoutRef.current);
      streamingTimeoutRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    setMessages([]);
    setExecLog([]);
    setStreaming(false);
    stopThinking();
    clearStreamingTimeout();
    setFactsState({ taught: 0, assessed: 0, mastered: 0 });
    setTotalFacts(0);
    setTokenCount(0);
    setQuestionsAsked(0);
    setCorrectAnswers(0);
    setSuggestions([]);
    setCurrentPhase(1);
    setCurrentStep("");
    setSessionActive(false);
    setEndSessionData(null);
    setVocabBank([]);
    setDefinitionsHidden(false);
    streamingMsgIdxRef.current = -1;
    rawContentRef.current = "";
  }, [stopThinking, clearStreamingTimeout]);

  const applyKnowledge = useCallback((knowledge: KnowledgeStats | null) => {
    if (!knowledge) return;
    if (knowledge.total_facts > 0) {
      setTotalFacts(knowledge.total_facts);
      setFactsState({
        taught: knowledge.facts_taught || 0,
        assessed: knowledge.facts_assessed || 0,
        mastered: knowledge.facts_mastered || 0,
      });
    }
    if (knowledge.vocab_bank !== undefined) setVocabBank(knowledge.vocab_bank);
    if (knowledge.definitions_hidden !== undefined) setDefinitionsHidden(knowledge.definitions_hidden);
  }, []);

  // ----------------------------------------------------------------
  // Shared SSE reader — used by both greeting and chat
  // Handles: token (stream text), done (metadata), image (deferred)
  // ----------------------------------------------------------------
  const handleSSE = useCallback(
    async (resp: Response, startTime: number) => {
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstToken = true;
      let firstByteMs: number | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
        }
        if (done && !buffer.trim()) break;

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        if (done && buffer.trim()) {
          lines.push(buffer);
          buffer = "";
        }

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload_str = line.slice(6).trim();
          if (!payload_str || payload_str === "[DONE]") continue;

          let payload: any;
          try {
            payload = JSON.parse(payload_str);
          } catch {
            continue;
          }

          if (payload.type === "thinking") {
            // Thinking content — cycle the label
          } else if (payload.type === "token" && payload.content) {
            // Accumulate raw text, display stripped version
            rawContentRef.current += payload.content;
            const displayText = stripTagBlocks(rawContentRef.current);

            if (firstToken) {
              firstToken = false;
              firstByteMs = Date.now() - startTime;
              console.log(`[SSE timing] First byte: ${firstByteMs}ms`);
              stopThinking();
              setMessages((prev) => {
                const newMsgs = [
                  ...prev,
                  { role: "assistant" as const, content: "", imageLoading: true, showFeedback: false },
                  { role: "assistant" as const, content: displayText, showFeedback: true },
                ];
                streamingMsgIdxRef.current = newMsgs.length - 1;
                return newMsgs;
              });
            } else {
              // Update the streaming assistant message with stripped content
              setMessages((prev) => {
                const idx = streamingMsgIdxRef.current;
                if (idx < 0 || idx >= prev.length) return prev;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], content: displayText };
                return updated;
              });
            }
          } else if (payload.type === "status") {
            // Status updates — ignore
          } else if (payload.type === "error") {
            stopThinking();
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "Sorry, I had trouble responding. Please try again!", showFeedback: false },
            ]);
            setExecLog((prev) => [
              ...prev,
              { step: "ERROR", details: { error: payload.content || payload.message }, agent: "System" },
            ]);
          } else if (payload.type === "image") {
            // Image arrived — unlock UI and replace loading placeholder
            setWaitingForImage(false);
            const imgDoneMs = Date.now() - startTime;
            console.log(`[SSE timing] Image done: ${imgDoneMs}ms, url=${payload.image_url ? 'yes' : 'no'}`);
            if (payload.image_url) {
              setMessages((prev) => {
                const imgIdx = prev.findIndex((m) => m.imageLoading);
                if (imgIdx < 0) return prev;
                const updated = [...prev];
                updated[imgIdx] = { ...updated[imgIdx], imageUrl: payload.image_url, imageLoading: false };
                // Set imageDoneMs on the text message (the one right after the image placeholder)
                const textIdx = imgIdx + 1;
                if (textIdx < updated.length && updated[textIdx].role === "assistant") {
                  updated[textIdx] = { ...updated[textIdx], imageDoneMs: imgDoneMs };
                }
                return updated;
              });
            }
            // Append image generation exec logs
            if (payload.execution_log) {
              setExecLog((prev) => [
                ...prev,
                ...payload.execution_log.map((step: any) => ({
                  step: step.step,
                  details: step.details || {},
                  agent: step.agent,
                  timestamp: step.timestamp,
                })),
              ]);
            }
          } else if (payload.type === "done") {
            clearStreamingTimeout();
            stopThinking();
            setStreaming(false);
            // Check if an image is still loading — keep UI locked until it arrives
            setMessages((prev) => {
              const hasImageLoading = prev.some((m) => m.imageLoading);
              setWaitingForImage(hasImageLoading);
              return prev;
            });
            const data = payload.data;

            // Finalize the streamed message with timing stats
            // Capture ref value NOW — React batches setMessages callbacks,
            // so reading the ref inside the callback would see -1 (reset below).
            const textDoneMs = Date.now() - startTime;
            const doneIdx = streamingMsgIdxRef.current;
            console.log(`[SSE timing] Text done: ${textDoneMs}ms, firstByteMs=${firstByteMs}ms, idx=${doneIdx}`);
            streamingMsgIdxRef.current = -1;
            rawContentRef.current = "";
            setMessages((prev) => {
              if (doneIdx >= 0 && doneIdx < prev.length) {
                const updated = [...prev];
                updated[doneIdx] = { ...updated[doneIdx], latencyMs: textDoneMs, firstByteMs, textDoneMs };
                return updated;
              }
              return prev;
            });

            // Update stats
            setTokenCount(data.total_tokens || 0);
            setCorrectAnswers(data.stats?.correct || 0);
            setQuestionsAsked(data.stats?.questions || 0);
            applyKnowledge(data.knowledge);

            // Add exec log entries
            if (data.execution_log) {
              setExecLog((prev) => [
                ...prev,
                ...data.execution_log.map((step: any) => ({
                  step: step.step,
                  details: step.details || {},
                  agent: step.agent,
                  timestamp: step.timestamp,
                })),
              ]);
            }

            // Show suggestions
            setSuggestions(data.suggestions || []);

            // Apply student summary (greeting sends this)
            if (data.student_summary) {
              if (data.student_summary.phase) setCurrentPhase(data.student_summary.phase);
              if (data.student_summary.current_step) setCurrentStep(data.student_summary.current_step);
            }

            // Track current step from knowledge stats
            if (data.knowledge?.current_step) {
              setCurrentStep(data.knowledge.current_step);
            }

            // Handle capsule switch toast
            if (data.knowledge?.capsule_switched && toastRef.current) {
              toastRef.current(`Capsule Complete! Starting: ${data.knowledge.capsule_name}`, "success");
            }

            // Handle should_end_session
            if (data.should_end_session) {
              if (toastRef.current) toastRef.current("Session ending...", "info");
              setEndSessionData({ should_end: true, ...data });
            }
          }
        }
        if (done) break;
      }

      // Clean up any remaining image loading placeholders (no image event arrived)
      setMessages((prev) => {
        const loadingIdx = prev.findIndex((m) => m.imageLoading && !m.imageUrl);
        if (loadingIdx < 0) return prev;
        // Remove the placeholder entirely
        return prev.filter((_, i) => i !== loadingIdx);
      });
    },
    [stopThinking, clearStreamingTimeout, applyKnowledge]
  );

  // ----------------------------------------------------------------
  // Greeting: POST /api/chat/stream with greeting=true
  // Uses the same SSE protocol as chat
  // ----------------------------------------------------------------
  const fetchGreeting = useCallback(
    async (studentId: string, subject: string, tutorId?: string | null) => {
      setStreaming(true);
      startThinking();
      startStreamingTimeout();
      setSessionActive(true);

      setExecLog((prev) => [
        ...prev,
        { step: "SESSION_START", details: { info: "Initializing session..." }, agent: "SessionManager" },
      ]);

      try {
        const _start = Date.now();
        const resp = await fetch("/api/chat/stream", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: studentId, message: "", subject, greeting: true, tutor_id: tutorId || null }),
        });

        if (resp.status === 401) {
          stopThinking();
          setStreaming(false);
          window.location.href = "/";
          return;
        }

        if (!resp.ok || !resp.body) {
          stopThinking();
          setStreaming(false);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Hi! There was an error connecting, but let's try to learn together!", showFeedback: false },
          ]);
          return;
        }

        await handleSSE(resp, _start);
      } catch (err: any) {
        stopThinking();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Hi! There was an error connecting, but let's try to learn together!", showFeedback: false },
        ]);
        setExecLog((prev) => [
          ...prev,
          { step: "ERROR", details: { error: err.message }, agent: "System" },
        ]);
      } finally {
        clearStreamingTimeout();
        stopThinking();
        setStreaming(false);
      }
    },
    [startThinking, stopThinking, startStreamingTimeout, clearStreamingTimeout, handleSSE]
  );

  // ----------------------------------------------------------------
  // Send message: POST /api/chat/stream (SSE)
  // ----------------------------------------------------------------
  const sendMessage = useCallback(
    async (studentId: string, text: string, subject: string) => {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, showFeedback: false },
      ]);
      setSuggestions([]);
      setStreaming(true);
      startThinking();
      startStreamingTimeout();

      try {
        const _chatStart = Date.now();
        const resp = await fetch("/api/chat/stream", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: studentId, message: text }),
        });

        if (resp.status === 401) {
          stopThinking();
          setStreaming(false);
          window.location.href = "/";
          return;
        }

        if (!resp.ok || !resp.body) {
          stopThinking();
          setStreaming(false);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Sorry, I had trouble responding. Please try again!", showFeedback: false },
          ]);
          return;
        }

        await handleSSE(resp, _chatStart);
      } catch (err: any) {
        stopThinking();
        if (err.name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Sorry, I had trouble responding. Please try again!", showFeedback: false },
          ]);
          setExecLog((prev) => [
            ...prev,
            { step: "ERROR", details: { error: err.message }, agent: "System" },
          ]);
        }
      } finally {
        clearStreamingTimeout();
        stopThinking();
        setStreaming(false);
      }
    },
    [startThinking, stopThinking, startStreamingTimeout, clearStreamingTimeout, handleSSE]
  );

  return {
    messages, execLog, streaming, waitingForImage, thinkingLabel, factsState, totalFacts,
    tokenCount, questionsAsked, correctAnswers, suggestions, currentPhase,
    currentStep, sessionActive, endSessionData, vocabBank, definitionsHidden,
    fetchGreeting, sendMessage, resetState,
    setMessages, setExecLog, setFactsState, setTotalFacts,
    setQuestionsAsked, setCorrectAnswers, setTokenCount, setEndSessionData, setSuggestions,
  };
}
