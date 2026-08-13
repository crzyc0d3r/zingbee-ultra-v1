"use client";

import { useState, useCallback, useEffect, useRef } from "react";

// New format: {misconception, correct_understanding, why_wrong, prevalence}
// Legacy format: {wrong, correct}
interface Misconception {
  misconception: string;
  correct_understanding: string;
  why_wrong: string;
  prevalence: string;
}

// New format: {term, definition, context_sentence}
// Legacy format: plain string
interface VocabItem {
  term: string;
  definition: string;
  context_sentence: string;
}

interface FactData {
  text: string;
  processes: string[];
  applications: string[];
  misconceptions: Misconception[];
  micro_checks: string[];
  vocabulary: VocabItem[];
  evidence: string[];
  stretch: string[];
  scaffold: string[];
  difficulty_weight: number | null;
}

const TABS = [
  { key: "processes", label: "Processes" },
  { key: "applications", label: "Applications" },
  { key: "misconceptions", label: "Misconceptions" },
  { key: "micro_checks", label: "Micro Checks" },
  { key: "vocabulary", label: "Vocabulary" },
  { key: "evidence", label: "Evidence" },
  { key: "stretch", label: "Stretch" },
  { key: "scaffold", label: "Scaffold" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const EMPTY_FACT: FactData = {
  text: "",
  processes: [],
  applications: [],
  misconceptions: [],
  micro_checks: [],
  vocabulary: [],
  evidence: [],
  stretch: [],
  scaffold: [],
  difficulty_weight: null,
};

function parseMisconception(m: any): Misconception {
  if (m.misconception !== undefined) {
    // New format
    return {
      misconception: String(m.misconception ?? ""),
      correct_understanding: String(m.correct_understanding ?? ""),
      why_wrong: String(m.why_wrong ?? ""),
      prevalence: String(m.prevalence ?? ""),
    };
  }
  // Legacy {wrong, correct} -> map to new fields
  return {
    misconception: String(m.wrong ?? ""),
    correct_understanding: String(m.correct ?? ""),
    why_wrong: "",
    prevalence: "",
  };
}

function parseVocabItem(v: any): VocabItem {
  if (typeof v === "string") {
    // Legacy plain string
    return { term: v, definition: "", context_sentence: "" };
  }
  if (v && typeof v === "object" && "term" in v) {
    return {
      term: String(v.term ?? ""),
      definition: String(v.definition ?? ""),
      context_sentence: String(v.context_sentence ?? ""),
    };
  }
  return { term: String(v ?? ""), definition: "", context_sentence: "" };
}

function toStringArray(val: any): string[] {
  if (Array.isArray(val)) return val.filter((s: any) => typeof s === "string");
  if (typeof val === "string" && val.trim()) return [val];
  return [];
}

function parseFact(json: string): FactData {
  if (!json.trim()) return { ...EMPTY_FACT };
  try {
    const obj = JSON.parse(json);
    return {
      text: typeof obj.text === "string" ? obj.text
        : typeof obj.core_fact === "string" ? obj.core_fact : "",
      processes: toStringArray(obj.processes ?? obj.process),
      applications: toStringArray(obj.applications ?? obj.application),
      misconceptions: (() => {
        const src = obj.misconceptions ?? obj.misconception;
        if (Array.isArray(src)) return src.filter((m: any) => m && typeof m === "object").map(parseMisconception);
        if (typeof src === "string" && src.trim()) return [{ misconception: src, correct_understanding: "", why_wrong: "", prevalence: "" }];
        return [];
      })(),
      micro_checks: toStringArray(obj.micro_checks ?? obj.micro_check),
      vocabulary: (() => {
        const src = obj.vocabulary;
        if (Array.isArray(src)) return src.map(parseVocabItem);
        if (typeof src === "string" && src.trim()) return src.split(/;\s*/).map((t: string) => ({ term: t.trim(), definition: "", context_sentence: "" }));
        return [];
      })(),
      evidence: toStringArray(obj.evidence),
      stretch: toStringArray(obj.stretch),
      scaffold: toStringArray(obj.scaffold),
      difficulty_weight: typeof obj.difficulty_weight === "number" ? obj.difficulty_weight : null,
    };
  } catch {
    return { ...EMPTY_FACT };
  }
}

function serializeFact(fact: FactData): string {
  const clean: Record<string, any> = {
    core_fact: fact.text,
    processes: fact.processes.filter((s) => s.trim()),
    applications: fact.applications.filter((s) => s.trim()),
    misconceptions: fact.misconceptions.filter((m) => m.misconception.trim() || m.correct_understanding.trim()),
    micro_checks: fact.micro_checks.filter((s) => s.trim()),
    vocabulary: fact.vocabulary.filter((v) => v.term.trim() || v.definition.trim()),
    evidence: fact.evidence.filter((s) => s.trim()),
    stretch: fact.stretch.filter((s) => s.trim()),
    scaffold: fact.scaffold.filter((s) => s.trim()),
  };
  if (fact.difficulty_weight != null) clean.difficulty_weight = fact.difficulty_weight;
  return JSON.stringify(clean, null, 2);
}

type StringArrayKey = "processes" | "applications" | "micro_checks" | "evidence" | "stretch" | "scaffold";

interface FactEditorProps {
  value: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
}

export function FactEditor({ value, onChange, readOnly }: FactEditorProps) {
  const [tab, setTab] = useState<TabKey>("processes");
  const [fact, setFact] = useState<FactData>(() => parseFact(value));
  const selfChange = useRef(false);

  useEffect(() => {
    if (selfChange.current) {
      selfChange.current = false;
      return;
    }
    setFact(parseFact(value));
  }, [value]);

  const sync = useCallback(
    (updater: (prev: FactData) => FactData) => {
      setFact((prev) => {
        const next = updater(prev);
        selfChange.current = true;
        onChange(serializeFact(next));
        return next;
      });
    },
    [onChange]
  );

  // --- String array helpers (processes, applications, micro_checks) ---
  const updateStringArray = (key: StringArrayKey, idx: number, val: string) =>
    sync((prev) => {
      const arr = [...prev[key]];
      arr[idx] = val;
      return { ...prev, [key]: arr };
    });

  const addStringItem = (key: StringArrayKey) =>
    sync((prev) => ({ ...prev, [key]: [...prev[key], ""] }));

  const removeStringItem = (key: StringArrayKey, idx: number) =>
    sync((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== idx) }));

  // --- Misconception helpers ---
  const updateMisconception = (idx: number, field: keyof Misconception, val: string) =>
    sync((prev) => {
      const arr = [...prev.misconceptions];
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...prev, misconceptions: arr };
    });

  const addMisconception = () =>
    sync((prev) => ({
      ...prev,
      misconceptions: [...prev.misconceptions, { misconception: "", correct_understanding: "", why_wrong: "", prevalence: "" }],
    }));

  const removeMisconception = (idx: number) =>
    sync((prev) => ({
      ...prev,
      misconceptions: prev.misconceptions.filter((_, i) => i !== idx),
    }));

  // --- Vocabulary helpers ---
  const updateVocab = (idx: number, field: keyof VocabItem, val: string) =>
    sync((prev) => {
      const arr = [...prev.vocabulary];
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...prev, vocabulary: arr };
    });

  const addVocab = () =>
    sync((prev) => ({
      ...prev,
      vocabulary: [...prev.vocabulary, { term: "", definition: "", context_sentence: "" }],
    }));

  const removeVocab = (idx: number) =>
    sync((prev) => ({
      ...prev,
      vocabulary: prev.vocabulary.filter((_, i) => i !== idx),
    }));

  // --- Renderers ---
  // Keys where items are typically sentences/questions — use textareas
  const textareaKeys: StringArrayKey[] = ["evidence", "stretch", "micro_checks"];
  const renderStringList = (key: StringArrayKey) => {
    const items = fact[key];
    const useTextarea = textareaKeys.includes(key);
    return (
      <div className="fact-grid">
        {items.length === 0 && <div className="fact-empty">No items. Click + Add to create one.</div>}
        <div className="fact-grid-1col">
          {items.map((item, i) => (
            <div key={i} className="fact-row">
              {useTextarea ? (
                <textarea
                  className="fact-textarea"
                  value={item}
                  onChange={(e) => updateStringArray(key, i, e.target.value)}
                  readOnly={readOnly}
                  placeholder={`Item ${i + 1}`}
                  rows={2}
                />
              ) : (
                <input
                  type="text"
                  value={item}
                  onChange={(e) => updateStringArray(key, i, e.target.value)}
                  readOnly={readOnly}
                  placeholder={`Item ${i + 1}`}
                />
              )}
              {!readOnly && (
                <button type="button" className="fact-del-btn" onClick={() => removeStringItem(key, i)} title="Remove">
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <button type="button" className="fact-add-btn" onClick={() => addStringItem(key)}>
            + Add
          </button>
        )}
      </div>
    );
  };

  const renderMisconceptions = () => {
    const items = fact.misconceptions;
    return (
      <div className="fact-grid">
        {items.length > 0 && (
          <div className="fact-row fact-header fact-header-4col">
            <span>Misconception</span>
            <span>Correct Understanding</span>
            <span>Why Wrong</span>
            <span>Prevalence</span>
            <span></span>
          </div>
        )}
        {items.length === 0 && <div className="fact-empty">No misconceptions. Click Add to create one.</div>}
        {items.map((m, i) => (
          <div key={i} className="fact-row fact-row-4col">
            <input
              type="text"
              value={m.misconception}
              onChange={(e) => updateMisconception(i, "misconception", e.target.value)}
              readOnly={readOnly}
              placeholder="Misconception"
            />
            <input
              type="text"
              value={m.correct_understanding}
              onChange={(e) => updateMisconception(i, "correct_understanding", e.target.value)}
              readOnly={readOnly}
              placeholder="Correct understanding"
            />
            <input
              type="text"
              value={m.why_wrong}
              onChange={(e) => updateMisconception(i, "why_wrong", e.target.value)}
              readOnly={readOnly}
              placeholder="Why wrong"
            />
            <input
              type="text"
              value={m.prevalence}
              onChange={(e) => updateMisconception(i, "prevalence", e.target.value)}
              readOnly={readOnly}
              placeholder="common / rare"
            />
            {!readOnly && (
              <button type="button" className="fact-del-btn" onClick={() => removeMisconception(i)} title="Remove">
                &times;
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" className="fact-add-btn" onClick={() => addMisconception()}>
            + Add
          </button>
        )}
      </div>
    );
  };

  const renderVocabulary = () => {
    const items = fact.vocabulary;
    return (
      <div className="fact-grid">
        {items.length > 0 && (
          <div className="fact-row fact-header fact-header-3col">
            <span>Term</span>
            <span>Definition</span>
            <span>Context Sentence</span>
            <span></span>
          </div>
        )}
        {items.length === 0 && <div className="fact-empty">No vocabulary. Click Add to create one.</div>}
        {items.map((v, i) => (
          <div key={i} className="fact-row fact-row-3col">
            <input
              type="text"
              value={v.term}
              onChange={(e) => updateVocab(i, "term", e.target.value)}
              readOnly={readOnly}
              placeholder="Term"
            />
            <input
              type="text"
              value={v.definition}
              onChange={(e) => updateVocab(i, "definition", e.target.value)}
              readOnly={readOnly}
              placeholder="Definition"
            />
            <input
              type="text"
              value={v.context_sentence}
              onChange={(e) => updateVocab(i, "context_sentence", e.target.value)}
              readOnly={readOnly}
              placeholder="Context sentence"
            />
            {!readOnly && (
              <button type="button" className="fact-del-btn" onClick={() => removeVocab(i)} title="Remove">
                &times;
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" className="fact-add-btn" onClick={() => addVocab()}>
            + Add
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="fact-editor">
      <div className="fact-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`fact-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="fact-body">
        {tab === "processes" && renderStringList("processes")}
        {tab === "applications" && renderStringList("applications")}
        {tab === "misconceptions" && renderMisconceptions()}
        {tab === "micro_checks" && renderStringList("micro_checks")}
        {tab === "vocabulary" && renderVocabulary()}
        {tab === "evidence" && renderStringList("evidence")}
        {tab === "stretch" && renderStringList("stretch")}
        {tab === "scaffold" && renderStringList("scaffold")}
      </div>
    </div>
  );
}
