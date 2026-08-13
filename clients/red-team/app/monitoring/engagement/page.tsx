"use client";

import { Panel, StatCard, BarRow, Donut, StackedTimeChart } from "@/components/reporting/ReportShell";
import { EngagementShell, fmtRate, isLowN } from "@/components/monitoring/EngagementShell";

// Stable color per intent so the spread is recognizable across charts.
const INTENT_COLOR: Record<string, string> = {
  confused: "#ef4444", example: "#f59e0b", explore: "#a855f7",
  ready: "#22c55e", continue: "#14b8a6", recall_more: "#06b6d4",
  recap: "#3b82f6", end: "#64748b",
};

// A headline stat that always carries its denominator and dims on low-n.
function RateCard({ label, rate, n, sub }: { label: string; rate: number | null; n: number; sub?: string }) {
  const dim = rate === null || n === 0 || isLowN(n);
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8,
      padding: "14px 18px", flex: 1, minWidth: 170, opacity: dim ? 0.55 : 1,
    }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, color: "#f1f5f9", fontWeight: 600, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        {fmtRate(rate, n)}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
        {n === 0 ? "no decided outcomes yet" : `n=${n}${isLowN(n) ? " · low confidence" : ""}`}{sub ? ` · ${sub}` : ""}
      </div>
    </div>
  );
}

