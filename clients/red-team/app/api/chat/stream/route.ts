import { NextRequest } from "next/server";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000";

// Allow up to 5 minutes for LLM + image generation
export const maxDuration = 300;

// Use Node.js runtime for proper streaming support
export const runtime = "nodejs";

// Disable static optimization — this is a dynamic streaming endpoint
export const dynamic = "force-dynamic";

/**
 * SSE proxy using Node.js http/https module instead of fetch.
 * This guarantees chunk-by-chunk streaming — Node.js fetch (undici) can buffer
 * the response body, causing all SSE events to arrive at once on the client.
 * Supports both http:// (Docker internal) and https:// (dev with self-signed certs).
 */
export async function POST(req: NextRequest) {
  const cookie = req.headers.get("cookie") || "";
  const body = await req.text();

  const url = new URL(`${BACKEND}/api/chat/stream`);
  const isHTTPS = url.protocol === "https:";
  const transport = isHTTPS ? https : http;

  return new Promise<Response>((resolve) => {
    const nodeReq = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHTTPS ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        ...(isHTTPS ? { rejectUnauthorized: false } : {}),
        timeout: 300_000,
      },
      (nodeRes) => {
        const status = nodeRes.statusCode || 502;

        // Non-200: buffer and return as-is
        if (status !== 200) {
          let data = "";
          nodeRes.on("data", (chunk: Buffer) => { data += chunk.toString(); });
          nodeRes.on("end", () => {
            resolve(
              new Response(data, {
                status,
                headers: { "content-type": nodeRes.headers["content-type"] || "application/json" },
              })
            );
          });
          return;
        }

        // 200: pipe SSE chunks through a ReadableStream in real-time
        const stream = new ReadableStream({
          start(controller) {
            nodeRes.on("data", (chunk: Buffer) => {
              controller.enqueue(chunk);
            });
            nodeRes.on("end", () => {
              controller.close();
            });
            nodeRes.on("error", (err) => {
              controller.error(err);
            });
          },
          cancel() {
            nodeRes.destroy();
          },
        });

        resolve(
          new Response(stream, {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache, no-transform",
              "x-accel-buffering": "no",
              connection: "keep-alive",
            },
          })
        );
      }
    );

    nodeReq.on("error", (err) => {
      resolve(
        new Response(
          `data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`,
          { status: 502, headers: { "content-type": "text/event-stream" } }
        )
      );
    });

    nodeReq.on("timeout", () => {
      nodeReq.destroy();
      resolve(
        new Response(
          `data: ${JSON.stringify({ type: "error", content: "Upstream timeout" })}\n\n`,
          { status: 504, headers: { "content-type": "text/event-stream" } }
        )
      );
    });

    nodeReq.write(body);
    nodeReq.end();
  });
}
