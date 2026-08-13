"use client";

import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Voice mode — dead simple turn-based:
 *
 *   LISTENING → user stops → THINKING → full response ready → SPEAKING → done → LISTENING
 *
 * No sentence streaming. No token callbacks. Wait for full response, TTS it, play it.
 */

const STRIP_TAGS = ["EDUCATIONAL_IMAGE", "SUGGESTIONS", "IMAGE"];

function cleanForTts(text: string): string {
  let r = text;
  for (const tag of STRIP_TAGS) {
    r = r.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "gi"), "");
    r = r.replace(new RegExp(`</${tag}>`, "gi"), "");
  }
  return r
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const SUBJECT_VOICES: Record<string, string> = {
  Physics: "Sal", Biology: "Ara", Chemistry: "Eve", Math: "Rex", English: "Leo",
};

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

interface UseVoiceModeOptions {
  sendMessage: (studentId: string, text: string, subject: string) => Promise<void>;
  setOnToken: (cb: ((token: string) => void) | null) => void;
  setOnDone: (cb: (() => void) | null) => void;
}

export interface UseVoiceModeReturn {
  voiceState: VoiceState;
  isVoiceModeActive: boolean;
  startVoiceMode: (opts: { studentId: string; subject: string; language?: string }) => void;
  stopVoiceMode: () => void;
  audioLevel: number;
  interimTranscript: string;
  error: string | null;
  isSupported: boolean;
}

export function useVoiceMode({ sendMessage, setOnToken, setOnDone }: UseVoiceModeOptions): UseVoiceModeReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const phase = useRef<VoiceState>("idle");
  const activeRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef(0);
  const currentAudioRef = useRef<AudioBufferSourceNode | null>(null);
  const contextRef = useRef({ studentId: "", subject: "", language: "en", voiceId: "Sal" });
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  // Accumulate ALL tokens, TTS the full response on "done"
  const fullResponseRef = useRef("");

  const go = useCallback((s: VoiceState) => { phase.current = s; setVoiceState(s); }, []);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SR);
  }, []);

  useEffect(() => () => {
    activeRef.current = false;
    killRecognition();
    stopAudio();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
  }, []);

  function killRecognition() {
    const r = recognitionRef.current;
    if (r) {
      try { r.onend = null; r.onerror = null; r.onresult = null; } catch {}
      try { r.abort(); } catch {}
      recognitionRef.current = null;
    }
  }

  function stopAudio() {
    if (currentAudioRef.current) {
      try { currentAudioRef.current.onended = null; currentAudioRef.current.stop(); } catch {}
      currentAudioRef.current = null;
    }
  }

  // ---- Mic level (throttled ~12fps) ----
  const startMicMonitor = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let last = 0;
    const tick = () => {
      if (!activeRef.current) return;
      const now = performance.now();
      if (now - last > 80) {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        setAudioLevel(sum / buf.length / 255);
        last = now;
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  // ---- Listen for one utterance ----
  const listenOnce = useCallback(() => {
    if (!activeRef.current) return;
    killRecognition();

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = contextRef.current.language || "en-US";

    rec.onresult = (e: any) => {
      if (!activeRef.current) return;
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (interim) setInterimTranscript(interim);
      if (final.trim()) {
        killRecognition();
        setInterimTranscript("");
        fullResponseRef.current = "";
        go("thinking");
        const { studentId, subject } = contextRef.current;
        sendMessageRef.current(studentId, final.trim(), subject);
      }
    };

    rec.onerror = (e: any) => {
      if (!activeRef.current || e.error === "aborted") return;
      if (e.error === "no-speech") {
        // Retry after a beat
        setTimeout(() => { if (activeRef.current && phase.current === "listening") listenOnce(); }, 500);
        return;
      }
      setError(`Mic error: ${e.error}`);
    };

    rec.onend = () => {
      // Restart if still listening (no final result came)
      if (activeRef.current && phase.current === "listening") {
        setTimeout(() => { if (activeRef.current && phase.current === "listening") listenOnce(); }, 300);
      }
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch (e) { console.warn("[Voice] start failed:", e); }
    go("listening");
  }, [go]);

  // ---- Play full response via TTS ----
  const playTts = useCallback(async (text: string) => {
    if (!activeRef.current || !text.trim()) {
      // Nothing to say — go back to listening
      go("listening");
      listenOnce();
      return;
    }

    go("speaking");

    try {
      const resp = await fetch("/api/voice/tts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.slice(0, 2000), // cap length for TTS
          voice_id: contextRef.current.voiceId,
          language: contextRef.current.language,
        }),
      });

      if (!resp.ok || !activeRef.current) {
        console.warn("[Voice] TTS fetch failed:", resp.status);
        go("listening");
        listenOnce();
        return;
      }

      const arrayBuffer = await resp.arrayBuffer();
      if (!activeRef.current || arrayBuffer.byteLength === 0) {
        go("listening");
        listenOnce();
        return;
      }

      const ctx = audioCtxRef.current || new AudioContext();
      if (!audioCtxRef.current) audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      if (!activeRef.current) { go("listening"); listenOnce(); return; }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      currentAudioRef.current = source;

      source.onended = () => {
        currentAudioRef.current = null;
        if (!activeRef.current) return;
        go("listening");
        listenOnce();
      };

      source.start();
    } catch (err) {
      console.error("[Voice] TTS error:", err);
      if (activeRef.current) {
        go("listening");
        listenOnce();
      }
    }
  }, [go, listenOnce]);

  // ---- SSE "done" handler: grab full response from chat messages, TTS it ----
  const handleDone = useCallback(() => {
    if (!activeRef.current || phase.current !== "thinking") return;
    // Get the last assistant message from the DOM — it has the full cleaned text
    // We accumulated raw tokens, clean them now
    const cleaned = cleanForTts(fullResponseRef.current);
    playTts(cleaned);
  }, [playTts]);

  // ---- Token handler: just accumulate, nothing else ----
  const handleToken = useCallback((token: string) => {
    fullResponseRef.current += token;
  }, []);

  // Register callbacks
  useEffect(() => {
    setOnToken(handleToken);
    setOnDone(handleDone);
    return () => { setOnToken(null); setOnDone(null); };
  }, [handleToken, handleDone, setOnToken, setOnDone]);

  // ---- Start ----
  const startVoiceMode = useCallback(async (opts: { studentId: string; subject: string; language?: string }) => {
    setError(null);
    activeRef.current = true;
    fullResponseRef.current = "";
    const voiceId = SUBJECT_VOICES[opts.subject] || "Sal";
    contextRef.current = { studentId: opts.studentId, subject: opts.subject, language: opts.language || "en", voiceId };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      micStreamRef.current = stream;
      startMicMonitor(stream);
    } catch {
      setError("Microphone access denied.");
      activeRef.current = false;
      return;
    }

    listenOnce();
  }, [listenOnce, startMicMonitor]);

  // ---- Stop ----
  const stopVoiceMode = useCallback(() => {
    activeRef.current = false;
    killRecognition();
    stopAudio();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    fullResponseRef.current = "";
    go("idle");
    setInterimTranscript("");
    setAudioLevel(0);
    setError(null);
  }, [go]);

  return {
    voiceState,
    isVoiceModeActive: voiceState !== "idle",
    startVoiceMode, stopVoiceMode,
    audioLevel, interimTranscript, error, isSupported,
  };
}
