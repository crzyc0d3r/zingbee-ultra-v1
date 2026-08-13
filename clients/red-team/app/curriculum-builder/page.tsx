"use client";

import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { SvgSprite } from "@/components/ui/Icon";
import "@/styles/curriculum-builder.css";

// Always use relative URLs; API route handlers proxy to backend server-side
const API = "";
const ALLOWED_EXT = [".pdf", ".docx", ".txt", ".md", ".csv"];

interface ParsedCapsule {
  capsule_order: number;
  name: string;
  facts: string[];
  misconceptions?: string[];
  vocabulary?: string[];
}

interface ParsedTheme {
  theme_order: number;
  name: string;
  guiding_question: string;
  capsules: ParsedCapsule[];
}

interface ParsedCurriculum {
  subject: string;
  phase: number;
  age_range: string;
  curriculum_base: string;
  themes: ParsedTheme[];
}

interface ParseResponse {
  status: string;
  filename: string;
  truncated: boolean;
  parsed: ParsedCurriculum;
  db_mapping: {
    subject_curriculum: Record<string, unknown>;
    curriculum_themes: Record<string, unknown>[];
    curriculum_capsules: Record<string, unknown>[];
    curriculum_facts: { capsule: string; fact_order: number; fact_text: string }[];
  };
  stats: { themes: number; capsules: number; facts: number };
}

interface SaveResponse {
  status: string;
  subject: string;
  phase: number;
  created: { themes: number; capsules: number; facts: number };
}

