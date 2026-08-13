"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const STORAGE_KEY = "tutors.autoReadTts"

function stripMarkdown(md: string): string {
  return md
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
    .trim()
}

export function useAutoReadTts(voiceId: string = "Sal") {
  // Default to ON so the greeting is spoken the first time a student arrives.
  // Users can still turn it off, and that choice is persisted.
  const [enabled, setEnabled] = useState<boolean>(true)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  // Load persisted state — only override the default if the user explicitly
  // turned it off in a prior session.
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      if (v === "false") setEnabled(false)
      else if (v === "true") setEnabled(true)
    } catch {}
  }, [])

  const persist = (v: boolean) => {
    try { localStorage.setItem(STORAGE_KEY, v ? "true" : "false") } catch {}
  }

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
      audioRef.current = null
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  const speak = useCallback(async (text: string) => {
    const cleanText = stripMarkdown(text)
    if (!cleanText) return
    cleanup()
    try {
      // Hit the API directly (not via the Next.js proxy) so the TTS fetch runs on a
      // separate connection from the SSE chat stream that stays open during image gen.
      const apiBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000/api").replace(/\/api\/?$/, "")
      const resp = await fetch(`${apiBase}/api/voice/tts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText, voice_id: voiceId, language: "en" }),
      })
      if (!resp.ok) return
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = cleanup
      audio.onerror = cleanup
      await audio.play()
    } catch {
      cleanup()
    }
  }, [voiceId, cleanup])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      persist(next)
      if (!next) cleanup() // turning off: stop any current playback
      return next
    })
  }, [cleanup])

  // Stop playback on unmount
  useEffect(() => cleanup, [cleanup])

  return { enabled, toggle, speak }
}
