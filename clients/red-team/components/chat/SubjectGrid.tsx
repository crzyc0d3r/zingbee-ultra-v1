"use client";

import { Icon } from "@/components/ui/Icon";

const SUBJECT_ICONS: Record<string, string> = {
  Biology: "dna",
  Math: "geometry",
  Chemistry: "flask",
  English: "reading",
  Physics: "physics",
};

export interface SubjectEntry {
  name: string;
  tutor: string;
}

interface SubjectGridProps {
  currentSubject: string;
  onSelect: (subject: string) => void;
  subjects: SubjectEntry[];
}

export function SubjectGrid({ currentSubject, onSelect, subjects }: SubjectGridProps) {
  return (
    <div className="subject-grid" id="subjectGrid">
      {subjects.map((s) => (
        <button
          key={s.name}
          className={`subject-card${currentSubject === s.name ? " active" : ""}`}
          data-subject={s.name}
          onClick={() => onSelect(s.name)}
        >
          <span className="subject-icon">
            <Icon name={SUBJECT_ICONS[s.name] || "dna"} />
          </span>
          <span className="subject-name">{s.name}</span>
          <span className="subject-tutor">{s.tutor}</span>
        </button>
      ))}
    </div>
  );
}
