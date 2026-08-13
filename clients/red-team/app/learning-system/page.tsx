"use client";

import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { SvgSprite } from "@/components/ui/Icon";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import * as d3 from "d3";
import dagre from "dagre";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));
const DiffEditor = lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })));

interface PromptVersion {
  id: string;
  content_hash: string;
  author: string | null;
  source: string;
  note: string | null;
  is_live: boolean;
  created_at: string | null;
}

interface LearningSystem {
  id: string;
  name: string;
  decision_tree: Record<string, any>;
  create_date: string | null;
}

// Colors grouped by role
const STATE_COLORS: Record<string, string> = {
  SESSION_START: "#3b82f6",
  RECALL: "#8b5cf6",
  TEACH: "#22c55e",
  RESOLVE_SCAFFOLD_POSITION: "#6b7280",
  TRY: "#f59e0b",
  TRY_RETEACH_CYCLE: "#ef4444",
  ADVANCE_FACT: "#6b7280",
  CHECK: "#06b6d4",
  CHECK_REMEDIATION: "#ef4444",
  ADVANCE_BATCH: "#6b7280",
  EVIDENCE: "#ec4899",
  FORFEIT_CONFIRMATION: "#f97316",
  MOVE_ON_TEACH: "#94a3b8",
  MOVE_ON_TRY: "#94a3b8",
  CAPSULE_COMPLETE: "#10b981",
};

const DISPLAY_NAMES: Record<string, string> = {
  SESSION_START: "Session Start",
  RECALL: "Recall",
  TEACH: "Teach",
  RESOLVE_SCAFFOLD_POSITION: "Scaffold Router",
  TRY: "Try",
  TRY_RETEACH_CYCLE: "Re-teach Cycle",
  ADVANCE_FACT: "Advance Fact",
  CHECK: "Check",
  CHECK_REMEDIATION: "Remediation",
  ADVANCE_BATCH: "Advance Batch",
  EVIDENCE: "Evidence",
  FORFEIT_CONFIRMATION: "Forfeit?",
  MOVE_ON_TEACH: "Move On (Teach)",
  MOVE_ON_TRY: "Move On (Try)",
  CAPSULE_COMPLETE: "Capsule Complete",
};

interface GraphEdge { source: string; target: string; label: string }

function extractEdges(states: Record<string, any>): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const added = new Set<string>();

  const scan = (node: any, stateId: string, context: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((item) => scan(item, stateId, context)); return; }
    const t = node.target || node.next_step || null;
    if (t && typeof t === "string" && t in states) {
      const key = `${stateId}-${t}`;
      if (!added.has(key)) {
        added.add(key);
        const label = (node.condition || context || "").replace(/student\.|== true|== false|is_/g, "").replace(/_/g, " ").trim();
        edges.push({ source: stateId, target: t, label: label.length > 35 ? label.slice(0, 33) + ".." : label });
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === "target" || k === "next_step") continue;
      if (v && typeof v === "object") scan(v, stateId, k);
    }
  };

  for (const [stateId, stateDef] of Object.entries(states)) {
    if (!stateDef || typeof stateDef !== "object") continue;
    scan(stateDef, stateId, "");
  }
  return edges;
}

// Main flow order derived from the state machine JSON.
// Center column = happy path. Left = bail-outs. Right = practice/retry.
const FLOW_POSITIONS: Record<string, { col: number; row: number }> = {
  SESSION_START:             { col: 1, row: 0 },
  RECALL:                    { col: 0, row: 1 },
  TEACH:                     { col: 1, row: 2 },
  RESOLVE_SCAFFOLD_POSITION: { col: 2, row: 3 },
  TRY:                       { col: 2, row: 4 },
  TRY_RETEACH_CYCLE:         { col: 3, row: 4 },
  MOVE_ON_TEACH:             { col: 0, row: 3 },
  MOVE_ON_TRY:               { col: 3, row: 5 },
  ADVANCE_FACT:              { col: 1, row: 5 },
  CHECK:                     { col: 1, row: 6 },
  CHECK_REMEDIATION:         { col: 2, row: 7 },
  FORFEIT_CONFIRMATION:      { col: 0, row: 7 },
  ADVANCE_BATCH:             { col: 1, row: 8 },
  EVIDENCE:                  { col: 1, row: 9 },
  CAPSULE_COMPLETE:          { col: 1, row: 10 },
};

