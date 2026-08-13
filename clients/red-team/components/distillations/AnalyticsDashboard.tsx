import { useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import { usePipelineHealth } from "@/hooks/use-pipeline-health";
import type { SubjectHealth } from "@/lib/distillations/types";

type AnalyticsDashboardProps = {
  subject?: string;
  phase?: number;
  onSelectSubject?: (subject: string) => void;
};

function HealthBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>{value.toLocaleString()} / {max.toLocaleString()} ({pct.toFixed(1)}%)</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ height: "100%", borderRadius: 4, background: color, width: `${pct}%`, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

function SubjectCard({ subject, onSelect }: { subject: SubjectHealth; onSelect?: () => void }) {
  const { distillations: d, images: img, pairs: p } = subject;
  const rejRate = d.total > 0 ? d.rejected / d.total : 0;

  return (
    <div
      className="images-card"
      style={{ cursor: onSelect ? "pointer" : undefined, margin: 0 }}
      onClick={onSelect}
      title={onSelect ? `Filter to ${subject.subject}` : undefined}
    >
      <div className="images-card-head">
        <strong>{subject.subject}</strong>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{subject.totalFacts.toLocaleString()} facts</span>
        <span className={`badge ${subject.coveragePercent > 0 ? "SHIP" : "REVIEW"}`}>
          {subject.coveragePercent}% ready
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8, fontSize: 12 }}>
        <div>
          <div style={{ opacity: 0.5, marginBottom: 2 }}>Distillations</div>
          <div><strong>{d.approved}</strong> approved / {d.total} total</div>
          {d.review > 0 && <div style={{ color: "#eab308" }}>{d.review} in review</div>}
          {rejRate > 0.3 && <div style={{ color: "#ef4444" }}>{(rejRate * 100).toFixed(0)}% rejected</div>}
        </div>
        <div>
          <div style={{ opacity: 0.5, marginBottom: 2 }}>Images</div>
          <div><strong>{img.ship}</strong> shipped / {img.total} total</div>
          {img.regenerate > 0 && <div style={{ color: "#ef4444" }}>{img.regenerate} regenerated</div>}
        </div>
        <div>
          <div style={{ opacity: 0.5, marginBottom: 2 }}>Pairs</div>
          {p.total > 0
            ? <div><strong>{p.ship}</strong> shipped / {p.total} total</div>
            : <div style={{ opacity: 0.4 }}>Not started</div>}
        </div>
      </div>
    </div>
  );
}

