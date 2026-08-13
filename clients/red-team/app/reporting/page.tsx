"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { SvgSprite } from "@/components/ui/Icon";

const REPORTS = [
  { slug: "cost-by-student", title: "Cost by Student", desc: "LLM + media cost per student" },
  { slug: "cost-by-workload", title: "Cost by Workload", desc: "Tutor / Assessor / Image / TTS / Classifier" },
  { slug: "cost-by-model", title: "Cost by Model", desc: "Per-model cost and call volume" },
  { slug: "cost-by-subject", title: "Cost by Subject", desc: "Cost grouped by capsule subject" },
  { slug: "time-by-student", title: "Time by Student", desc: "Total learning time per student" },
  { slug: "time-by-fact", title: "Time by Fact", desc: "Time spent per individual fact" },
];

function ReportingIndexInner() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

  if (loading) return null;
  if (!user) return <LoginOverlay />;

  return (
    <div style={{ padding: isEmbed ? 16 : 24, maxWidth: 1100, margin: "0 auto", color: "#e2e8f0" }}>
      <SvgSprite />
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Reporting</h1>
      <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 20px 0" }}>
        Choose a report from the left nav, or pick one below. Each report has its own date-range filter.
      </p>
      <div style={{
        display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      }}>
        {REPORTS.map((r) => (
          <a
            key={r.slug}
            href={`/reporting/${r.slug}${isEmbed ? "?embed=1" : ""}`}
            style={{
              display: "block", padding: 16,
              background: "#0a1322", border: "1px solid #1e293b",
              borderRadius: 10, textDecoration: "none",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget.style.borderColor = "#3b82f6"); }}
            onMouseLeave={(e) => { (e.currentTarget.style.borderColor = "#1e293b"); }}
          >
            <div style={{ fontSize: 15, color: "#f1f5f9", fontWeight: 600 }}>{r.title}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{r.desc}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function ReportingIndex() {
  return (
    <Suspense fallback={null}>
      <ReportingIndexInner />
    </Suspense>
  );
}