function buildLayout(stateIds: string[]) {
  const COL_WIDTH = 220, ROW_HEIGHT = 90, NODE_W = 160, NODE_H = 44, PAD = 60;
  const nodePositions: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let maxCol = 0, maxRow = 0;
  for (const id of stateIds) {
    const fp = FLOW_POSITIONS[id] || { col: 0, row: 0 };
    nodePositions[id] = { x: PAD + fp.col * COL_WIDTH, y: PAD + fp.row * ROW_HEIGHT, w: NODE_W, h: NODE_H };
    maxCol = Math.max(maxCol, fp.col);
    maxRow = Math.max(maxRow, fp.row);
  }
  return { nodePositions, graphWidth: PAD * 2 + (maxCol + 1) * COL_WIDTH, graphHeight: PAD * 2 + (maxRow + 1) * ROW_HEIGHT };
}

function D3Graph({ states, onNodeClick, selectedNode }: { states: Record<string, any>; onNodeClick: (id: string) => void; selectedNode: string | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || Object.keys(states).length === 0) return;

    const stateIds = Object.keys(states);
    const edges = extractEdges(states);
    const { nodePositions, graphWidth, graphHeight } = buildLayout(stateIds);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg.attr("width", "100%").attr("height", "100%");

    // Defs: arrow markers and drop shadow
    const defs = svg.append("defs");
    defs.append("marker").attr("id", "arrow-gray").attr("viewBox", "0 0 10 6").attr("refX", 10).attr("refY", 3)
      .attr("markerWidth", 8).attr("markerHeight", 6).attr("orient", "auto")
      .append("path").attr("d", "M0,0 L10,3 L0,6 Z").attr("fill", "#64748b");
    defs.append("marker").attr("id", "arrow-green").attr("viewBox", "0 0 10 6").attr("refX", 10).attr("refY", 3)
      .attr("markerWidth", 8).attr("markerHeight", 6).attr("orient", "auto")
      .append("path").attr("d", "M0,0 L10,3 L0,6 Z").attr("fill", "#4ade80");
    defs.append("marker").attr("id", "arrow-red").attr("viewBox", "0 0 10 6").attr("refX", 10).attr("refY", 3)
      .attr("markerWidth", 8).attr("markerHeight", 6).attr("orient", "auto")
      .append("path").attr("d", "M0,0 L10,3 L0,6 Z").attr("fill", "#f87171");

    const filter = defs.append("filter").attr("id", "glow").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
    filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
    filter.append("feMerge").selectAll("feMergeNode").data(["blur", "SourceGraphic"]).enter()
      .append("feMergeNode").attr("in", (d) => d);

    const g = svg.append("g");

    // Zoom/pan
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 3]).on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom);
    // Fit to container
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const scale = Math.min(cw / graphWidth, ch / graphHeight, 1) * 0.9;
    const tx = (cw - graphWidth * scale) / 2;
    const ty = (ch - graphHeight * scale) / 2;
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    // Store mutable positions for dragging
    const positions: Record<string, { x: number; y: number; w: number; h: number }> = JSON.parse(JSON.stringify(nodePositions));

    const edgesGroup = g.append("g").attr("class", "edges");
    const labelsGroup = g.append("g").attr("class", "edge-labels");
    const nodesGroup = g.append("g").attr("class", "nodes");

    const isRouter = (id: string) => ["ADVANCE_FACT", "ADVANCE_BATCH", "RESOLVE_SCAFFOLD_POSITION"].includes(id);

    // Function to redraw all edges + labels
    const redrawEdges = () => {
      edgesGroup.selectAll("*").remove();
      labelsGroup.selectAll("*").remove();

      const line = d3.line<{ x: number; y: number }>().x((d) => d.x).y((d) => d.y).curve(d3.curveBasis);

      for (const edge of edges) {
        const src = positions[edge.source];
        const tgt = positions[edge.target];
        if (!src || !tgt) continue;

        const isError = edge.label.includes("incorrect") || edge.label.includes("confused") || edge.label.includes("forfeit") || edge.label.includes("failed");
        const isSuccess = edge.label.includes("correct") || edge.label.includes("complete") || edge.label.includes("advance") || edge.label.includes("passed") || edge.label.includes("all asked");
        const color = isError ? "#f87171" : isSuccess ? "#4ade80" : "#64748b";
        const marker = isError ? "url(#arrow-red)" : isSuccess ? "url(#arrow-green)" : "url(#arrow-gray)";

        const srcCx = src.x + src.w / 2, srcCy = src.y + src.h / 2;
        const tgtCx = tgt.x + tgt.w / 2, tgtCy = tgt.y + tgt.h / 2;
        const goingDown = tgtCy > srcCy + 5;
        const goingUp = !goingDown;

        // Connect points: exit from appropriate side, enter appropriate side
        let x1: number, y1: number, x2: number, y2: number;
        if (goingDown) {
          x1 = srcCx; y1 = src.y + src.h;  // bottom center
          x2 = tgtCx; y2 = tgt.y;          // top center
        } else {
          // Going up or same level: exit side, enter side
          const srcRight = src.x + src.w;
          const tgtRight = tgt.x + tgt.w;
          const useLeft = srcCx > tgtCx;
          x1 = useLeft ? src.x : srcRight;
          y1 = srcCy;
          x2 = useLeft ? tgtRight : tgt.x;
          y2 = tgtCy;
        }

        // Simple bezier curve
        const path = goingDown
          ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
          : `M${x1},${y1} C${x1 + (goingUp ? (x1 > x2 ? -60 : 60) : 0)},${y1} ${x2 + (goingUp ? (x1 > x2 ? 60 : -60) : 0)},${y2} ${x2},${y2}`;

        edgesGroup.append("path")
          .attr("d", path)
          .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.5)
          .attr("marker-end", marker);

        // Edge label (decision/condition)
        if (edge.label) {
          const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2;
          const labelG = labelsGroup.append("g").attr("transform", `translate(${lx},${ly})`);
          const text = labelG.append("text").attr("text-anchor", "middle").attr("dy", "0.35em")
            .attr("font-size", 8).attr("font-family", "Inter, system-ui, sans-serif").attr("fill", color).attr("font-weight", 500).text(edge.label);
          const bbox = (text.node() as SVGTextElement).getBBox();
          labelG.insert("rect", "text").attr("x", bbox.x - 5).attr("y", bbox.y - 2)
            .attr("width", bbox.width + 10).attr("height", bbox.height + 4)
            .attr("rx", 4).attr("fill", "#0f172a").attr("fill-opacity", 0.92).attr("stroke", `${color}33`).attr("stroke-width", 0.5);
        }
      }
    };

    // Draw edges first
    redrawEdges();

    // Draw nodes (with drag behavior)
    for (const id of stateIds) {
      const pos = positions[id];
      if (!pos) continue;
      const color = STATE_COLORS[id] || "#334155";
      const name = DISPLAY_NAMES[id] || id.replace(/_/g, " ");

      const nodeG = nodesGroup.append("g")
        .datum(id)
        .attr("transform", `translate(${pos.x},${pos.y})`)
        .style("cursor", "grab");

      // Drag behavior with click detection
      let dragged = false;
      const drag = d3.drag<SVGGElement, string>()
        .on("start", function() { dragged = false; d3.select(this).style("cursor", "grabbing").raise(); })
        .on("drag", function(event, nodeId) {
          dragged = true;
          positions[nodeId].x += event.dx;
          positions[nodeId].y += event.dy;
          d3.select(this).attr("transform", `translate(${positions[nodeId].x},${positions[nodeId].y})`);
          redrawEdges();
        })
        .on("end", function(_, nodeId) {
          d3.select(this).style("cursor", "grab");
          if (!dragged) onNodeClick(nodeId);
        });

      nodeG.call(drag);

      if (id === "SESSION_START" || id === "CAPSULE_COMPLETE") {
        nodeG.append("rect").attr("width", pos.w).attr("height", pos.h).attr("rx", pos.h / 2).attr("ry", pos.h / 2)
          .attr("fill", color).attr("stroke", color).attr("stroke-width", 2)
          .attr("filter", "url(#glow)").attr("data-default-stroke", color);
      } else if (isRouter(id)) {
        const cx = pos.w / 2, cy = pos.h / 2;
        nodeG.append("polygon")
          .attr("points", `${cx},0 ${pos.w},${cy} ${cx},${pos.h} 0,${cy}`)
          .attr("fill", `${color}44`).attr("stroke", color).attr("stroke-width", 1).attr("stroke-dasharray", "4,2")
          .attr("data-default-stroke", color);
      } else {
        nodeG.append("rect").attr("width", pos.w).attr("height", pos.h).attr("rx", 8).attr("ry", 8)
          .attr("fill", color).attr("stroke", `${color}66`).attr("stroke-width", 1)
          .attr("opacity", 0.95).attr("data-default-stroke", `${color}66`);
      }

      nodeG.append("text").attr("x", pos.w / 2).attr("y", pos.h / 2).attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("font-size", isRouter(id) ? 9 : 11).attr("font-weight", 700).attr("fill", isRouter(id) ? "#94a3b8" : "#fff")
        .attr("letter-spacing", "0.03em").attr("pointer-events", "none").text(name);
    }

  }, [states, onNodeClick]);

  // Highlight selected node without redrawing or changing zoom/position
  useEffect(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current).select("g.nodes")
      .selectAll<SVGGElement, string>("g").each(function(nodeId) {
        const shape = d3.select(this).select("rect, polygon");
        const defaultStroke = shape.attr("data-default-stroke") || "#334155";
        shape
          .attr("stroke", nodeId === selectedNode ? "#fff" : defaultStroke)
          .attr("stroke-width", nodeId === selectedNode ? 2.5 : (shape.node()?.tagName === "polygon" ? 1 : shape.attr("filter") ? 2 : 1));
      });
  }, [selectedNode]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", background: "#0f172a" }}>
      <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export default function LearningSystemPage() {
  const { user, loading: authLoading } = useAuth();
  const [systems, setSystems] = useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [system, setSystem] = useState<LearningSystem | null>(null);
  const [states, setStates] = useState<Record<string, any>>({});

  // Side panel
  const [panelWidth, setPanelWidth] = useState(500);
  const [panelTab, setPanelTab] = useState<"prompts" | "config">("prompts");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [promptText, setPromptText] = useState("");
  const [saving, setSaving] = useState(false);

  // Prompt version history (Track A1b)
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [diffVersion, setDiffVersion] = useState<{ id: string; content: string } | null>(null);
  // Which side the diff's right pane shows: the unsaved editor draft, or the live prompt.
  const [diffAgainst, setDiffAgainst] = useState<"draft" | "live">("draft");
  const [restoring, setRestoring] = useState(false);
  // Visible feedback for the mutating actions (Save / Restore) — never fail silently.
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Load system list
  useEffect(() => {
    if (!user) return;
    apiFetch<{ id: string; name: string }[]>("/api/learning-systems").then((data) => {
      setSystems(data);
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
    }).catch(() => {});
  }, [user]);

  // Load selected system
  useEffect(() => {
    if (!selectedId) return;
    apiFetch<LearningSystem>(`/api/learning-system/${selectedId}`).then((data) => {
      setSystem(data);
      setStates(data.decision_tree?.states || {});
    }).catch(() => {});
  }, [selectedId]);

  // Node click -> show state details + prompts
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNode(nodeId);
    setSelectedPrompt(null);
  }, []);

  // State-specific prompts
  const statePrompts = useMemo(() => {
    if (!selectedNode || !system) return [];
    const state = system.decision_tree?.states?.[selectedNode];
    const registry = system.decision_tree?.prompt_registry || {};
    const allPromptIds = Object.keys(registry);
    const found: string[] = [];

    // 1. Scan the state JSON for explicit prompt/prompt_template references
    if (state) {
      const scan = (obj: any) => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) { obj.forEach(scan); return; }
        if (obj.prompt && typeof obj.prompt === "string") found.push(obj.prompt);
        if (obj.prompt_template && typeof obj.prompt_template === "string") found.push(obj.prompt_template);
        Object.values(obj).forEach(scan);
      };
      scan(state);
    }

    // 2. Match by naming convention: step_teach, step_teach_*, start_*, etc.
    const nodeKey = selectedNode.toLowerCase();
    const prefixes = [
      `step_${nodeKey}`,
      `start_${nodeKey}`,
      nodeKey,
    ];
    for (const pid of allPromptIds) {
      if (prefixes.some((p) => pid === p || pid.startsWith(`${p}_`))) found.push(pid);
    }

    // 3. Special mappings
    const EXTRA_MAP: Record<string, string[]> = {
      SESSION_START: allPromptIds.filter((p) => p.startsWith("start_")),
      TEACH: allPromptIds.filter((p) => p.startsWith("step_teach")),
      TRY: allPromptIds.filter((p) => p.startsWith("step_try")),
      CHECK: allPromptIds.filter((p) => p.startsWith("step_check")),
      EVIDENCE: allPromptIds.filter((p) => p.startsWith("step_evidence")),
      RECALL: allPromptIds.filter((p) => p.includes("recall")),
    };
    if (EXTRA_MAP[selectedNode]) found.push(...EXTRA_MAP[selectedNode]);

    return [...new Set(found)].filter((p) => p in registry).sort();
  }, [selectedNode, system]);

  // Prompt categories
  const promptCategories = useMemo(() => {
    if (!system) return [];
    const registry = system.decision_tree?.prompt_registry || {};
    const cats: Record<string, string[]> = {};
    for (const pid of Object.keys(registry).sort()) {
      const cat = pid.startsWith("step_") ? "Steps" : pid.startsWith("start_") ? "Session Start" : pid.startsWith("assessment") || pid.startsWith("classifier") ? "Assessment" : "Other";
      (cats[cat] ||= []).push(pid);
    }
    return Object.entries(cats).map(([label, prompts]) => ({ label, prompts }));
  }, [system]);

  // Select prompt
  const handlePromptSelect = useCallback((pid: string) => {
    if (!system) return;
    setSelectedPrompt(pid);
    setPromptText(system.decision_tree?.prompt_registry?.[pid]?.template || "");
  }, [system]);

  // Prompt version history: load, diff, restore (Track A1b)
  const loadVersions = useCallback(async () => {
    if (!selectedId || !selectedPrompt) { setVersions([]); return; }
    try {
      const v = await apiFetch<PromptVersion[]>(`/api/learning-system/${selectedId}/prompt/${selectedPrompt}/versions`);
      setVersions(v);
    } catch { setVersions([]); }
  }, [selectedId, selectedPrompt]);

  // Reload history whenever the selected prompt changes; clear any open diff + stale notice.
  useEffect(() => { setDiffVersion(null); setNotice(null); loadVersions(); }, [loadVersions]);

  // True when the editor draft differs from the live template (unsaved work).
  const liveTemplate = (selectedPrompt && system?.decision_tree?.prompt_registry?.[selectedPrompt]?.template) || "";
  const isDirty = !!selectedPrompt && promptText !== liveTemplate;

  const handleDiff = useCallback(async (versionId: string) => {
    try {
      const v = await apiFetch<{ content: string }>(`/api/learning-system/prompt-version/${versionId}`);
      setDiffVersion({ id: versionId, content: v.content });
    } catch (e) {
      console.error("Load version failed:", e);
      setNotice({ kind: "err", text: "Couldn't load that version for diff." });
    }
  }, []);

  const handleRestore = useCallback(async (versionId: string) => {
    if (!selectedId || !selectedPrompt) return;
    // Destructive: overwrites the LIVE prompt the tutor serves to students right now.
    const dirtyWarn = isDirty
      ? "\n\nYou also have UNSAVED edits in the editor — they will be discarded."
      : "";
    if (!window.confirm(
      `Restore this version?\n\nThis immediately overwrites the LIVE "${selectedPrompt.replace(/_/g, " ")}" `
      + `prompt that the tutor is serving to students.${dirtyWarn}`)) {
      return;
    }
    setRestoring(true);
    setNotice(null);
    try {
      await apiFetch(`/api/learning-system/prompt-version/${versionId}/restore`, { method: "POST" });
      // Reload the system so the live template reflects the restore, then refresh editor + history.
      const data = await apiFetch<LearningSystem>(`/api/learning-system/${selectedId}`);
      setSystem(data);
      setPromptText(data.decision_tree?.prompt_registry?.[selectedPrompt]?.template || "");
      setDiffVersion(null);
      await loadVersions();
      setNotice({ kind: "ok", text: "Restored — this version is now live." });
    } catch (e) {
      console.error("Restore failed:", e);
      setNotice({ kind: "err", text: "Restore failed — the live prompt was NOT changed. Retry?" });
    } finally { setRestoring(false); }
  }, [selectedId, selectedPrompt, isDirty, loadVersions]);

  // Save prompt
  const handleSavePrompt = useCallback(async () => {
    if (!selectedId || !system || !selectedPrompt) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiFetch(`/api/learning-system/${selectedId}/prompt/${selectedPrompt}`, {
        method: "PUT",
        body: JSON.stringify({ template: promptText }),
      });
      const dt = { ...system.decision_tree };
      if (dt.prompt_registry?.[selectedPrompt]) dt.prompt_registry[selectedPrompt].template = promptText;
      setSystem({ ...system, decision_tree: dt });
      await loadVersions();
      setNotice({ kind: "ok", text: "Saved — now live." });
    } catch (e) {
      console.error("Save failed:", e);
      setNotice({ kind: "err", text: "Save failed — the live prompt was NOT changed. Retry?" });
    } finally {
      setSaving(false);
    }
  }, [selectedId, system, selectedPrompt, promptText, loadVersions]);

  // Save LLM config
  const handleSaveConfig = useCallback(async (role: string, field: string, value: any) => {
    if (!selectedId || !system) return;
    const dt = { ...system.decision_tree };
    if (!dt.config) dt.config = {};
    if (!dt.config.llm_roles) dt.config.llm_roles = {};
    if (!dt.config.llm_roles[role]) dt.config.llm_roles[role] = {};
    dt.config.llm_roles[role][field] = value;
    try {
      await apiFetch(`/api/learning-system/${selectedId}`, {
        method: "PUT",
        body: JSON.stringify({ decision_tree: dt }),
      });
      setSystem({ ...system, decision_tree: dt });
    } catch (e) {
      console.error("Config save failed:", e);
    }
  }, [selectedId, system]);

  // All prompts flat
  const allPrompts = useMemo(() => {
    if (!system) return [];
    return Object.keys(system.decision_tree?.prompt_registry || {}).sort();
  }, [system]);

  if (authLoading) return null;
  if (!user) return <LoginOverlay />;

  const edgeCount = extractEdges(states).length;

  return (
    <>
      <SvgSprite />
      <div style={{ display: "flex", height: "100vh", background: "#0f172a", color: "#e2e8f0" }}>
        {/* D3 Graph Canvas */}
        <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
              style={{ padding: "6px 10px", background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12 }}>
              {systems.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {Object.keys(states).length} states, {edgeCount} transitions
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <D3Graph states={states} onNodeClick={handleNodeClick} selectedNode={selectedNode} />
          </div>
        </div>

        {/* Resize handle */}
        <div
          style={{ width: 4, cursor: "col-resize", background: "transparent", flexShrink: 0 }}
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = panelWidth;
            const onMove = (ev: MouseEvent) => setPanelWidth(Math.max(300, Math.min(900, startW + (startX - ev.clientX))));
            const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#3b82f6"; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
        />

        {/* Right Panel: Prompt Browser + Editor + Config */}
        <div style={{ width: panelWidth, borderLeft: "1px solid #1e293b", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tab header */}
          <div style={{ display: "flex", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
            <button onClick={() => setPanelTab("prompts")}
              style={{ flex: 1, padding: "10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: panelTab === "prompts" ? "#1e293b" : "transparent",
                color: panelTab === "prompts" ? "#e2e8f0" : "#64748b",
                border: "none", borderBottom: panelTab === "prompts" ? "2px solid #3b82f6" : "2px solid transparent" }}>
              Prompts
            </button>
            <button onClick={() => setPanelTab("config")}
              style={{ flex: 1, padding: "10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: panelTab === "config" ? "#1e293b" : "transparent",
                color: panelTab === "config" ? "#e2e8f0" : "#64748b",
                border: "none", borderBottom: panelTab === "config" ? "2px solid #3b82f6" : "2px solid transparent" }}>
              LLM Config
            </button>
          </div>

          {panelTab === "config" && system && (
            <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
              {Object.entries(system.decision_tree?.config?.llm_roles || {}).map(([role, cfg]: [string, any]) => (
                <div key={role} style={{ marginBottom: 20, padding: 12, background: "#1e293b", borderRadius: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    {role.replace(/_/g, " ")}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>{cfg.purpose || ""}</div>
                  {cfg.temperature !== undefined && cfg.temperature !== null && (
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 10, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8 }}>
                        Temperature
                        <span style={{ color: "#60a5fa", fontFamily: "monospace", minWidth: 30 }}>{cfg.temperature}</span>
                        <input type="range" min="0" max="2" step="0.1" value={cfg.temperature}
                          onChange={(e) => handleSaveConfig(role, "temperature", parseFloat(e.target.value))}
                          style={{ flex: 1, accentColor: "#60a5fa" }} />
                      </label>
                    </div>
                  )}
                  {cfg.max_tokens !== undefined && cfg.max_tokens !== null && (
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 10, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8 }}>
                        Max Tokens
                        <input type="number" min="50" max="32000" step="50" value={cfg.max_tokens}
                          onChange={(e) => handleSaveConfig(role, "max_tokens", parseInt(e.target.value) || 4096)}
                          style={{ width: 80, padding: "3px 6px", background: "#0f172a", border: "1px solid #334155",
                            borderRadius: 3, color: "#e2e8f0", fontSize: 11, textAlign: "center" }} />
                      </label>
                    </div>
                  )}
                  <div style={{ marginBottom: 4 }}>
                    <label style={{ fontSize: 10, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8 }}>
                      Model
                      <input type="text" value={cfg.model || ""}
                        onChange={(e) => handleSaveConfig(role, "model", e.target.value)}
                        style={{ flex: 1, padding: "3px 6px", background: "#0f172a", border: "1px solid #334155",
                          borderRadius: 3, color: "#e2e8f0", fontSize: 11 }}
                        placeholder="e.g. grok-4-1-fast-reasoning" />
                    </label>
                  </div>
                  {cfg.stateless !== undefined && (
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
                      {cfg.stateless ? "Stateless" : "Stateful (history preserved)"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {panelTab === "prompts" && (
            <>
              <div style={{ padding: "8px 16px", borderBottom: "1px solid #1e293b", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {selectedNode ? (DISPLAY_NAMES[selectedNode] || selectedNode.replace(/_/g, " ")) : "All Prompts"}
                </span>
                {selectedNode && (
                  <button onClick={() => { setSelectedNode(null); setSelectedPrompt(null); }}
                    style={{ fontSize: 10, color: "#94a3b8", background: "none", border: "1px solid #334155", borderRadius: 3, padding: "2px 8px", cursor: "pointer" }}>
                    Show All
                  </button>
                )}
              </div>
              <div style={{ padding: "4px 0", borderBottom: "1px solid #1e293b", flexShrink: 0, maxHeight: 240, overflowY: "auto" }}>
                {(selectedNode ? [{ label: DISPLAY_NAMES[selectedNode] || selectedNode.replace(/_/g, " "), prompts: statePrompts }] : promptCategories).map((cat) => (
                  <div key={cat.label}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", padding: "6px 16px 2px" }}>
                      {cat.label}
                    </div>
                    {cat.prompts.map((pid) => {
                      const tmpl = system?.decision_tree?.prompt_registry?.[pid]?.template || "";
                      return (
                        <div key={pid} onClick={() => handlePromptSelect(pid)}
                          style={{ padding: "3px 16px 3px 24px", fontSize: 11, cursor: "pointer",
                            background: selectedPrompt === pid ? "#1e293b" : "transparent",
                            color: selectedPrompt === pid ? "#e2e8f0" : "#94a3b8",
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            borderLeft: selectedPrompt === pid ? "2px solid #3b82f6" : "2px solid transparent" }}>
                          <span>{pid.replace(/_/g, " ")}</span>
                          <span style={{ fontSize: 9, color: "#475569" }}>{tmpl.length > 0 ? `${tmpl.length}` : "empty"}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {selectedPrompt ? (
                  <>
                    <div style={{ padding: "8px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {selectedPrompt.replace(/_/g, " ")}
                        {isDirty && <span title="Unsaved changes — not live until you Save"
                          style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: "#f59e0b" }}>● unsaved</span>}
                      </span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button onClick={() => setShowHistory((s) => !s)}
                          aria-expanded={showHistory} aria-controls="version-history-panel"
                          style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600,
                            background: showHistory ? "#1e293b" : "transparent", color: "#94a3b8",
                            border: "1px solid #334155", borderRadius: 4, cursor: "pointer" }}>
                          {showHistory ? "▾" : "▸"} History ({versions.length})
                        </button>
                        <button onClick={handleSavePrompt} disabled={saving}
                          style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600,
                            background: saving ? "#334155" : "#22c55e", color: "#fff",
                            border: "none", borderRadius: 4, cursor: "pointer" }}>
                          {saving ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                    {notice && (
                      <div role="status" style={{ padding: "6px 16px", fontSize: 11, flexShrink: 0,
                        borderBottom: "1px solid #1e293b",
                        background: notice.kind === "ok" ? "#0f2a1a" : "#2a0f12",
                        color: notice.kind === "ok" ? "#4ade80" : "#f87171" }}>
                        {notice.text}
                      </div>
                    )}
                    {showHistory && (
                      <div id="version-history-panel" role="list"
                        style={{ maxHeight: 180, overflowY: "auto", borderBottom: "1px solid #1e293b", background: "#0b1220", flexShrink: 0 }}>
                        {versions.length === 0 ? (
                          <div style={{ padding: 12, color: "#94a3b8", fontSize: 12 }}>No versions yet — saving an edit creates the first.</div>
                        ) : versions.map((v) => (
                          <div key={v.id} role="listitem" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 16px", borderBottom: "1px solid #0f172a", fontSize: 11 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ color: "#cbd5e1" }}>
                                {v.is_live && <span style={{ color: "#22c55e", fontWeight: 700, marginRight: 6 }}>
                                  <span aria-hidden="true">●</span> LIVE</span>}
                                <span aria-label={`source ${v.source}`} style={{ color: "#94a3b8" }}>{v.source}</span> · {v.author || "unknown"}
                              </span>
                              <span style={{ color: "#94a3b8" }}>
                                {v.created_at ? new Date(v.created_at).toLocaleString() : ""} · {v.content_hash}{v.note ? ` · ${v.note}` : ""}
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => handleDiff(v.id)} title="Compare this version against your draft or the live prompt"
                                style={{ padding: "3px 8px", fontSize: 10, background: "transparent", color: "#60a5fa", border: "1px solid #334155", borderRadius: 4, cursor: "pointer" }}>
                                Diff
                              </button>
                              <button onClick={() => handleRestore(v.id)} disabled={restoring || v.is_live}
                                aria-disabled={restoring || v.is_live}
                                title={v.is_live ? "This is the current live version" : "Make this version the live prompt"}
                                style={{ padding: "3px 8px", fontSize: 10, background: "transparent",
                                  color: v.is_live ? "#64748b" : "#f59e0b", border: "1px solid #334155", borderRadius: 4,
                                  cursor: v.is_live ? "default" : "pointer" }}>
                                {v.is_live ? "current" : "Restore"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <Suspense fallback={<div style={{ padding: 20, color: "#64748b" }}>Loading...</div>}>
                        {diffVersion ? (
                          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                            <div style={{ padding: "4px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0b1220", fontSize: 11, color: "#94a3b8" }}>
                              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span>Diff: selected version (left) &rarr; {diffAgainst === "live" ? "LIVE prompt" : "your draft"} (right)</span>
                                <span style={{ display: "flex", gap: 4 }}>
                                  {(["draft", "live"] as const).map((opt) => (
                                    <button key={opt} onClick={() => setDiffAgainst(opt)}
                                      style={{ padding: "1px 6px", fontSize: 10, borderRadius: 3, cursor: "pointer",
                                        border: "1px solid #334155",
                                        background: diffAgainst === opt ? "#1e293b" : "transparent",
                                        color: diffAgainst === opt ? "#e2e8f0" : "#64748b" }}>
                                      {opt === "draft" ? "vs draft" : "vs live"}
                                    </button>
                                  ))}
                                </span>
                              </span>
                              <button onClick={() => setDiffVersion(null)}
                                style={{ padding: "2px 8px", fontSize: 10, background: "transparent", color: "#94a3b8", border: "1px solid #334155", borderRadius: 4, cursor: "pointer" }}>
                                Close diff
                              </button>
                            </div>
                            <div style={{ flex: 1 }}>
                              <DiffEditor
                                height="100%"
                                language={promptText.includes("<") ? "xml" : "plaintext"}
                                original={diffVersion.content}
                                modified={diffAgainst === "live" ? liveTemplate : promptText}
                                theme="vs-dark"
                                options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: "on", readOnly: true, scrollBeyondLastLine: false, automaticLayout: true, renderSideBySide: true }}
                              />
                            </div>
                          </div>
                        ) : (
                          <MonacoEditor
                            height="100%"
                            language={promptText.includes("<") ? "xml" : "plaintext"}
                            value={promptText}
                            onChange={(v) => setPromptText(v || "")}
                            theme="vs-dark"
                            options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: "on", scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, contextmenu: true, mouseWheelZoom: true, folding: true, padding: { top: 8 } }}
                          />
                        )}
                      </Suspense>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: 20, color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
                    Click a state node to see its prompts, or select a prompt from the list above.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