function StrategyChart({ strategies }: { strategies: Record<string, { total: number; approved: number; rejected: number; avgScore: number; sampleSize: number }> }) {
  const entries = Object.entries(strategies).sort((a, b) => b[1].avgScore - a[1].avgScore);
  if (entries.length === 0) return <div className="images-empty">No strategy data yet.</div>;

  const maxScore = Math.max(...entries.map(([, v]) => v.avgScore), 0.01);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([name, stats]) => {
        const pct = (stats.avgScore / maxScore) * 100;
        const rejRate = stats.total > 0 ? stats.rejected / stats.total : 0;
        const isSmallSample = stats.sampleSize < 10;
        const isHighRej = rejRate > 0.3;

        return (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 100, fontSize: 12, textAlign: "right", opacity: isSmallSample ? 0.4 : 1 }}>
              {name}
            </div>
            <div style={{ flex: 1, height: 20, borderRadius: 4, background: "rgba(255,255,255,0.06)", position: "relative" }}>
              <div
                style={{
                  height: "100%", borderRadius: 4, width: `${pct}%`,
                  background: isHighRej ? "#ef4444" : isSmallSample ? "#64748b" : "#3b82f6",
                  transition: "width 0.3s",
                }}
              />
            </div>
            <div style={{ width: 130, fontSize: 12, display: "flex", gap: 6, opacity: isSmallSample ? 0.4 : 1 }}>
              <span style={{ fontWeight: 600 }}>{(stats.avgScore * 100).toFixed(0)}%</span>
              <span style={{ opacity: 0.5 }}>n={stats.sampleSize}</span>
              {isHighRej && <span style={{ color: "#ef4444", fontSize: 11 }}>{(rejRate * 100).toFixed(0)}% rej</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QualityDistribution({ label, buckets }: { label: string; buckets: Record<string, number> }) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const colors: Record<string, string> = { "0-50": "#ef4444", "50-70": "#f59e0b", "70-85": "#3b82f6", "85-100": "#22c55e" };
  const order = ["0-50", "50-70", "70-85", "85-100"];

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", height: 24, borderRadius: 4, overflow: "hidden" }}>
        {order.map((range) => {
          const count = buckets[range] || 0;
          const pct = (count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={range}
              style={{
                width: `${pct}%`, background: colors[range],
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 600, color: "#fff",
                minWidth: pct > 8 ? undefined : 0,
              }}
              title={`${range}%: ${count} variants (${pct.toFixed(0)}%)`}
            >
              {pct > 8 ? `${range}%` : ""}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, opacity: 0.6 }}>
        {order.map((range) => (
          <span key={range}>{range}%: {buckets[range] || 0}</span>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsDashboard({ subject, phase, onSelectSubject }: AnalyticsDashboardProps) {
  const filters = useMemo(() => ({
    subject: subject || undefined,
    phase: phase || undefined,
    drilldown: (subject ? "phase" : undefined) as "phase" | undefined,
  }), [subject, phase]);

  const { data, loading, error, reload } = usePipelineHealth(filters);

  if (loading && !data) {
    return <div className="images-empty">Loading pipeline health...</div>;
  }

  if (error) {
    return <div className="images-error" role="alert">{error}</div>;
  }

  if (!data) {
    return <div className="images-empty">No health data available.</div>;
  }

  const h = data.health;

  return (
    <section className="images-panel" role="tabpanel" aria-label="Dashboard">
      <div className="images-card-head" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Pipeline Health</h2>
        <button onClick={reload} title="Refresh"><Icon name="refresh" /> Refresh</button>
      </div>

      {/* Global health bars */}
      <div style={{ marginBottom: 24 }}>
        <HealthBar label="Pipeline Complete (facts with approved distillation + shipped image)" value={h.pipelineComplete} max={h.totalFacts} color="#22c55e" />
        <HealthBar label="Facts with Approved Distillation" value={h.factsWithApprovedDistillation} max={h.totalFacts} color="#3b82f6" />
        <HealthBar label="Facts with Shipped Image" value={h.factsWithShippedImage} max={h.totalFacts} color="#8b5cf6" />
        {h.factsWithShippedPair > 0 && (
          <HealthBar label="Facts with Shipped Pair" value={h.factsWithShippedPair} max={h.totalFacts} color="#06b6d4" />
        )}
      </div>

      {/* Subject cards */}
      {data.bySubject.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>By Subject</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 8 }}>
            {data.bySubject.map((s) => (
              <SubjectCard
                key={s.subject}
                subject={s}
                onSelect={onSelectSubject ? () => onSelectSubject(s.subject) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Phase drilldown (when subject is selected) */}
      {data.byPhase.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>By Phase — {subject}</h3>
          <div className="images-cards">
            {data.byPhase.map((p) => (
              <div key={`${p.subject}-${p.phase}`} className="images-card" style={{ margin: 0 }}>
                <div className="images-card-head">
                  <strong>Phase {p.phase}</strong>
                  <span style={{ fontSize: 12 }}>{p.totalFacts} facts</span>
                  <span className={`badge ${p.coveragePercent > 0 ? "SHIP" : "REVIEW"}`}>{p.coveragePercent}%</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4, fontSize: 12 }}>
                  <div>Distillations: {p.distillations.approved} approved / {p.distillations.total}</div>
                  <div>Images: {p.images.ship} shipped / {p.images.total}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strategy performance */}
      {Object.keys(data.byStrategy).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Strategy Performance</h3>
          <StrategyChart strategies={data.byStrategy} />
        </div>
      )}

      {/* Quality distribution */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Quality Distribution</h3>
        <QualityDistribution label="Explanations" buckets={data.qualityDistribution.explanations} />
        <QualityDistribution label="Images" buckets={data.qualityDistribution.images} />
      </div>

      {/* Rejection rates */}
      {(data.rejectionRates.explanations.total > 0 || data.rejectionRates.images.total > 0) && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Rejection &amp; Regeneration Rates</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {data.rejectionRates.explanations.total > 0 && (
              <div className="images-card" style={{ margin: 0 }}>
                <div className="images-card-head"><strong>Explanations</strong></div>
                <div style={{ fontSize: 13 }}>
                  <div>{data.rejectionRates.explanations.rejected} rejected / {data.rejectionRates.explanations.total} total</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: data.rejectionRates.explanations.rate > 0.3 ? "#ef4444" : "#94a3b8", marginTop: 4 }}>
                    {(data.rejectionRates.explanations.rate * 100).toFixed(1)}% rejection rate
                  </div>
                </div>
              </div>
            )}
            {data.rejectionRates.images.total > 0 && (
              <div className="images-card" style={{ margin: 0 }}>
                <div className="images-card-head"><strong>Images</strong></div>
                <div style={{ fontSize: 13 }}>
                  <div>{data.rejectionRates.images.regenerated} regenerated / {data.rejectionRates.images.total} total</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: data.rejectionRates.images.rate > 0.3 ? "#ef4444" : "#94a3b8", marginTop: 4 }}>
                    {(data.rejectionRates.images.rate * 100).toFixed(1)}% regeneration rate
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pair status note */}
      {h.factsWithShippedPair === 0 && h.totalFacts > 0 && (
        <div className="images-meta" style={{ opacity: 0.5, fontSize: 12, marginTop: 8 }}>
          Pair evaluation becomes available after facts complete all 4 pipeline stages.
        </div>
      )}

      {/* Recent activity */}
      {data.recentActivity.jobsLast24h > 0 && (
        <div className="images-meta" style={{ marginTop: 8, fontSize: 12 }}>
          <span><strong>{data.recentActivity.jobsLast24h}</strong> jobs in the last 24 hours</span>
        </div>
      )}
    </section>
  );
}
