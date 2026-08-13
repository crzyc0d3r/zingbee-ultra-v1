"use client";

import { useState, useCallback, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { EVAL_TARGETS, EVAL_CONFIGS, EVAL_PERSONAS } from "@/lib/constants";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface NewJobFormProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function NewJobForm({ open, onClose, onCreated }: NewJobFormProps) {
  const [selectedTargets, setSelectedTargets] = useState<string[]>(["smoke"]);
  const [config, setConfig] = useState(EVAL_CONFIGS[0].value);
  const [persona, setPersona] = useState(EVAL_PERSONAS[0].value);
  const [gradeEnabled, setGradeEnabled] = useState(false);
  const [maxTurns, setMaxTurns] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const toggleTarget = useCallback(
    (val: string) => {
      if (val === "all") {
        setSelectedTargets(["all"]);
      } else {
        setSelectedTargets((prev) => {
          const filtered = prev.filter((t) => t !== "all");
          const idx = filtered.indexOf(val);
          if (idx >= 0) {
            const next = [...filtered];
            next.splice(idx, 1);
            return next.length ? next : ["smoke"];
          }
          return [...filtered, val];
        });
      }
    },
    []
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await apiFetch("/evals/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          targets: selectedTargets,
          config,
          persona,
          enableGrading: gradeEnabled,
          maxTurns: maxTurns ? parseInt(maxTurns, 10) : null,
        }),
      });
      toast("Job started!", "success");
      onClose();
      onCreated();
    } catch (e: any) {
      if (e.message !== "auth") toast(e.message || "Failed to start job", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Eval Job"
      maxWidth="700px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-success"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Starting..." : "Start Job"}
          </button>
        </>
      }
    >
      <div className="fg">
        <label>Test Targets</label>
        <div className="chip-grid">
          {EVAL_TARGETS.map((t) => (
            <button
              key={t.value}
              className={`chip${selectedTargets.includes(t.value) ? " selected" : ""}`}
              onClick={() => toggleTarget(t.value)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="fg">
        <label>Model Config</label>
        <select value={config} onChange={(e) => setConfig(e.target.value)}>
          {EVAL_CONFIGS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="fg">
        <label>Student Persona</label>
        <select value={persona} onChange={(e) => setPersona(e.target.value)}>
          {EVAL_PERSONAS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="switch-row">
        <div>
          <div className="switch-label">Enable LLM Grading</div>
          <div className="switch-sub">
            Uses LLM-as-judge for deeper scoring (costs extra)
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={gradeEnabled}
            onChange={(e) => setGradeEnabled(e.target.checked)}
          />
          <span className="slider" />
        </label>
      </div>
      <div className="fg">
        <label>
          Max Turns Override{" "}
          <span
            style={{
              fontWeight: 400,
              color: "#475569",
              textTransform: "none",
              fontSize: "10px",
              marginLeft: "4px",
            }}
          >
            (leave empty for default)
          </span>
        </label>
        <input
          type="number"
          placeholder="e.g. 20"
          style={{ width: 120 }}
          value={maxTurns}
          onChange={(e) => setMaxTurns(e.target.value)}
        />
      </div>
    </Modal>
  );
}
