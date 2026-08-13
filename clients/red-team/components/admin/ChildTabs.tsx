"use client";

import type { ChildDef } from "@/lib/types";

interface ChildTabsProps {
  children: ChildDef[];
  currentTable: string;
  onSwitch: (childDef: ChildDef) => void;
}

export function ChildTabs({ children, currentTable, onSwitch }: ChildTabsProps) {
  if (children.length <= 1) {
    return <div className="child-tabs" />;
  }

  return (
    <div className="child-tabs has-tabs">
      {children.map((c) => (
        <div
          key={c.table}
          className={`child-tab${c.table === currentTable ? " active" : ""}`}
          onClick={() => {
            if (c.table !== currentTable) onSwitch(c);
          }}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}
