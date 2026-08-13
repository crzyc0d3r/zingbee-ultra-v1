"use client";

import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Timer store: keeps time in a ref, notifies subscribers on each tick.
// Only components that subscribe (via useTimerDisplay) will re-render on tick.
// The parent page re-renders only on start/stop/reset (running flag).
// ---------------------------------------------------------------------------

function createTimerStore() {
  let elapsedMs = 0;
  let running = false;
  let startTime = 0;
  let interval: NodeJS.Timeout | null = null;
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((l) => l());
  }

  function tick() {
    elapsedMs = Date.now() - startTime;
    notify();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return elapsedMs;
    },
    start(currentElapsed: number) {
      startTime = Date.now() - currentElapsed;
      running = true;
      if (interval) clearInterval(interval);
      interval = setInterval(tick, 50);
      notify();
    },
    stop() {
      running = false;
      if (interval) { clearInterval(interval); interval = null; }
      notify();
    },
    reset() {
      running = false;
      elapsedMs = 0;
      startTime = 0;
      if (interval) { clearInterval(interval); interval = null; }
      notify();
    },
    isRunning() { return running; },
  };
}

const timerStore = createTimerStore();

/** Read the fast-ticking display values. Use this ONLY in the timer display component. */
export function useTimerDisplay() {
  const elapsedMs = useSyncExternalStore(
    timerStore.subscribe,
    timerStore.getSnapshot,
    timerStore.getSnapshot,
  );

  const mins = Math.floor(elapsedMs / 60000).toString().padStart(2, "0");
  const secs = Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, "0");
  const ms = (elapsedMs % 1000).toString().padStart(3, "0");

  return {
    formatted: `${mins}:${secs}`,
    formattedMs: `.${ms}`,
  };
}

/** Hook for the page: only exposes control functions and the running flag. */
export function useSessionTimer() {
  const [running, setRunning] = useState(false);

  const start = useCallback(() => {
    timerStore.start(timerStore.getSnapshot());
    setRunning(true);
  }, []);

  const stop = useCallback(() => {
    timerStore.stop();
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    timerStore.reset();
    setRunning(false);
  }, []);

  return { running, start, stop, reset };
}
