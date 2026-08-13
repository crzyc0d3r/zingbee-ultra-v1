import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.API_INTERNAL_URL || (process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000/api").replace(/\/api\/?$/, "");

export async function POST(req: NextRequest) {
  const resp = await fetch(`${BACKEND}/api/logout`, {
    method: "POST",
    headers: {
      cookie: req.headers.get("cookie") || "",
    },
  });

  const data = await resp.text();
  const res = new NextResponse(data, {
    status: resp.status,
    headers: { "content-type": "application/json" },
  });

  // Forward the Set-Cookie header (which deletes the cookie)
  const setCookie = resp.headers.get("set-cookie");
  if (setCookie) {
    res.headers.set("set-cookie", setCookie);
  }

  return res;
}