export default function CurriculumBuilderPage() {
  const { user, loading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragover, setDragover] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResponse | null>(null);
  const [openThemes, setOpenThemes] = useState<Record<number, boolean>>({});

  const handleFile = useCallback((f: File) => {
    const ext = f.name.substring(f.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      setError(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXT.join(", ")}`);
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File too large (max 10 MB)");
      return;
    }
    setFile(f);
    setError(null);
    setResult(null);
    setSaveResult(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleParse = useCallback(async () => {
    if (!file) return;
    setParsing(true);
    setError(null);
    setResult(null);
    setSaveResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/api/curriculum-builder/parse`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.raw_output
          ? `${data.error}\n\nRaw LLM output (first 500 chars):\n${data.raw_output.slice(0, 500)}`
          : data.error || `Request failed: ${res.status}`;
        setError(msg);
        return;
      }
      setResult(data);
      // Auto-expand first theme
      if (data.parsed?.themes?.length > 0) {
        setOpenThemes({ 0: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setParsing(false);
    }
  }, [file]);

  const handleSave = useCallback(async () => {
    if (!result?.parsed) return;
    setSaving(true);
    setError(null);
    setSaveResult(null);

    try {
      const res = await fetch(`${API}/api/curriculum-builder/save`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsed: result.parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Save failed: ${res.status}`);
        return;
      }
      setSaveResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }, [result]);

  const toggleTheme = useCallback((idx: number) => {
    setOpenThemes(prev => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setSaveResult(null);
    setError(null);
    setOpenThemes({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  if (loading) return null;
  if (!user) return <LoginOverlay />;

  return (
    <div className="cb-page">
      <SvgSprite />

      <div className="cb-header">
        <h1>Curriculum Builder</h1>
        <p>Upload a curriculum document and the AI will parse it into a structured curriculum that maps to the database.</p>
      </div>

      {error && <div className="cb-error">{error}</div>}
      {saveResult && (
        <div className="cb-success">
          Saved to database: {saveResult.created.themes} themes, {saveResult.created.capsules} capsules, {saveResult.created.facts} facts
          for {saveResult.subject} Phase {saveResult.phase}.
        </div>
      )}

      {/* Upload zone */}
      <div
        className={`cb-upload-zone${dragover ? " dragover" : ""}${file ? " has-file" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={handleDrop}
      >
        <div className="cb-upload-icon">{file ? "\u2713" : "\u21E7"}</div>
        <div className="cb-upload-label">
          {file ? file.name : "Drop a curriculum file here, or click to browse"}
        </div>
        <div className="cb-upload-hint">
          Supported: PDF, DOCX, TXT, MD, CSV (max 10 MB)
        </div>
        {file && (
          <div className="cb-upload-file">
            {(file.size / 1024).toFixed(1)} KB
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_EXT.join(",")}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>

      {/* Actions */}
      <div className="cb-actions">
        <button
          className="cb-btn cb-btn-primary"
          disabled={!file || parsing}
          onClick={handleParse}
        >
          {parsing ? "Parsing..." : "Parse Curriculum"}
        </button>
        {/* Save to DB disabled for now — endpoint exists but not wired up yet */}
        {(file || result) && (
          <button className="cb-btn cb-btn-secondary" onClick={handleReset}>
            Reset
          </button>
        )}
      </div>

      {/* Loading */}
      {parsing && (
        <div className="cb-loading">
          <div className="cb-spinner" />
          <div>Analyzing document with AI... This may take a moment.</div>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Stats */}
          <div className="cb-stats">
            <div className="cb-stat">
              <div className="cb-stat-value">{result.stats.themes}</div>
              <div className="cb-stat-label">Themes</div>
            </div>
            <div className="cb-stat">
              <div className="cb-stat-value">{result.stats.capsules}</div>
              <div className="cb-stat-label">Capsules</div>
            </div>
            <div className="cb-stat">
              <div className="cb-stat-value">{result.stats.facts}</div>
              <div className="cb-stat-label">Facts</div>
            </div>
            <div className="cb-stat">
              <div className="cb-stat-value">{result.parsed.subject}</div>
              <div className="cb-stat-label">Subject</div>
            </div>
            <div className="cb-stat">
              <div className="cb-stat-value">Phase {result.parsed.phase}</div>
              <div className="cb-stat-label">Phase</div>
            </div>
          </div>

          {/* Subject header */}
          <div className="cb-results">
            <h2>Parsed Curriculum Structure</h2>
            <div className="cb-subject-header">
              <div className="cb-meta">
                <strong>{result.parsed.subject}</strong> &mdash; Phase {result.parsed.phase}
              </div>
              {result.parsed.age_range && (
                <div className="cb-meta">Ages: <strong>{result.parsed.age_range}</strong></div>
              )}
              {result.parsed.curriculum_base && (
                <div className="cb-meta">Base: <strong>{result.parsed.curriculum_base}</strong></div>
              )}
              {result.truncated && (
                <div className="cb-meta" style={{ color: "#fbbf24" }}>
                  Document was truncated (too long)
                </div>
              )}
            </div>

            {/* Theme tree */}
            {result.parsed.themes.map((theme, ti) => (
              <div className="cb-theme" key={ti}>
                <div className="cb-theme-header" onClick={() => toggleTheme(ti)}>
                  <span className={`cb-theme-arrow${openThemes[ti] ? " open" : ""}`}>&#9654;</span>
                  <span>T{theme.theme_order}: {theme.name}</span>
                  <span className="cb-theme-gq">{theme.guiding_question}</span>
                </div>
                <div className={`cb-theme-body${openThemes[ti] ? " open" : ""}`}>
                  {theme.capsules.map((cap, ci) => (
                    <div className="cb-capsule" key={ci}>
                      <div className="cb-capsule-name">
                        {cap.capsule_order}. {cap.name}
                      </div>
                      {cap.facts.length > 0 && (
                        <ul className="cb-facts">
                          {cap.facts.map((fact, fi) => (
                            <li key={fi}>{fact}</li>
                          ))}
                        </ul>
                      )}
                      <div className="cb-capsule-meta">
                        {cap.misconceptions?.map((m, mi) => (
                          <span className="cb-tag misconception" key={`m${mi}`}>{m}</span>
                        ))}
                        {cap.vocabulary?.map((v, vi) => (
                          <span className="cb-tag vocab" key={`v${vi}`}>{v}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* DB Mapping preview */}
          <div className="cb-mapping">
            <h2>Database Mapping Preview</h2>
            <table className="cb-mapping-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="cb-table-label" rowSpan={4}>subject_curriculum</td>
                  <td>subject</td>
                  <td>{result.parsed.subject}</td>
                </tr>
                <tr>
                  <td>phase</td>
                  <td>{result.parsed.phase}</td>
                </tr>
                <tr>
                  <td>age_range</td>
                  <td>{result.parsed.age_range}</td>
                </tr>
                <tr>
                  <td>curriculum_base</td>
                  <td>{result.parsed.curriculum_base}</td>
                </tr>

                {result.db_mapping.curriculum_themes.map((t: Record<string, unknown>, i: number) => (
                  <tr key={`t${i}`}>
                    {i === 0 && (
                      <td className="cb-table-label" rowSpan={result.db_mapping.curriculum_themes.length}>
                        curriculum_themes
                      </td>
                    )}
                    <td>theme {String(t.theme_order)}</td>
                    <td>{String(t.name)}{t.guiding_question ? ` — ${String(t.guiding_question)}` : ""}</td>
                  </tr>
                ))}

                {result.db_mapping.curriculum_facts.slice(0, 20).map((f, i) => (
                  <tr key={`f${i}`}>
                    {i === 0 && (
                      <td className="cb-table-label" rowSpan={Math.min(result.db_mapping.curriculum_facts.length, 20)}>
                        curriculum_facts
                        {result.db_mapping.curriculum_facts.length > 20 && (
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                            (showing 20 of {result.db_mapping.curriculum_facts.length})
                          </div>
                        )}
                      </td>
                    )}
                    <td>{f.capsule} #{f.fact_order}</td>
                    <td>{f.fact_text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
