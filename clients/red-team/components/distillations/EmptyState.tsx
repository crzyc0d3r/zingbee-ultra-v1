import { Icon } from "@/components/ui/Icon";

type EmptyStateProps = {
  subject: string;
  phase: string | number;
  theme: string;
  capsule: string;
  subjectCount: number;
  phaseCount: number;
  themeCount: number;
  capsuleCount: number;
  scopeWarning?: string;
};

export function EmptyState({
  subject, phase, theme, capsule,
  subjectCount, phaseCount, themeCount, capsuleCount,
  scopeWarning,
}: EmptyStateProps) {
  const steps = [
    { label: "Subject", value: subject, count: subjectCount, done: !!subject },
    { label: "Phase", value: phase ? String(phase) : "", count: phaseCount, done: !!phase },
    { label: "Theme", value: theme, count: themeCount, done: !!theme },
    { label: "Capsule", value: capsule, count: capsuleCount, done: !!capsule },
  ];

  const currentStep = steps.findIndex((s) => !s.done);

  return (
    <section className="images-panel" style={{ padding: 32, textAlign: "center" }}>
      {scopeWarning && (
        <div className="images-error" role="alert" style={{ marginBottom: 16, background: "rgba(234, 179, 8, 0.12)", borderColor: "#eab308" }}>
          {scopeWarning}
        </div>
      )}

      <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Select a scope to get started</h2>
      <p style={{ opacity: 0.6, marginBottom: 24 }}>
        Choose a subject, phase, theme, and capsule to view and manage the distillation pipeline.
      </p>

      <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
        {steps.map((step, i) => {
          const isCurrent = i === currentStep;
          const isLocked = i > currentStep && currentStep >= 0;
          return (
            <div
              key={step.label}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 16px", borderRadius: 8,
                border: `2px solid ${step.done ? "var(--color-success, #22c55e)" : isCurrent ? "var(--color-primary, #3b82f6)" : "var(--color-border, #334155)"}`,
                background: step.done ? "rgba(34, 197, 94, 0.08)" : isCurrent ? "rgba(59, 130, 246, 0.08)" : "transparent",
                opacity: isLocked ? 0.4 : 1,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {step.done ? <Icon name="check" size={14} /> : `${i + 1}.`}
              </span>
              <span style={{ fontSize: 14 }}>
                {step.done ? step.value : `${step.label}`}
                {!step.done && step.count > 0 && (
                  <span style={{ opacity: 0.5, marginLeft: 4 }}>({step.count})</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {currentStep >= 0 && (
        <p style={{ marginTop: 16, fontSize: 13, opacity: 0.5 }}>
          Select a {steps[currentStep].label.toLowerCase()} from the dropdowns above
          {steps[currentStep].count > 0 && ` — ${steps[currentStep].count} available`}
        </p>
      )}
    </section>
  );
}
