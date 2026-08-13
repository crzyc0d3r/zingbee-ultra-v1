"use client";

import { useRef, useState } from "react";
import { SubjectGrid } from "./SubjectGrid";
import type { SubjectEntry } from "./SubjectGrid";
import { SimControls } from "./SimControls";
import type { SimControlsHandle } from "./SimControls";
import { Modal } from "@/components/ui/Modal";
import type { StudentInfo } from "@/lib/types";

export type SessionMode = "text" | "voice";

export interface TutorOption {
  id: string;
  name: string;
  description: string;
}

interface StartScreenProps {
  currentSubject: string;
  onSelectSubject: (subject: string) => void;
  onStartNew: (simValues: {
    phase: number;
    step: number;
    theme: string;
    capsule: string;
    factIndex: number;
  }, mode: SessionMode) => void;
  onContinue: (mode: SessionMode) => void;
  onShowStudentDetails: () => void;
  onReset: () => void;
  showContinue: boolean;
  hasProgress?: boolean;
  students: StudentInfo[];
  studentId: string;
  onSwitchStudent: (id: string) => void;
  onCreateStudent: (name: string) => Promise<void>;
  tutors: TutorOption[];
  selectedTutorId: string | null;
  onSelectTutor: (tutorId: string | null) => void;
  subjects: SubjectEntry[];
}

