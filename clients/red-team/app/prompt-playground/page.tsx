"use client";

import { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { SvgSprite } from "@/components/ui/Icon";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import "@/styles/playground.css";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

interface Agent {
  id: string;
  name: string;
  model: string;
  temperature: number;
  max_tokens: number;
  prompts: Record<string, string>;
  role: string;
}

interface Model { id: string; name: string; }

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  fromLLM?: boolean; // true for LLM-generated responses
  thinking?: string; // reasoning tokens
}

interface Variable {
  key: string;
  value: string;
}

function resolvePrompt(template: string, vars: Variable[]): string {
  let result = template;
  for (const v of vars) {
    if (v.key) result = result.replaceAll(`$${v.key}`, v.value);
  }
  return result;
}

export default function PromptPlaygroundPage() {
  const { user, loading: authLoading } = useAuth();

  // Settings
  const [model, setModel] = useState("grok-4-1-fast-reasoning");
  const [temperature, setTemperature] = useState(0.5);
  const [topP, setTopP] = useState(1.0);
  const [maxTokens, setMaxTokens] = useState(4096);

  // Left pane: prompt editor
  const [editorContent, setEditorContent] = useState("You are a helpful assistant.");
  const [variables, setVariables] = useState<Variable[]>([]);

  // Agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedPromptKey, setSelectedPromptKey] = useState("");

  // Imagine
  const [imaginePrompt, setImaginePrompt] = useState("");
  const [imagineAspect, setImagineAspect] = useState("16:9");
  const [imagineUrl, setImagineUrl] = useState<string | null>(null);
  const [imagineLoading, setImagineLoading] = useState(false);
  const [imagineOpen, setImagineOpen] = useState(false);
  const [imagineError, setImagineError] = useState("");

  // Right pane: message builder
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputRole, setInputRole] = useState<"system" | "user" | "assistant">("user");
  const [inputText, setInputText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load agents and models
  useEffect(() => {
    if (!user) return;
    apiFetch<Agent[]>("/api/playground/agents").then(setAgents).catch(() => {});
    apiFetch<Model[]>("/api/playground/models").then(setModels).catch(() => {});
  }, [user]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Agent loading
  const handleAgentSelect = useCallback((agentId: string) => {
    setSelectedAgent(agentId);
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    setModel(agent.model);
    setTemperature(agent.temperature);
    setMaxTokens(agent.max_tokens);
    const keys = Object.keys(agent.prompts);
    if (keys.length > 0) {
      setSelectedPromptKey(keys[0]);
      setEditorContent(agent.prompts[keys[0]]);
    }
  }, [agents]);

  const handlePromptKeySelect = useCallback((key: string) => {
    setSelectedPromptKey(key);
    const agent = agents.find(a => a.id === selectedAgent);
    if (agent?.prompts[key]) setEditorContent(agent.prompts[key]);
  }, [agents, selectedAgent]);

  // Variables
  const addVariable = () => setVariables(v => [...v, { key: "", value: "" }]);
  const updateVariable = (i: number, field: "key" | "value", val: string) =>
    setVariables(v => v.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeVariable = (i: number) => setVariables(v => v.filter((_, idx) => idx !== i));

  const detectedVars = editorContent.match(/\$[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  const uniqueDetectedVars = [...new Set(detectedVars)];

  const autoAddVars = useCallback(() => {
    const existing = new Set(variables.map(v => "$" + v.key));
    const newVars = uniqueDetectedVars.filter(v => !existing.has(v));
    if (newVars.length > 0) {
      setVariables(prev => [...prev, ...newVars.map(v => ({ key: v.slice(1), value: "" }))]);
    }
  }, [uniqueDetectedVars, variables]);

  // Add message to conversation
  const addMessage = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setMessages(prev => [...prev, { role: inputRole, content: text }]);
    setInputText("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputText, inputRole]);

  // Send left pane content as a system message
  const sendEditorAsSystem = useCallback(() => {
    const resolved = resolvePrompt(editorContent, variables);
    if (!resolved.trim()) return;
    setMessages(prev => [...prev, { role: "system", content: resolved }]);
  }, [editorContent, variables]);

  // Remove a message
  const removeMessage = (i: number) => setMessages(prev => prev.filter((_, idx) => idx !== i));

  // Edit a message inline
  const editMessage = (i: number, content: string) =>
    setMessages(prev => prev.map((m, idx) => idx === i ? { ...m, content } : m));

  // Run: send all messages to LLM and stream response
  const handleRun = useCallback(async () => {
    if (streaming || messages.length === 0) return;
    setStreaming(true);

    // Resolve variables in all system messages
    const apiMessages = messages.map(m => ({
      role: m.role,
      content: m.role === "system" ? resolvePrompt(m.content, variables) : m.content,
    }));

    try {
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/playground/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            system_prompt: "", // system messages are already in the messages array
            messages: apiMessages,
            temperature,
            top_p: topP,
            max_tokens: maxTokens,
            model,
          }),
        }
      );

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();

      let assistantMsg = "";
      let thinkingMsg = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "thinking") {
              thinkingMsg += data.content;
            } else if (data.type === "token") {
              assistantMsg += data.content;
              // Update the streaming message in place
              setMessages(prev => {
                const base = prev.filter(m => !m.fromLLM || m.role !== "assistant" || prev.indexOf(m) !== prev.length - 1);
                // Remove last LLM message if updating
                const withoutLast = prev.length > 0 && prev[prev.length - 1].fromLLM
                  ? prev.slice(0, -1) : prev;
                return [...withoutLast, { role: "assistant", content: assistantMsg, fromLLM: true, thinking: thinkingMsg || undefined }];
              });
            } else if (data.type === "done") {
              setTotalTokens(t => t + (data.tokens || 0));
            } else if (data.type === "error") {
              setMessages(prev => [...prev, { role: "assistant", content: `Error: ${data.content}`, fromLLM: true }]);
            }
          } catch {}
        }
      }

      // Final set if we only got thinking but no content
      if (!assistantMsg && thinkingMsg) {
        setMessages(prev => [...prev, { role: "assistant", content: "(No content - only reasoning)", fromLLM: true, thinking: thinkingMsg }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : "unknown"}`, fromLLM: true }]);
    } finally {
      setStreaming(false);
    }
  }, [streaming, messages, variables, temperature, topP, maxTokens, model]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addMessage();
    }
  };

  const clearChat = () => { setMessages([]); setTotalTokens(0); };

  // Imagine
  const handleImagine = useCallback(async () => {
    if (!imaginePrompt.trim() || imagineLoading) return;
    setImagineLoading(true);
    setImagineUrl(null);
    try {
      const result = await apiFetch<{ success?: boolean; image_url?: string; error?: string }>(
        "/api/playground/imagine",
        { method: "POST", body: JSON.stringify({ prompt: imaginePrompt, aspect_ratio: imagineAspect }) }
      );
      if (result.success && result.image_url) {
        setImagineUrl(result.image_url);
      } else {
        setImagineUrl(null);
        setImagineError(result.error || "Image generation failed");
      }
    } catch (e) {
      setImagineError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setImagineLoading(false);
    }
  }, [imaginePrompt, imagineAspect, imagineLoading]);

  if (authLoading) return null;
  if (!user) return <LoginOverlay />;

  const currentAgent = agents.find(a => a.id === selectedAgent);
  const promptKeys = currentAgent ? Object.keys(currentAgent.prompts) : [];

  const roleColors: Record<string, string> = {
    system: "#a78bfa",
    user: "#60a5fa",
    assistant: "#34d399",
  };

  return (
    <>
      <SvgSprite />
      <div className="pg-layout">
        {/* Left: Prompt Editor */}
        <div className="pg-left">
          <div className="pg-left-header">
            <h2>Prompt Editor</h2>
            <div className="pg-agent-row">
              <select value={selectedAgent} onChange={e => handleAgentSelect(e.target.value)}>
                <option value="">Load from agent...</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
              </select>
              {promptKeys.length > 0 && (
                <select value={selectedPromptKey} onChange={e => handlePromptKeySelect(e.target.value)}>
                  {promptKeys.map(k => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
                </select>
              )}
            </div>
          </div>

          <div className="pg-editor">
            <Suspense fallback={<div style={{ padding: 20, color: "#64748b" }}>Loading editor...</div>}>
              <MonacoEditor
                height="100%"
                language={editorContent.includes("<") && editorContent.includes(">") ? "xml" : "plaintext"}
                value={editorContent}
                onChange={v => setEditorContent(v || "")}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: "'SF Mono', Consolas, monospace",
                  lineNumbers: "on",
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  contextmenu: true,
                  mouseWheelZoom: true,
                  folding: true,
                  bracketPairColorization: { enabled: true },
                  padding: { top: 8 },
                }}
              />
            </Suspense>
          </div>

          {/* Send editor content as system message */}
          <div className="pg-editor-actions">
            <button onClick={sendEditorAsSystem} className="pg-inject-btn">
              Inject as System Message &rarr;
            </button>
            <span className="pg-char-count">{editorContent.length} chars</span>
          </div>

          {/* Variables */}
          <div className="pg-vars">
            <div className="pg-vars-header">
              <span>Variables {uniqueDetectedVars.length > 0 && <span className="pg-var-count">{uniqueDetectedVars.length} detected</span>}</span>
              <div className="pg-vars-actions">
                {uniqueDetectedVars.length > 0 && <button onClick={autoAddVars}>Auto-add</button>}
                <button onClick={addVariable}>+ Add</button>
              </div>
            </div>
            {variables.map((v, i) => (
              <div key={i} className="pg-var-row">
                <input placeholder="key" value={v.key} onChange={e => updateVariable(i, "key", e.target.value)} className="pg-var-key" />
                <input placeholder="value" value={v.value} onChange={e => updateVariable(i, "value", e.target.value)} className="pg-var-val" />
                <button className="pg-var-del" onClick={() => removeVariable(i)}>&times;</button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Message Builder + Chat */}
        <div className="pg-right">
          {/* Settings bar */}
          <div className="pg-settings">
            <label>
              Model
              <select value={model} onChange={e => setModel(e.target.value)}>
                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label>
              Temp <span className="pg-val">{temperature}</span>
              <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} />
            </label>
            <label>
              Top P <span className="pg-val">{topP}</span>
              <input type="range" min="0" max="1" step="0.05" value={topP} onChange={e => setTopP(parseFloat(e.target.value))} />
            </label>
            <label>
              Max Tokens
              <input type="number" min="100" max="32000" step="100" value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value) || 4096)} className="pg-tokens-input" />
            </label>
            <div className="pg-settings-right">
              <span className="pg-token-count">{totalTokens} tokens</span>
              <button onClick={clearChat} className="pg-clear-btn">Clear All</button>
              <button onClick={handleRun} disabled={streaming || messages.length === 0} className="pg-run-btn">
                {streaming ? "Running..." : "Run"}
              </button>
            </div>
          </div>

          {/* Imagine panel */}
          <div className="pg-imagine-bar">
            <button className="pg-imagine-toggle" onClick={() => setImagineOpen(!imagineOpen)}>
              <span>{imagineOpen ? "\u25BC" : "\u25B6"}</span> Grok Imagine
            </button>
            {imagineOpen && (
              <div className="pg-imagine-panel">
                <div className="pg-imagine-input-row">
                  <textarea
                    value={imaginePrompt}
                    onChange={e => { setImaginePrompt(e.target.value); setImagineError(""); }}
                    placeholder="Enter image generation prompt... (e.g. A bright Pixar-style cartoon illustration of...)"
                    rows={3}
                    className="pg-imagine-prompt"
                  />
                  <div className="pg-imagine-controls">
                    <select value={imagineAspect} onChange={e => setImagineAspect(e.target.value)}>
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                      <option value="1:1">1:1</option>
                      <option value="4:3">4:3</option>
                      <option value="3:4">3:4</option>
                    </select>
                    <button onClick={handleImagine} disabled={imagineLoading || !imaginePrompt.trim()} className="pg-imagine-btn">
                      {imagineLoading ? "Generating..." : "Generate"}
                    </button>
                  </div>
                </div>
                {imagineError && <div className="pg-imagine-error">{imagineError}</div>}
                {imagineUrl && (
                  <div className="pg-imagine-result">
                    <img src={imagineUrl} alt="Generated" />
                    <a href={imagineUrl} target="_blank" rel="noopener noreferrer" className="pg-imagine-link">Open full size</a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="pg-chat">
            {messages.length === 0 && (
              <div className="pg-empty">
                Build your conversation below. Use &ldquo;Inject as System Message&rdquo; to send the left pane prompt, or add messages manually with role selection.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`pg-msg pg-msg-${m.role}${m.fromLLM ? " pg-msg-llm" : ""}`}>
                <div className="pg-msg-header">
                  <span className="pg-msg-role" style={{ color: roleColors[m.role] }}>{m.role}</span>
                  {m.fromLLM && <span className="pg-msg-badge">LLM</span>}
                  {!m.fromLLM && (
                    <button className="pg-msg-del" onClick={() => removeMessage(i)} title="Remove">&times;</button>
                  )}
                </div>
                {m.thinking && (
                  <details className="pg-thinking">
                    <summary>Thinking ({m.thinking.length} chars)</summary>
                    <pre>{m.thinking}</pre>
                  </details>
                )}
                {m.fromLLM ? (
                  <div className="pg-msg-content">{m.content}</div>
                ) : (
                  <textarea
                    className="pg-msg-edit"
                    value={m.content}
                    onChange={e => editMessage(i, e.target.value)}
                    rows={Math.min(m.content.split("\n").length + 1, 8)}
                    spellCheck={false}
                  />
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar with role selector */}
          <div className="pg-input-bar">
            <select value={inputRole} onChange={e => setInputRole(e.target.value as "system" | "user" | "assistant")} className="pg-role-select">
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type message content... (Enter to add, Shift+Enter for newline)"
              rows={2}
            />
            <button onClick={addMessage} disabled={!inputText.trim()} className="pg-add-btn">
              Add
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
