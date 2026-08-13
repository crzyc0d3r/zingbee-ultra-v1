"use client";

import type { AdminHierarchy } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";

interface AdminSidebarProps {
  hierarchy: AdminHierarchy | null;
  tableCounts: Record<string, number>;
  activeTable: string | null;
  onSelect: (table: string) => void;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function AdminSidebar({ hierarchy, tableCounts, activeTable, onSelect }: AdminSidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        Admin
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <a href="/">App</a>
          <a href="/sessions">Sessions</a>
          <a href="/evals">Evals</a>
        </span>
      </div>
      <div className="sidebar-nav">
        {/* Dashboard link */}
        <div
          className={`nav-item${activeTable === "__dashboard__" ? " active" : ""}`}
          style={{
            fontWeight: 600,
            marginBottom: 6,
            borderBottom: "1px solid #334155",
            paddingBottom: 10,
          }}
          onClick={() => onSelect("__dashboard__")}
        >
          <Icon name="chart" /> Dashboard
        </div>
        {/* Root group items */}
        {hierarchy?.root_groups.map((g) => {
          const t = g.tables[0];
          return (
            <div
              key={t}
              className={`nav-item${activeTable === t ? " active" : ""}`}
              onClick={() => onSelect(t)}
            >
              <span dangerouslySetInnerHTML={{ __html: g.icon }} />{" "}
              {esc(g.label)}
              <span className="cnt">{tableCounts[t] || 0}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
