import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.API_INTERNAL_URL || (process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000/api").replace(/\/api\/?$/, "");

export async function POST(req: NextRequest) {
  const body = await req.text();

  const resp = await fetch(`${BACKEND}/api/academy/student-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const data = await resp.text();
  const res = new NextResponse(data, {
    status: resp.status,
    headers: { "content-type": "application/json" },
  });

  // Forward the Set-Cookie header so the session cookie is set on THIS origin (port 3001)
  const setCookie = resp.headers.get("set-cookie");
  if (setCookie) {
    res.headers.set("set-cookie", setCookie);
  }

  return res;
}
