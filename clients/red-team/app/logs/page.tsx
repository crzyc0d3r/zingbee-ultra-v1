"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { SvgSprite, Icon } from "@/components/ui/Icon";
import { apiFetch } from "@/lib/api";

type LogEntry = {
  insert_id: string;
  timestamp: string;
  severity: string;
  log_name?: string;
  trace_id?: string | null;
  event?: string | null;
  user_id?: string | null;
  student_id?: string | null;
  session_db_id?: string | null;
  payload: Record<string, any>;
  resource_type?: string | null;
  labels?: Record<string, string>;
};

type LogsResponse = {
  entries: LogEntry[];
  next_page_token: string | null;
  filter: string;
  from_ts: string;
  to_ts: string;
  count: number;
  error?: string;
};

const SEVERITY_COLORS: Record<string, string> = {
  DEBUG: "#64748b",
  INFO: "#38bdf8",
  NOTICE: "#a78bfa",
  WARNING: "#facc15",
  ERROR: "#f87171",
  CRITICAL: "#ef4444",
  DEFAULT: "#94a3b8",
};

const WINDOW_PRESETS: { label: string; minutes: number }[] = [
  { label: "5m", minutes: 5 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
];

function LogsInner() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";

  const [q, setQ] = useState("");
  const [level, setLevel] = useState<string>("");
  const [event, setEvent] = useState<string>("");
  const [traceFilter, setTraceFilter] = useState<string>(searchParams.get("trace_id") || "");
  const [studentFilter, setStudentFilter] = useState<string>("");
  const [minutes, setMinutes] = useState<number>(60);

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [knownEvents, setKnownEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshIv = useRef<NodeJS.Timeout | null>(null);

  // Fetch known events for the dropdown
  useEffect(() => {
    apiFetch<{ events: string[] }>("/api/admin/logs/events")
      .then((r) => setKnownEvents(r.events || []))
      .catch(() => {});
  }, []);

  const fetchLogs = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (level) params.set("level", level);
      if (event) params.set("event", event);
      if (traceFilter) params.set("trace_id", traceFilter);
      if (studentFilter) params.set("student_id", studentFilter);
      params.set("minutes", String(minutes));
      params.set("page_size", "500");
      const data = await apiFetch<LogsResponse>(`/api/admin/logs?${params.toString()}`);
      if ((data as any).error) {
        setErr((data as any).error);
        setEntries([]);
      } else {
        setEntries(data.entries || []);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
      setEntries([]);
    } finally {
      setBusy(false);
    }
  }, [q, level, event, traceFilter, studentFilter, minutes]);

  useEffect(() => {
    if (user) fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (autoRefresh) {
      refreshIv.current = setInterval(fetchLogs, 5000);
      return () => {
        if (refreshIv.current) clearInterval(refreshIv.current);
      };
    } else if (refreshIv.current) {
      clearInterval(refreshIv.current);
      refreshIv.current = null;
    }
  }, [autoRefresh, fetchLogs]);

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clickTrace = (tid: string | null | undefined) => {
    if (!tid) return;
    setTraceFilter(tid);
  };

  // Trigger fetch on Enter in the search box.
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") fetchLogs();
  };

  if (loading) return null;
  if (!user) return <LoginOverlay />;

  return (
    <div
      style={{
        padding: isEmbed ? 12 : 20,
        color: "#e2e8f0",
        fontSize: 13,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SvgSprite />
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="chart" size={20} />
        Logs
      </h1>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
        Cloud Logging trace stream for ZingBee Ultra. Filter by trace_id to
        follow a single request through HTTP &rarr; LLM &rarr; DB &rarr; state machine.
      </div>

      {/* Filter row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Full-text search…"
          style={inputStyle(220)}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value)} style={inputStyle(130)}>
          <option value="">Any level</option>
          {["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((s) => (
            <option key={s} value={s}>{s}+</option>
          ))}
        </select>
        <select value={event} onChange={(e) => setEvent(e.target.value)} style={inputStyle(200)}>
          <option value="">Any event</option>
          {knownEvents.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
        <input
          value={traceFilter}
          onChange={(e) => setTraceFilter(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="trace_id"
          style={inputStyle(220)}
        />
        <input
          value={studentFilter}
          onChange={(e) => setStudentFilter(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="student_id"
          style={inputStyle(220)}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {WINDOW_PRESETS.map((w) => (
            <button
              key={w.label}
              onClick={() => setMinutes(w.minutes)}
              style={{
                ...btnStyle,
                background: minutes === w.minutes ? "#1e293b" : "#0f172a",
                color: minutes === w.minutes ? "#fff" : "#94a3b8",
                fontWeight: minutes === w.minutes ? 600 : 400,
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button onClick={fetchLogs} style={{ ...primaryBtn, display: "inline-flex", alignItems: "center", gap: 6 }} disabled={busy}>
          <Icon name="refresh" size={12} />
          {busy ? "Loading…" : "Refresh"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh 5s
        </label>
        {traceFilter && (
          <button onClick={() => setTraceFilter("")} style={{ ...btnStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="trash" size={11} /> clear trace
          </button>
        )}
      </div>

      {err && (
        <div
          style={{
            background: "#3f1d1d",
            color: "#fecaca",
            padding: 8,
            borderRadius: 4,
            marginBottom: 8,
          }}
        >
          {err}
        </div>
      )}

      <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6 }}>
        {entries.length} entries (newest first)
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          border: "1px solid #1e293b",
          borderRadius: 4,
          background: "#0b1220",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, background: "#0f172a", zIndex: 1 }}>
            <tr>
              <th style={thStyle(28)}></th>
              <th style={thStyle(140)}>Time</th>
              <th style={thStyle(95)}>Severity</th>
              <th style={thStyle(170)}>Event</th>
              <th style={thStyle(120)}>Trace</th>
              <th style={thStyle(120)}>Student</th>
              <th style={thStyle(undefined)}>Summary</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isOpen = expanded.has(e.insert_id);
              return (
                <>
                  <tr
                    key={e.insert_id}
                    onClick={() => toggleRow(e.insert_id)}
                    style={{
                      cursor: "pointer",
                      borderBottom: "1px solid #1e293b",
                      background: isOpen ? "#0f1a30" : "transparent",
                    }}
                  >
                    <td style={{ ...tdStyle, textAlign: "center", color: "#64748b" }}>
                      <span style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .12s" }}>
                        <Icon name="play" size={9} />
                      </span>
                    </td>
                    <td style={tdStyle}>{e.timestamp ? e.timestamp.slice(11, 23) : "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        background: SEVERITY_COLORS[e.severity] || "#94a3b8",
                        marginRight: 6, verticalAlign: "middle",
                      }} />
                      <span style={{ color: SEVERITY_COLORS[e.severity] || "#94a3b8" }}>{e.severity}</span>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "monospace" }}>{e.event || "—"}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 10 }}>
                      {e.trace_id ? (
                        <span
                          onClick={(ev) => {
                            ev.stopPropagation();
                            clickTrace(e.trace_id);
                          }}
                          style={{ color: "#60a5fa", textDecoration: "underline" }}
                          title="Click to filter to this trace"
                        >
                          {e.trace_id.slice(0, 8)}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 10 }}>
                      {e.student_id ? (e.student_id as string).slice(0, 8) : "—"}
                    </td>
                    <td style={tdStyle}>{summarizeEntry(e)}</td>
                  </tr>
                  {isOpen && (
                    <tr key={e.insert_id + "-payload"}>
                      <td colSpan={7} style={{ background: "#020617", padding: 12 }}>
                        <pre
                          style={{
                            margin: 0,
                            color: "#a5b4fc",
                            fontSize: 11,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {!busy && entries.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                  No entries for these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Friendly per-event summary line so the table is scannable without opening rows.
function summarizeEntry(e: LogEntry): string {
  const p = e.payload || {};
  switch (e.event) {
    case "http.request_start":
      return `${p.method || ""} ${p.path || ""}`;
    case "http.request_end":
      return `${p.method || ""} ${p.path || ""} → ${p.status} (${p.duration_ms}ms)`;
    case "http.request_error":
      return `${p.method || ""} ${p.path || ""} → ERROR ${p.error || ""}`;
    case "llm.request":
      return `${p.api || "?"} ${p.model || ""} prev=${p.previous_response_id ? "yes" : "no"} msgs=${p.messages_sent_count ?? "?"}`;
    case "llm.response":
      return `${p.api || "?"} ${p.model || ""} pt=${p.prompt_tokens} ct=${p.completion_tokens} len=${p.response_length} (${p.duration_ms}ms)`;
    case "llm.error":
      return `${p.api || "?"} ${p.model || ""} ERROR: ${p.error}`;
    case "db.query":
      return `${p.op}: ${p.rows} rows (${p.duration_ms}ms) ${(p.sql || "").slice(0, 80)}`;
    case "db.query_error":
      return `${p.op}: ERROR ${p.error}`;
    case "session.message.user":
      return `user "${(p.preview || "").slice(0, 80)}" (${p.length} chars, phase=${p.phase})`;
    case "session.message.assistant":
      return `assistant "${(p.preview || "").slice(0, 80)}" (${p.length} chars${p.is_empty ? ", EMPTY" : ""}, phase=${p.phase})`;
    case "engine.transition":
      return `${p.interaction_type} during ${p.from_phase} → ${p.to_phase} (${p.action})`;
    default:
      return (p.message || JSON.stringify(p)).toString().slice(0, 200);
  }
}

const inputStyle = (w?: number): React.CSSProperties => ({
  background: "#0f172a",
  border: "1px solid #334155",
  color: "#e2e8f0",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 12,
  width: w,
});

const btnStyle: React.CSSProperties = {
  background: "#0f172a",
  border: "1px solid #334155",
  color: "#94a3b8",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 12,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  ...btnStyle,
  background: "#1d4ed8",
  border: "1px solid #1e40af",
  color: "#fff",
};

const thStyle = (w?: number): React.CSSProperties => ({
  textAlign: "left",
  padding: "8px 10px",
  fontWeight: 600,
  fontSize: 11,
  color: "#94a3b8",
  borderBottom: "1px solid #1e293b",
  width: w,
});

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  verticalAlign: "top",
  color: "#cbd5e1",
};

export default function LogsPage() {
  return (
    <Suspense fallback={null}>
      <LogsInner />
    </Suspense>
  );
}
