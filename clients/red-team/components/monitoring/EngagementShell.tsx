"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { SvgSprite } from "@/components/ui/Icon";

// Engagement-monitoring response (mirrors GET /api/reporting/engagement).
export interface EngagementData {
  range: { from: string; to: string };
  segment: string;
  totals: {
    sessions: number;
    chip_turns: number;
    chip_ctr: number | null;
    hollow_ready_rate: number | null;
    hollow_ready_n: number;
    typed_advance_hollow_rate: number | null;
    typed_advance_hollow_n: number;
    fallback_rate: number | null;
    ack_violation_rate: number | null;
    ack_violation_n: number;
  };
  intent_distribution: { intent: string; clicks: number; pct: number }[];
  daily: { date: string; by_intent: Record<string, number> }[];
  by_segment: { segment_label: string; ready_clicks: number; hollow_rate: number | null; hollow_n: number }[];
  compliance_by_subtype: { subtype: string; count: number }[];
  overuse: { guided_try_fires: number; detours_before_fail: number; detours_before_mastery: number };
  accuracy_vs_ctr: { ctr_band: string; avg_accuracy: number | null; sessions: number }[];
  latency_by_step: { step: string; p50_ms: number | null; p95_ms: number | null; n: number }[];
  worst_facts: {
    fact: string; ready_clicks: number; hollow_count: number; solid_count: number;
    inconclusive_count: number; hollow_rate: number;
  }[];
}

export type Preset = "7d" | "30d" | "90d" | "all" | "custom";
export type Segment = "age" | "subject" | "tutor" | "none";

const PRESET_DAYS: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

function isoDayStart(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
}
function isoDayEnd(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)).toISOString();
}
function defaultFromIso(preset: Preset): string {
  if (preset === "all") return new Date(2020, 0, 1).toISOString();
  if (preset === "custom") return isoDayStart(new Date(Date.now() - 30 * 86400_000));
  return isoDayStart(new Date(Date.now() - PRESET_DAYS[preset as "7d" | "30d" | "90d"] * 86400_000));
}

/** Rate helpers shared by the page: format a rate with its denominator, and
 *  flag low-n so the UI can grey it (statistical honesty — never present a
 *  1-of-2 rate as a confident signal). */
export function fmtRate(rate: number | null, n: number): string {
  if (rate === null || n === 0) return "—";
  return `${rate}%`;
}
export const LOW_N = 10;
export function isLowN(n: number): boolean {
  return n > 0 && n < LOW_N;
}

interface ShellProps {
  title: string;
  subtitle?: string;
  render: (data: EngagementData, segment: Segment) => React.ReactNode;
  defaultPreset?: Preset;
}

function EngagementShellInner({ title, subtitle, render, defaultPreset = "30d" }: ShellProps) {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [from, setFrom] = useState<string>(defaultFromIso(defaultPreset).slice(0, 10));
  const [to, setTo] = useState<string>(isoDayEnd(new Date()).slice(0, 10));
  const [segment, setSegment] = useState<Segment>("age");
  const [data, setData] = useState<EngagementData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const fromIso = useMemo(() => isoDayStart(new Date(from + "T00:00:00Z")), [from]);
  const toIso = useMemo(() => isoDayEnd(new Date(to + "T00:00:00Z")), [to]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const d = await apiFetch<EngagementData>(
        `/api/reporting/engagement?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&segment=${segment}`
      );
      setData(d);
    } catch (e: any) {
      setError(e?.message || "Failed to load engagement data");
    } finally {
      setBusy(false);
    }
  }, [user, fromIso, toIso, segment]);

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

  const btn = (active: boolean) => ({
    background: active ? "#1e3a8a" : "transparent",
    color: active ? "#fff" : "#94a3b8",
    border: `1px solid ${active ? "#3b82f6" : "#334155"}`,
    padding: "5px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
  });

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
        background: "#0a1322", border: "1px solid #1e293b", borderRadius: 10, padding: 12, marginBottom: 16,
      }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["7d", "30d", "90d", "all", "custom"] as Preset[]).map((p) => (
            <button key={p} onClick={() => applyPreset(p)} style={btn(preset === p)}>
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Segment</label>
          {(["age", "subject", "tutor"] as Segment[]).map((s) => (
            <button key={s} onClick={() => setSegment(s)} style={btn(segment === s)}>
              {s === "age" ? "Age band" : s === "subject" ? "Subject" : "Tutor"}
            </button>
          ))}
        </div>
        <button onClick={fetchData} disabled={busy}
                style={{ background: "#3b82f6", color: "#fff", border: "none", padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", opacity: busy ? 0.6 : 1, marginLeft: "auto" }}>
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
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
            {data.totals.sessions} sessions in range · exploratory instrumentation — rates show their sample size (n); low-n values are dimmed.
          </div>
          {render(data, segment)}
        </>
      )}
    </div>
  );
}

export function EngagementShell(props: ShellProps) {
  return (
    <Suspense fallback={null}>
      <EngagementShellInner {...props} />
    </Suspense>
  );
}
