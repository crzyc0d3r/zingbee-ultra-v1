import type { NextConfig } from "next";
import path from "path";

// Hard-fail the build if NEXT_PUBLIC_API_URL is unset in a production build.
// Without this guard, `${process.env.NEXT_PUBLIC_API_URL}/...` would inline as
// the literal string `undefined/...` and silently break frontend fetches.
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is required for production builds. Pass it via --build-arg or .env.production."
  );
}

const API_BACKEND = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000/api").replace(/\/api\/?$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: path.resolve("."),
  },
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async rewrites() {
    return [
      { source: "/api/student-status/:path*", destination: `${API_BACKEND}/api/student-status/:path*` },
      { source: "/api/session-status/:path*", destination: `${API_BACKEND}/api/session-status/:path*` },
      { source: "/api/session-details/:path*", destination: `${API_BACKEND}/api/session-details/:path*` },
      { source: "/api/end-session/:path*", destination: `${API_BACKEND}/api/end-session/:path*` },
      { source: "/api/end-session-beacon/:path*", destination: `${API_BACKEND}/api/end-session-beacon/:path*` },
      { source: "/api/greeting/:path*", destination: `${API_BACKEND}/api/greeting/:path*` },
      { source: "/api/feedback", destination: `${API_BACKEND}/api/feedback` },
      { source: "/api/voice/:path*", destination: `${API_BACKEND}/api/voice/:path*` },
      { source: "/api/learning-session-feedback", destination: `${API_BACKEND}/api/learning-session-feedback` },
      { source: "/api/me", destination: `${API_BACKEND}/api/me` },
      { source: "/api/login", destination: `${API_BACKEND}/api/login` },
      { source: "/api/logout", destination: `${API_BACKEND}/api/logout` },
      { source: "/api/academy/:path*", destination: `${API_BACKEND}/api/academy/:path*` },
      { source: "/api/student-assessments/:path*", destination: `${API_BACKEND}/api/student-assessments/:path*` },
    ];
  },
};

export default nextConfig;
