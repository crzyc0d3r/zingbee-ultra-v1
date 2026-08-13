"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { SvgSprite } from "@/components/ui/Icon";

// ---------- Shared types ----------
export interface ReportingSummary {
  range: { from: string; to: string };
  totals: {
    sessions: number;
    students: number;
    duration_seconds: number;
    cost_usd: number;
  };
  cost_by_student: { student_id: string; student_name: string; cost_usd: number }[];
  cost_by_bucket: { bucket: string; cost_usd: number; count: number }[];
  cost_by_model: { model: string; cost_usd: number; count: number }[];
  cost_by_subject: { subject: string; cost_usd: number }[];
  time_by_student: { student_id: string; student_name: string; duration_seconds: number; sessions: number }[];
  time_by_fact: { fact_text: string; seconds: number; sessions: number; unique_students: number }[];
  students_detailed: {
    student_id: string;
    student_name: string;
    cost_usd: number;
    duration_seconds: number;
    sessions: number;
    facts_taught: number;
    questions: number;
    correct: number;
    accuracy_pct: number | null;
    seconds_per_fact: number | null;
    usd_per_fact: number | null;
    usd_per_minute: number | null;
  }[];
  daily: {
    date: string;
    cost_usd: number;
    duration_seconds: number;
    sessions: number;
    by_model: Record<string, number>;
    by_bucket: Record<string, number>;
  }[];
}

export type Preset = "7d" | "30d" | "90d" | "all" | "custom";

const PRESET_DAYS: Record<Exclude<Preset, "custom" | "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function isoDayStart(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
}
function isoDayEnd(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)).toISOString();
}
function defaultFromIso(preset: Preset): string {
  if (preset === "all") return new Date(2020, 0, 1).toISOString();
  if (preset === "custom") return isoDayStart(new Date(Date.now() - 30 * 86400_000));
  return isoDayStart(new Date(Date.now() - PRESET_DAYS[preset] * 86400_000));
}

export function fmtUSD(n: number): string {
  if (!n) return "$0.00";
  if (n < 0.01) return "$" + n.toFixed(4);
  return "$" + n.toFixed(2);
}
export function fmtDur(seconds: number): string {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------- Shared UI primitives ----------

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b",
      borderRadius: 8, padding: "14px 18px", flex: 1, minWidth: 160,
    }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, color: "#f1f5f9", fontWeight: 600, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function BarRow({
  label, value, max, formatted, sub,
}: { label: string; value: number; max: number; formatted: string; sub?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid #1e293b" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
        <span style={{ color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 12 }}>{label}</span>
        <span style={{ color: "#f1f5f9", fontVariantNumeric: "tabular-nums", fontWeight: 500, flexShrink: 0 }}>
          {formatted} {sub && <span style={{ color: "#64748b", fontWeight: 400, marginLeft: 6 }}>{sub}</span>}
        </span>
      </div>
      <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#3b82f6", borderRadius: 2 }} />
      </div>
    </div>
  );
}

// Stable palette for chart series (cycled by index)
export const SERIES_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4",
  "#ef4444", "#ec4899", "#84cc16", "#14b8a6", "#f97316",
  "#8b5cf6", "#10b981", "#eab308", "#0ea5e9", "#f43f5e",
];