export function StartScreen({
  currentSubject,
  onSelectSubject,
  onStartNew,
  onContinue,
  onShowStudentDetails,
  onReset,
  showContinue,
  hasProgress,
  students,
  studentId,
  onSwitchStudent,
  onCreateStudent,
  tutors,
  selectedTutorId,
  onSelectTutor,
  subjects,
}: StartScreenProps) {
  const simRef = useRef<SimControlsHandle>(null);
  const [starting, setStarting] = useState(false);
  const [showNewStudent, setShowNewStudent] = useState(false);
  const [newStudentName, setNewStudentName] = useState("");
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>("text");

  const handleStart = () => {
    if (simRef.current && !starting) {
      setStarting(true);
      onStartNew(simRef.current.getValues(), sessionMode);
    }
  };

  const handleContinue = () => {
    if (!starting) {
      setStarting(true);
      onContinue(sessionMode);
    }
  };

  const handleCreateStudent = async () => {
    const name = newStudentName.trim();
    if (!name || creatingStudent) return;
    setCreatingStudent(true);
    try {
      await onCreateStudent(name);
      setNewStudentName("");
      setShowNewStudent(false);
    } catch (e) {
      console.error("Failed to create student:", e);
    } finally {
      setCreatingStudent(false);
    }
  };

  return (
    <div className="start-screen" id="startScreen">
      <img
        src="/static/robot-bee.png"
        alt="ZingBee"
        width={100}
        height={100}
        className="start-bee"
      />
      <div className="start-title">ZingBee RT Studio</div>
      <div className="start-subtitle">Choose your subject to begin</div>

      <div
        id="studentPickerWrap"
        style={{ margin: "16px 0", width: "100%", maxWidth: "320px" }}
      >
        <label
          style={{
            display: "block",
            color: "#94a3b8",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: "4px",
          }}
        >
          Student Profile
        </label>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <select
            id="studentPicker"
            value={studentId}
            onChange={(e) => onSwitchStudent(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid #333",
              borderRadius: "6px",
              background: "#0f1629",
              color: "#eee",
              fontSize: "14px",
              outline: "none",
              cursor: "pointer",
            }}
          >
            {[...students].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
              <option key={s.student_id} value={s.student_id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowNewStudent(true)}
            title="Add new student"
            style={{
              padding: "6px 10px",
              border: "1px solid #444",
              borderRadius: "6px",
              background: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: "16px",
              lineHeight: 1,
              whiteSpace: "nowrap",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.borderColor = "#22c55e";
              (e.target as HTMLElement).style.color = "#22c55e";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.borderColor = "#444";
              (e.target as HTMLElement).style.color = "#888";
            }}
          >
            +
          </button>
          <button
            onClick={onShowStudentDetails}
            title="View student details"
            style={{
              padding: "6px 10px",
              border: "1px solid #444",
              borderRadius: "6px",
              background: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: "12px",
              whiteSpace: "nowrap",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.borderColor = "#3b82f6";
              (e.target as HTMLElement).style.color = "#3b82f6";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.borderColor = "#444";
              (e.target as HTMLElement).style.color = "#888";
            }}
          >
            Details
          </button>
          <button
            onClick={onReset}
            title="Reset student progress"
            style={{
              padding: "6px 10px",
              border: "1px solid #444",
              borderRadius: "6px",
              background: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: "12px",
              whiteSpace: "nowrap",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.borderColor = "#ef4444";
              (e.target as HTMLElement).style.color = "#ef4444";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.borderColor = "#444";
              (e.target as HTMLElement).style.color = "#888";
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <Modal
        open={showNewStudent}
        onClose={() => { setShowNewStudent(false); setNewStudentName(""); }}
        title="New Student"
        maxWidth="340px"
        footer={
          <>
            <button
              onClick={() => { setShowNewStudent(false); setNewStudentName(""); }}
              style={{ padding: "8px 16px", border: "1px solid #475569", borderRadius: "8px", background: "none", color: "#94a3b8", fontSize: "13px", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateStudent}
              disabled={!newStudentName.trim() || creatingStudent}
              style={{
                padding: "8px 16px", border: "none", borderRadius: "8px",
                background: !newStudentName.trim() || creatingStudent ? "#334155" : "#22c55e",
                color: !newStudentName.trim() || creatingStudent ? "#64748b" : "#fff",
                fontSize: "13px", fontWeight: 600,
                cursor: !newStudentName.trim() || creatingStudent ? "not-allowed" : "pointer",
              }}
            >
              {creatingStudent ? "Creating..." : "Create"}
            </button>
          </>
        }
      >
        <input
          type="text"
          value={newStudentName}
          onChange={(e) => setNewStudentName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateStudent();
            if (e.key === "Escape") setShowNewStudent(false);
          }}
          placeholder="Enter student name"
          autoFocus
          style={{
            width: "100%", padding: "10px 12px", border: "1px solid #475569",
            borderRadius: "8px", background: "#0f172a", color: "#f1f5f9",
            fontSize: "14px", outline: "none", boxSizing: "border-box",
          }}
        />
      </Modal>

      <SubjectGrid currentSubject={currentSubject} onSelect={onSelectSubject} subjects={subjects} />

      {tutors.length > 0 && (
        <div style={{ margin: "12px 0", width: "100%", maxWidth: "320px" }}>
          <label
            style={{
              display: "block",
              color: "#94a3b8",
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "4px",
            }}
          >
            Tutor Override
          </label>
          <select
            value={selectedTutorId || ""}
            onChange={(e) => onSelectTutor(e.target.value || null)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #333",
              borderRadius: "6px",
              background: "#0f1629",
              color: "#eee",
              fontSize: "14px",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="">Default (from curriculum)</option>
            {tutors.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.description ? ` — ${t.description}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <SimControls ref={simRef} currentSubject={currentSubject} />

      <div className="start-btn-row" style={{ alignItems: "center" }}>
        <button className="start-session-btn" onClick={handleStart} disabled={starting}>
          {starting ? "Starting\u2026" : "Start"}
        </button>
        {hasProgress && (
          <button className="start-session-btn" onClick={handleContinue} disabled={starting}
            style={{ background: "#334155", marginLeft: "8px" }}>
            {starting ? "Starting\u2026" : "Resume"}
          </button>
        )}
        <div
          onClick={() => setSessionMode(sessionMode === "text" ? "voice" : "text")}
          title={sessionMode === "text" ? "Switch to Voice Mode" : "Switch to Text Mode"}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            cursor: "pointer", userSelect: "none", marginLeft: "8px",
          }}
        >
          <span style={{ fontSize: "11px", color: "#94a3b8" }}>
            {sessionMode === "voice" ? "Voice" : "Text"}
          </span>
          <div style={{
            width: "34px", height: "18px", borderRadius: "9px",
            background: sessionMode === "voice" ? "#8b5cf6" : "#334155",
            position: "relative", transition: "background 0.2s",
          }}>
            <div style={{
              width: "14px", height: "14px", borderRadius: "50%",
              background: "#fff", position: "absolute", top: "2px",
              left: sessionMode === "voice" ? "18px" : "2px",
              transition: "left 0.2s",
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
