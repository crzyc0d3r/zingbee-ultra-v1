import { NextRequest } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000";

// Allow up to 10 minutes for Claude Opus insight generation
export const maxDuration = 600;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cookie = req.headers.get("cookie") || "";

  try {
    const res = await fetch(
      `${BACKEND}/api/curriculum-audits/${id}/generate-insights`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        signal: AbortSignal.timeout(600_000),
      },
    );

    // Stream the response through to keep heartbeat pings alive.
    // Do NOT set transfer-encoding: chunked — it is forbidden in HTTP/2
    // (which Caddy uses for HTTPS) and causes connections to drop.
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
        "cache-control": "no-cache, no-store, must-revalidate",
        "x-accel-buffering": "no",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Proxy error";
    return Response.json(
      { error: `Proxy to backend failed: ${msg}` },
      { status: 502 },
    );
  }
}
