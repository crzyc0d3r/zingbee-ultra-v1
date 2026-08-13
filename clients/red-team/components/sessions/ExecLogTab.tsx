"use client";

import { useState } from "react";
import type { ExecStep } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { JsonViewer } from "@/components/audits/JsonViewer";

interface ExecLogTabProps {
  log: ExecStep[] | null | undefined;
}

export default function ExecLogTab({ log }: ExecLogTabProps) {
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set());

  if (!log || !log.length) {
    return (
      <div className="empty">
        <div className="ico">
          <Icon name="note" size={32} />
        </div>
        <div>No execution log saved for this session</div>
      </div>
    );
  }

  const toggleStep = (idx: number) => {
    setOpenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="exec-list">
      {log.map((step, i) => {
        const name = step.step || step.name || "Step " + i;
        const agent = step.agent || "";
        const ts = step.timestamp || "";
        const isOpen = openIndices.has(i);

        return (
          <div
            key={i}
            className={`exec-step${isOpen ? " open" : ""}`}
            data-idx={i}
          >
            <div
              className="exec-step-header"
              onClick={() => toggleStep(i)}
            >
              <span className="arrow">&#9654;</span>
              <span className="step-name">{name}</span>
              {agent && <span className="step-agent">{agent}</span>}
              <span className="step-time">{ts}</span>
            </div>
            <div className="exec-step-body" style={{ padding: 0 }}>
              {isOpen && step.details && (
                <JsonViewer
                  data={
                    typeof step.details === "string"
                      ? (() => { try { return JSON.parse(step.details); } catch { return step.details; } })()
                      : step.details
                  }
                />
              )}
              {isOpen && !step.details && (
                <div style={{ padding: "8px 12px", color: "#475569" }}>No details</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
