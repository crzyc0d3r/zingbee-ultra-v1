import "@/styles/globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "ZingBee RT Studio",
  description: "Red Team Tutoring Studio",
  icons: { icon: "/robot-bee.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <Script
          src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
