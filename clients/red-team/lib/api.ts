import { emitAuthExpired } from "./auth-bus";

export async function apiFetch<T = any>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (res.status === 401) {
    emitAuthExpired();
    throw new Error("auth");
  }

  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
      if (body.detail) msg = body.detail;
    } catch {}
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}
