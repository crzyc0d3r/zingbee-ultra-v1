"use client";

import { useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface Props {
  data: unknown;
  height?: string;
}

// Register a JSON-like language that allows multi-line strings
let langRegistered = false;
function registerJsonRelaxed(monaco: any) {
  if (langRegistered) return;
  langRegistered = true;

  monaco.languages.register({ id: "json-relaxed" });
  monaco.languages.setMonarchTokensProvider("json-relaxed", {
    tokenizer: {
      root: [
        // Keys (before colon)
        [/"(?:[^"\\]|\\.)*"\s*(?=:)/, "string.key.json"],
        // String values — opening quote starts string state
        [/"/, "string.value.json", "@string"],
        // Numbers
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number.json"],
        // Booleans and null
        [/\b(?:true|false|null)\b/, "keyword.json"],
        // Braces and brackets
        [/[{}[\]]/, "@brackets"],
        // Commas and colons
        [/[,:]/, "delimiter.json"],
        // Whitespace
        [/\s+/, "white"],
      ],
      // Multi-line string state: stays in string until closing straight quote
      string: [
        [/[^"\\\u201C]+/, "string.value.json"],
        [/\u201C/, "string.value.json"],  // curly quote (unescaped \") — treat as string content
        [/\\./, "string.escape.json"],
        [/"/, "string.value.json", "@pop"],
      ],
    },
  });
}

export function JsonViewer({ data, height = "600px" }: Props) {
  // Valid JSON for copy (unexpanded)
  const rawJson = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  // Display version: unescape common sequences for human readability
  // \" → " (U+201C curly quote, visually similar but won't confuse the tokenizer)
  // \n → real newline
  // \t → real tab
  // \\ → single backslash
  const formatted = useMemo(() =>
    rawJson
      .replace(/\\"/g, "\u201C")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\"),
  [rawJson]);

  const copyAll = useCallback(() => {
    navigator.clipboard.writeText(rawJson);
  }, [rawJson]);

  return (
    <div className="jv-root">
      <div className="jv-toolbar" style={{ display: "flex", gap: 6, padding: "6px 0" }}>
        <button className="jv-btn" onClick={copyAll} title="Copy JSON">Copy</button>
        <span style={{ color: "#64748b", fontSize: 11, marginLeft: 8 }}>
          {formatted.length.toLocaleString()} chars
        </span>
      </div>
      <MonacoEditor
        height={height}
        defaultLanguage="json-relaxed"
        theme="vs-dark"
        value={formatted}
        beforeMount={(monaco) => registerJsonRelaxed(monaco)}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          fontSize: 12,
          lineNumbers: "on",
          folding: true,
          foldingStrategy: "indentation",
          automaticLayout: true,
          renderLineHighlight: "none",
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />
    </div>
  );
}
