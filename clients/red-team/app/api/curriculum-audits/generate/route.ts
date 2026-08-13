import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000";

// Allow up to 10 minutes for Claude Opus audit generation
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const cookie = req.headers.get("cookie") || "";

  try {
    const res = await fetch(`${BACKEND}/api/curriculum-audits/generate`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      signal: AbortSignal.timeout(600_000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Proxy error";
    return NextResponse.json(
      { error: `Proxy to backend failed: ${msg}` },
      { status: 502 },
    );
  }
}
