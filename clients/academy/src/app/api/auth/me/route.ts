import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.API_INTERNAL_URL || (process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000/api").replace(/\/api\/?$/, "");

export async function GET(req: NextRequest) {
  const resp = await fetch(`${BACKEND}/api/academy/me`, {
    headers: {
      cookie: req.headers.get("cookie") || "",
    },
  });

  const data = await resp.text();
  return new NextResponse(data, {
    status: resp.status,
    headers: { "content-type": "application/json" },
  });
}
