"use client";

import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Icon } from "@/components/ui/Icon";
import { validateJson } from "./types";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

type MonacoEditorRef = import("monaco-editor").editor.IStandaloneCodeEditor;

interface ExpandEditorProps {
  open: boolean;
  title: string;
  isJson: boolean;
  value: string;
  onChange: (val: string) => void;
  onClose: () => void;
}

export function ExpandEditor({ open, title, isJson, value, onChange, onClose }: ExpandEditorProps) {
  const [localVal, setLocalVal] = useState(value);
  const [jsonError, setJsonError] = useState("");
  const [fontSize, setFontSize] = useState(13);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<MonacoEditorRef | null>(null);

  useEffect(() => {
    if (open) {
      setLocalVal(value);
      setJsonError("");
      if (isJson) setTimeout(() => taRef.current?.focus(), 50);
    }
  }, [open, value, isJson]);

  const handleDone = () => {
    onChange(localVal);
    onClose();
  };

  const handleFormat = () => {
    try {
      const obj = JSON.parse(localVal);
      setLocalVal(JSON.stringify(obj, null, 2));
      setJsonError("");
    } catch (e: any) {
      setJsonError("Invalid JSON: " + (e.message || ""));
    }
  };

  const handleBlur = () => {
    if (isJson && localVal.trim()) {
      const res = validateJson(localVal);
      setJsonError(res.valid ? "" : "Invalid JSON: " + res.error);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onChange(localVal);
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, localVal, onChange, onClose]);

  // Detect language from content
  const language = isJson ? "json" : localVal.includes("<") && localVal.includes(">") ? "xml" : "plaintext";

  return (
    <div className={`editor-overlay${open ? " active" : ""}`}>
      <div className="editor-overlay-hd">
        <h3>{title}</h3>
        <button className="modal-x" onClick={handleDone}>&times;</button>
      </div>
      <div className="editor-overlay-bd">
        {isJson ? (
          <textarea
            ref={taRef}
            value={localVal}
            onChange={(e) => setLocalVal(e.target.value)}
            onBlur={handleBlur}
            spellCheck={false}
            style={{ fontFamily: "'SF Mono',Consolas,monospace" }}
            className={jsonError ? "json-invalid" : undefined}
          />
        ) : (
          <>
            <div className="editor-toolbar">
              <button type="button" title="Find & Replace (Ctrl+H)" onClick={() => editorRef.current?.getAction("editor.action.startFindReplaceAction")?.run()}>Find/Replace</button>
              <button type="button" title="Zoom In (Ctrl+=)" onClick={() => setFontSize(s => Math.min(s + 2, 28))}>A+</button>
              <button type="button" title="Zoom Out (Ctrl+-)" onClick={() => setFontSize(s => Math.max(s - 2, 8))}>A-</button>
              <button type="button" title="Toggle Word Wrap" onClick={() => { const ed = editorRef.current; if (ed) { const cur = ed.getOption(130); ed.updateOptions({ wordWrap: cur === 1 ? "on" : "off" }); } }}>Wrap</button>
              <button type="button" title="Toggle Minimap" onClick={() => { const ed = editorRef.current; if (ed) { const cur = ed.getOption(72); ed.updateOptions({ minimap: { enabled: !cur.enabled } }); } }}>Map</button>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#64748b" }}>{language.toUpperCase()}</span>
            </div>
            <Suspense fallback={<div style={{ padding: 20, color: "#64748b" }}>Loading editor...</div>}>
              <MonacoEditor
                height="100%"
                language={language}
                value={localVal}
                onChange={(v) => setLocalVal(v || "")}
                theme="vs-dark"
                onMount={(editor) => { editorRef.current = editor; }}
                options={{
                  minimap: { enabled: false },
                  fontSize,
                  fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
                  lineNumbers: "on",
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  renderWhitespace: "none",
                  padding: { top: 8 },
                  contextmenu: true,
                  find: { addExtraSpaceOnTop: false, autoFindInSelection: "multiline", seedSearchStringFromSelection: "selection" },
                  folding: true,
                  foldingStrategy: "indentation",
                  mouseWheelZoom: true,
                  bracketPairColorization: { enabled: true },
                  autoClosingBrackets: "always",
                  formatOnPaste: true,
                }}
              />
            </Suspense>
          </>
        )}
      </div>
      <div className="editor-overlay-ft">
        <span className="json-error">{jsonError}</span>
        <span style={{ fontSize: 11, color: "#64748b" }}>{localVal.length} chars</span>
        {isJson && (
          <button className="btn btn-secondary" onClick={handleFormat}>
            <Icon name="edit" /> Format JSON
          </button>
        )}
        <button className="btn btn-primary" onClick={handleDone}>
          <Icon name="save" /> Done
        </button>
      </div>
    </div>
  );
}
