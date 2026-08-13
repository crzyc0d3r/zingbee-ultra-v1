"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const WARN_AFTER_MS_DEFAULT = 9 * 60 * 1000
const END_AFTER_MS_DEFAULT = 10 * 60 * 1000

type Options = {
  studentId: string | null | undefined
  enabled: boolean
  warnAfterMs?: number
  endAfterMs?: number
  onEnd: () => void
  externalActivityKey?: number | string
}

export function useAfkSessionEnd({
  studentId,
  enabled,
  warnAfterMs = WARN_AFTER_MS_DEFAULT,
  endAfterMs = END_AFTER_MS_DEFAULT,
  onEnd,
  externalActivityKey,
}: Options) {
  const [warning, setWarning] = useState(false)
  const lastActivityRef = useRef<number>(Date.now())
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  const sendBeacon = useCallback(() => {
    if (!studentId) return
    try {
      navigator.sendBeacon?.(`/api/end-session-beacon/${studentId}`)
    } catch {
      // sendBeacon throws on quota / disabled — best-effort only.
    }
  }, [studentId])

  const clearTimers = () => {
    if (warnTimerRef.current) {
      clearTimeout(warnTimerRef.current)
      warnTimerRef.current = null
    }
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current)
      endTimerRef.current = null
    }
  }

  const armTimers = useCallback(() => {
    clearTimers()
    warnTimerRef.current = setTimeout(() => setWarning(true), warnAfterMs)
    endTimerRef.current = setTimeout(() => {
      setWarning(false)
      sendBeacon()
      onEndRef.current()
    }, endAfterMs)
  }, [warnAfterMs, endAfterMs, sendBeacon])

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    setWarning(false)
    armTimers()
  }, [armTimers])

  useEffect(() => {
    if (!enabled) {
      clearTimers()
      setWarning(false)
      return
    }
    armTimers()

    const onUserInput = () => recordActivity()
    const onVisibilityVisible = () => {
      // Returning to the tab counts as activity. We don't beacon on
      // visibility=hidden — that fires on tab switches too, and we don't
      // want a 30-second peek at email to nuke the session. The 10-min
      // sweeper handles a tab that never comes back.
      if (document.visibilityState === "visible") recordActivity()
    }
    // pagehide is the reliable "page is going away" signal (fires for
    // navigation, tab close, browser close — including mobile, where
    // beforeunload often doesn't). Beacon here so the server can finalize
    // immediately instead of waiting up to a minute for the sweeper.
    const onPageHide = () => sendBeacon()

    window.addEventListener("keydown", onUserInput)
    window.addEventListener("mousedown", onUserInput)
    window.addEventListener("pointerdown", onUserInput)
    window.addEventListener("touchstart", onUserInput, { passive: true })
    window.addEventListener("focus", onUserInput)
    document.addEventListener("visibilitychange", onVisibilityVisible)
    window.addEventListener("pagehide", onPageHide)

    return () => {
      clearTimers()
      window.removeEventListener("keydown", onUserInput)
      window.removeEventListener("mousedown", onUserInput)
      window.removeEventListener("pointerdown", onUserInput)
      window.removeEventListener("touchstart", onUserInput)
      window.removeEventListener("focus", onUserInput)
      document.removeEventListener("visibilitychange", onVisibilityVisible)
      window.removeEventListener("pagehide", onPageHide)
    }
  }, [enabled, armTimers, recordActivity, sendBeacon])

  // Reset on outside activity signals (e.g. assistant message arriving).
  useEffect(() => {
    if (!enabled) return
    recordActivity()
  }, [externalActivityKey, enabled, recordActivity])

  const dismissWarning = useCallback(() => {
    recordActivity()
  }, [recordActivity])

  return { warning, dismissWarning }
}
