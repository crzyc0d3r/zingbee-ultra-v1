import { dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/admin/api/:path*", destination: `${api}/admin/api/:path*` },
      { source: "/sessions/api/:path*", destination: `${api}/sessions/api/:path*` },
      { source: "/evals/api/:path*", destination: `${api}/evals/api/:path*` },
      { source: "/image-eval/api/:path*", destination: `${api}/image-eval/api/:path*` },
      { source: "/distillations/api/:path*", destination: `${api}/distillations/api/:path*` },
      { source: "/metaphor-eval/api/:path*", destination: `${api}/metaphor-eval/api/:path*` },
      { source: "/curriculum-audit", destination: `${api}/curriculum-audit` },
    ];
  },
};

export default nextConfig;