export default function EngagementMonitoringPage() {
  return (
    <EngagementShell
      title="Engagement Health"
      subtitle="Are the conversational chips genuine engagement or new compliance theatre? Every metric is outcome-anchored: a click is never 'good' on its own — only its CHECK/EVIDENCE gate decides."
      render={(d, segment) => {
        const t = d.totals;
        const intentKeys = Array.from(new Set(d.intent_distribution.map((i) => i.intent)));
        const days = d.daily.map((x) => ({ date: x.date, values: x.by_intent }));
        const segLabel = segment === "age" ? "age band" : segment;

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Headline cards — misuse first, with the typed-advance baseline beside it */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <RateCard label="Hollow-Ready (misuse)" rate={t.hollow_ready_rate} n={t.hollow_ready_n}
                        sub="clicked ready → failed gate" />
              <RateCard label="Typed-Advance baseline" rate={t.typed_advance_hollow_rate} n={t.typed_advance_hollow_n}
                        sub="typed 'ok' → failed gate" />
              <StatCard label="Chip CTR (descriptive)" value={t.chip_ctr === null ? "—" : `${t.chip_ctr}%`}
                        sub={`${t.chip_turns} chip turns`} />
              <RateCard label="Ack-violation rate" rate={t.ack_violation_rate} n={t.ack_violation_n}
                        sub="tutor didn't acknowledge" />
              <StatCard label="Fallback rate" value={t.fallback_rate === null ? "—" : `${t.fallback_rate}%`}
                        sub="LLM chip quality / i18n" />
            </div>

            {/* Misuse by segment + intent mix */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
              <Panel title={`Hollow-ready by ${segLabel}`} count={d.by_segment.length}>
                {d.by_segment.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>No chip outcomes in this range.</div>
                ) : d.by_segment.map((s) => (
                  <div key={s.segment_label} style={{ opacity: isLowN(s.hollow_n) || s.hollow_n === 0 ? 0.5 : 1 }}>
                    <BarRow
                      label={s.segment_label}
                      value={s.hollow_rate ?? 0}
                      max={100}
                      formatted={fmtRate(s.hollow_rate, s.hollow_n)}
                      sub={`n=${s.hollow_n} · ${s.ready_clicks} clicks`}
                    />
                  </div>
                ))}
              </Panel>
              <Panel title="Intent mix (which choices students make)">
                {d.intent_distribution.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>No chip clicks in this range.</div>
                ) : (
                  <Donut
                    data={d.intent_distribution.map((i) => ({
                      label: i.intent, value: i.clicks, color: INTENT_COLOR[i.intent] || "#3b82f6",
                    }))}
                    valueFmt={(n) => `${n}`}
                  />
                )}
              </Panel>
            </div>

            {/* Engagement over time */}
            <Panel title="Chip clicks over time (by intent)">
              <StackedTimeChart
                days={days}
                series={intentKeys.map((k) => ({ key: k, color: INTENT_COLOR[k] || undefined }))}
                valueFmt={(n) => `${n}`}
              />
            </Panel>

            {/* Worst facts (drill-down) + compliance */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
              <Panel title="Worst facts — hollow-ready (ranked by volume × rate)" count={d.worst_facts.length}>
                {d.worst_facts.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>No ready-chip outcomes yet in this range.</div>
                ) : d.worst_facts.map((f) => (
                  <a key={f.fact}
                     href={`/sessions?embed=1&search=${encodeURIComponent(f.fact.slice(0, 40))}`}
                     target="_top"
                     style={{ textDecoration: "none", display: "block",
                              opacity: isLowN(f.hollow_count + f.solid_count) ? 0.55 : 1 }}
                     title="Open matching sessions">
                    <BarRow
                      label={f.fact}
                      value={f.hollow_rate * 100}
                      max={100}
                      formatted={`${Math.round(f.hollow_rate * 100)}%`}
                      sub={`${f.hollow_count}H/${f.solid_count}S · ${f.inconclusive_count} incon · ${f.ready_clicks} clicks`}
                    />
                  </a>
                ))}
              </Panel>
              <Panel title="Tutor compliance (violations by subtype)" count={d.compliance_by_subtype.length}>
                {d.compliance_by_subtype.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>No violations in this range.</div>
                ) : d.compliance_by_subtype.map((c) => (
                  <BarRow
                    key={c.subtype}
                    label={c.subtype === "missing_acknowledgment" ? "⚠ missing_acknowledgment (verify over-flag)" : c.subtype}
                    value={c.count}
                    max={d.compliance_by_subtype[0]?.count || 1}
                    formatted={String(c.count)}
                  />
                ))}
              </Panel>
            </div>

            {/* Overuse + accuracy-vs-CTR + latency */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16 }}>
              <Panel title="Overuse (detours = curiosity vs avoidance)">
                <BarRow label="detours → eventual mastery" value={d.overuse.detours_before_mastery}
                        max={Math.max(1, d.overuse.detours_before_mastery + d.overuse.detours_before_fail)}
                        formatted={String(d.overuse.detours_before_mastery)} sub="healthy" />
                <BarRow label="detours → failed gate" value={d.overuse.detours_before_fail}
                        max={Math.max(1, d.overuse.detours_before_mastery + d.overuse.detours_before_fail)}
                        formatted={String(d.overuse.detours_before_fail)} sub="avoidance" />
                <BarRow label="guided-try handoffs (detour cap hit)" value={d.overuse.guided_try_fires}
                        max={Math.max(1, d.overuse.guided_try_fires)} formatted={String(d.overuse.guided_try_fires)} />
              </Panel>
              <Panel title="Accuracy vs chip-CTR (do clickers learn?)">
                {d.accuracy_vs_ctr.every((a) => a.sessions === 0) ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>No sessions with both chips and graded answers yet.</div>
                ) : d.accuracy_vs_ctr.map((a) => (
                  <BarRow key={a.ctr_band} label={a.ctr_band} value={a.avg_accuracy ?? 0} max={100}
                          formatted={a.avg_accuracy === null ? "—" : `${a.avg_accuracy}%`}
                          sub={`${a.sessions} sess`} />
                ))}
              </Panel>
              <Panel title="Turn latency vs budget (<3s short · <8s complex)">
                {d.latency_by_step.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>No latency data in this range.</div>
                ) : d.latency_by_step.map((l) => (
                  <BarRow key={l.step}
                          label={l.step === "LLM_RESPONSE" ? "Tutor LLM" : "Assessor LLM"}
                          value={l.p50_ms ?? 0} max={Math.max(8000, ...d.latency_by_step.map((x) => x.p95_ms ?? 0))}
                          formatted={`p50 ${l.p50_ms}ms`} sub={`p95 ${l.p95_ms}ms · n=${l.n}`} />
                ))}
              </Panel>
            </div>
          </div>
        );
      }}
    />
  );
}
