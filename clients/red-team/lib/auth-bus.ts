// Private auth-event bus. Replaces a previous `window.dispatchEvent(new Event("auth:expired"))`
// pattern that any same-origin script (XSS, browser extension) could trigger to forcibly
// log the user out. This module-scoped emitter is only reachable from code that imports it.
//
// Also broadcasts auth events across tabs via BroadcastChannel so a 401 in one tab
// proactively logs out other tabs (rather than each tab waiting for its own next fetch).

type AuthListener = () => void;

const listeners = new Set<AuthListener>();

let bc: BroadcastChannel | null = null;
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  bc = new BroadcastChannel("zingbee-auth");
  bc.onmessage = (e: MessageEvent) => {
    if (e.data === "expired") {
      listeners.forEach((fn) => fn());
    }
  };
}

export function onAuthExpired(fn: AuthListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitAuthExpired(): void {
  listeners.forEach((fn) => fn());
  bc?.postMessage("expired");
}
