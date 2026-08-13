"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface Student {
  student_id: string;
  name: string;
}

interface SessionFiltersProps {
  onFilterChange: (studentId: string, search: string) => void;
  sessionCount: number;
}

export default function SessionFilters({
  onFilterChange,
  sessionCount,
}: SessionFiltersProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiFetch<Student[]>("/sessions/api/students")
      .then(setStudents)
      .catch(() => {});
  }, []);

  const handleStudentChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      setStudentId(val);
      onFilterChange(val, search);
    },
    [search, onFilterChange]
  );

  const handleSearchInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setSearch(val);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        onFilterChange(studentId, val);
      }, 300);
    },
    [studentId, onFilterChange]
  );

  return (
    <div className="toolbar">
      <span className="toolbar-title">Session Viewer</span>
      <div className="toolbar-actions">
        <select
          id="filterStudent"
          value={studentId}
          onChange={handleStudentChange}
        >
          <option value="">All Students</option>
          {students.map((s) => (
            <option key={s.student_id} value={s.student_id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          id="searchInput"
          placeholder="Search sessions..."
          value={search}
          onChange={handleSearchInput}
        />
        <span className="count" id="sessionCount">
          {sessionCount} sessions
        </span>
      </div>
    </div>
  );
}