// ---------- Donut chart ----------
export function Donut({
  data, size = 180, stroke = 28, valueFmt = (n) => String(n),
}: {
  data: { label: string; value: number; color?: string }[];
  size?: number;
  stroke?: number;
  valueFmt?: (n: number) => string;
}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  let accumulated = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
          {total > 0 && data.map((d, i) => {
            const v = Math.max(0, d.value);
            if (v <= 0) return null;
            const len = (v / total) * circ;
            const gap = circ - len;
            const offset = -accumulated;
            accumulated += len;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color || SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${gap}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ fontSize: 18, color: "#f1f5f9", fontWeight: 600 }}>{valueFmt(total)}</div>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Total</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
        {data.slice(0, 10).map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{
              width: 10, height: 10, borderRadius: 2,
              background: d.color || SERIES_COLORS[i % SERIES_COLORS.length],
              flexShrink: 0,
            }} />
            <span style={{ color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{d.label}</span>
            <span style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{valueFmt(d.value)}</span>
            <span style={{ color: "#64748b", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 38, textAlign: "right" }}>
              {total > 0 ? Math.round((d.value / total) * 100) + "%" : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Stacked-bar time series ----------
export function StackedTimeChart({
  days, series, valueFmt = (n) => String(n), height = 200,
}: {
  days: { date: string; values: Record<string, number> }[];
  series: { key: string; color?: string }[];
  valueFmt?: (n: number) => string;
  height?: number;
}) {
  if (!days.length || !series.length) {
    return <div style={{ color: "#64748b", fontSize: 12 }}>No data in this range.</div>;
  }
  // Compute per-day totals to find global max for y-axis scaling
  const dayTotals = days.map((d) => series.reduce((s, sr) => s + (d.values[sr.key] || 0), 0));
  const max = Math.max(1e-9, ...dayTotals);
  const barWidthPct = 100 / days.length;

  return (
    <div>
      <div style={{ position: "relative", height, padding: "0 0 24px 0", borderBottom: "1px solid #1e293b" }}>
        {/* Y-axis ticks */}
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <div key={t} style={{
            position: "absolute", left: 0, right: 0, bottom: `calc(${t * 100}% - 0.5px)`,
            borderTop: "1px dashed #1e293b66",
          }} />
        ))}
        <div style={{ display: "flex", alignItems: "flex-end", height: "100%", gap: 2 }}>
          {days.map((d, idx) => {
            const total = dayTotals[idx];
            const heightPct = (total / max) * 100;
            // Tooltip text
            const tooltip = `${d.date}\n${valueFmt(total)}\n` + series
              .map((s) => [s.key, d.values[s.key] || 0] as [string, number])
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `  ${k}: ${valueFmt(v)}`)
              .join("\n");
            return (
              <div key={d.date} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }} title={tooltip}>
                <div style={{ height: `${heightPct}%`, display: "flex", flexDirection: "column-reverse" }}>
                  {series.map((s, i) => {
                    const v = d.values[s.key] || 0;
                    if (v <= 0) return null;
                    const segPct = total > 0 ? (v / total) * 100 : 0;
                    return (
                      <div
                        key={s.key}
                        style={{
                          height: `${segPct}%`,
                          background: s.color || SERIES_COLORS[i % SERIES_COLORS.length],
                          minHeight: 1,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Date labels — show first, middle, last */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "#64748b" }}>
        <span>{days[0]?.date}</span>
        {days.length > 2 && <span>{days[Math.floor(days.length / 2)]?.date}</span>}
        <span>{days[days.length - 1]?.date}</span>
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        {series.map((s, i) => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#cbd5e1" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color || SERIES_COLORS[i % SERIES_COLORS.length] }} />
            {s.key}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Simple sparkline ----------
export function Sparkline({
  values, width = 200, height = 40, color = "#3b82f6",
}: { values: number[]; width?: number; height?: number; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(1e-9, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height}>
      <polyline fill="none" stroke={color} strokeWidth={2} points={pts} />
    </svg>
  );
}

export function Panel({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <div style={{
      background: "#0a1322",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: 16,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, color: "#f1f5f9", fontWeight: 600, margin: 0 }}>{title}</h3>
        {typeof count === "number" && (
          <span style={{ fontSize: 11, color: "#64748b" }}>{count} {count === 1 ? "row" : "rows"}</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------- Shell ----------

interface ReportShellProps {
  title: string;
  /** Optional descriptive subtitle */
  subtitle?: string;
  /** Render the body once data has loaded */
  render: (data: ReportingSummary) => React.ReactNode;
  /** Optional default preset (default "30d") */
  defaultPreset?: Preset;
  /**
   * Which top-stats to surface in the header:
   *   "cost" — sessions, total cost, avg cost/session
   *   "time" — sessions, total learning time, avg session length
   * default: "cost"
   */
  kind?: "cost" | "time";
}

function ReportShellInner({ title, subtitle, render, defaultPreset = "30d", kind = "cost" }: ReportShellProps) {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [from, setFrom] = useState<string>(defaultFromIso(defaultPreset).slice(0, 10));
  const [to, setTo] = useState<string>(isoDayEnd(new Date()).slice(0, 10));
  const [data, setData] = useState<ReportingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const fromIso = useMemo(() => isoDayStart(new Date(from + "T00:00:00Z")), [from]);
  const toIso = useMemo(() => isoDayEnd(new Date(to + "T00:00:00Z")), [to]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const d = await apiFetch<ReportingSummary>(
        `/api/reporting/summary?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
      );
      setData(d);
    } catch (e: any) {
      setError(e?.message || "Failed to load reporting data");
    } finally {
      setBusy(false);
    }
  }, [user, fromIso, toIso]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === "custom") return;
    setFrom(defaultFromIso(p).slice(0, 10));
    setTo(isoDayEnd(new Date()).slice(0, 10));
  };

  if (loading) return null;
  if (!user) return <LoginOverlay />;

  return (
    <div style={{ padding: isEmbed ? 16 : 24, maxWidth: 1400, margin: "0 auto", color: "#e2e8f0" }}>
      <SvgSprite />
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: "#94a3b8", margin: "4px 0 0 0" }}>{subtitle}</p>}
      </div>

      {/* Controls */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        background: "#0a1322", border: "1px solid #1e293b", borderRadius: 10,
        padding: 12, marginBottom: 16,
      }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["7d", "30d", "90d", "all", "custom"] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              style={{
                background: preset === p ? "#1e3a8a" : "transparent",
                color: preset === p ? "#fff" : "#94a3b8",
                border: `1px solid ${preset === p ? "#3b82f6" : "#334155"}`,
                padding: "5px 10px", borderRadius: 6, fontSize: 12,
                cursor: "pointer",
              }}
            >
              {p === "7d" ? "Last 7 days" : p === "30d" ? "Last 30 days" : p === "90d" ? "Last 90 days" : p === "all" ? "All time" : "Custom"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>From</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
                 style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", padding: "4px 8px", borderRadius: 4, fontSize: 12 }} />
          <label style={{ fontSize: 12, color: "#94a3b8" }}>To</label>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
                 style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", padding: "4px 8px", borderRadius: 4, fontSize: 12 }} />
        </div>

        <button
          onClick={fetchData}
          disabled={busy}
          style={{
            background: "#3b82f6", color: "#fff", border: "none",
            padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer",
            opacity: busy ? 0.6 : 1, marginLeft: "auto",
          }}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#7f1d1d44", border: "1px solid #b91c1c", color: "#fca5a5", padding: 10, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Range totals header — only show stats relevant to this report kind */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <StatCard label="Sessions" value={String(data.totals.sessions)} sub={`${data.totals.students} students`} />
            {kind === "cost" ? (
              <>
                <StatCard label="Total Cost" value={fmtUSD(data.totals.cost_usd)} />
                <StatCard
                  label="Avg Cost / Session"
                  value={fmtUSD(data.totals.sessions ? data.totals.cost_usd / data.totals.sessions : 0)}
                />
              </>
            ) : (
              <>
                <StatCard label="Total Learning Time" value={fmtDur(data.totals.duration_seconds)} />
                <StatCard
                  label="Avg Session Length"
                  value={fmtDur(data.totals.sessions ? Math.round(data.totals.duration_seconds / data.totals.sessions) : 0)}
                />
              </>
            )}
          </div>
          {render(data)}
        </>
      )}
    </div>
  );
}

export function ReportShell(props: ReportShellProps) {
  return (
    <Suspense fallback={null}>
      <ReportShellInner {...props} />
    </Suspense>
  );
}
