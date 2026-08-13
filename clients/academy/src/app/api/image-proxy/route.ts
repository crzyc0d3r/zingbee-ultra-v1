import { NextRequest, NextResponse } from "next/server"

// SSRF guard: only proxy images from the same hosts the tutor pipeline writes
// to. Mirrors the allowlist in api/web_ui.py:image_proxy.
const ALLOWED_HOSTS = new Set(["storage.googleapis.com", "imgen.x.ai"])

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 })
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "bad protocol" }, { status: 400 })
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 400 })
  }

  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) {
    return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 })
  }
  const contentType = res.headers.get("content-type") || "image/jpeg"
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "non-image upstream" }, { status: 415 })
  }
  const buf = await res.arrayBuffer()
  return new NextResponse(buf, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    },
  })
}
