"use client";

import type { SubjectPhase, ImageEvalOptions } from "@/lib/images/types";

type ScopePickerProps = {
  subjects: Record<string, SubjectPhase[]>;
  phaseOptions: SubjectPhase[];
  themeOptions: string[];
  capsuleOptions: string[];
  subject: string;
  phase: number;
  theme: string;
  capsule: string;
  setSubject: (v: string) => void;
  setPhase: (v: number) => void;
  setTheme: (v: string) => void;
  setCapsule: (v: string) => void;
  /** Optional extra controls (model/strategy selects, etc.) */
  children?: React.ReactNode;
};

export function ScopePicker({
  subjects,
  phaseOptions,
  themeOptions,
  capsuleOptions,
  subject,
  phase,
  theme,
  capsule,
  setSubject,
  setPhase,
  setTheme,
  setCapsule,
  children,
}: ScopePickerProps) {
  return (
    <div className="images-controls">
      <div className="images-control">
        <label>Subject</label>
        <select value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">{Object.keys(subjects).length ? "None" : "Loading..."}</option>
          {Object.keys(subjects).sort().map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="images-control">
        <label>Phase</label>
        <select
          value={phase}
          onChange={(e) => setPhase(Number(e.target.value || 0))}
          disabled={!subject || !phaseOptions.length}
        >
          <option value={0}>{phaseOptions.length ? "None" : "..."}</option>
          {phaseOptions.map((p) => (
            <option key={p.phase} value={p.phase}>Phase {p.phase} ({p.age_range})</option>
          ))}
        </select>
      </div>
      <div className="images-control">
        <label>Theme</label>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          disabled={!subject || !phase || !themeOptions.length}
        >
          <option value="">{themeOptions.length ? "None" : "Select theme"}</option>
          {themeOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="images-control">
        <label>Capsule</label>
        <select
          value={capsule}
          onChange={(e) => setCapsule(e.target.value)}
          disabled={!theme || !capsuleOptions.length}
        >
          <option value="">{capsuleOptions.length ? "None" : "Select capsule"}</option>
          {capsuleOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      {children}
    </div>
  );
}
