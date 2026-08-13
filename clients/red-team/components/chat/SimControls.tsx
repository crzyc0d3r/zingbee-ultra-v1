"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface SimControlsProps {
  currentSubject: string;
}

export interface SimValues {
  phase: number;
  step: number;
  theme: string;
  capsule: string;
  factIndex: number;
}

export interface SimControlsHandle {
  getValues: () => SimValues;
}

import { forwardRef, useImperativeHandle } from "react";

interface PhaseEntry { phase: number; age_range: string }

export const SimControls = forwardRef<SimControlsHandle, SimControlsProps>(
  function SimControls({ currentSubject }, ref) {
    const [allPhases, setAllPhases] = useState<Record<string, PhaseEntry[]>>({});
    const phases = allPhases[currentSubject] || [];
    const [phase, setPhase] = useState(1);
    const step = 2;

    const [themes, setThemes] = useState<Record<string, string[]>>({});
    const [selectedTheme, setSelectedTheme] = useState("");
    const [capsules, setCapsules] = useState<string[]>([]);
    const [selectedCapsule, setSelectedCapsule] = useState("");
    const [facts, setFacts] = useState<string[]>([]);
    const [factIndex, setFactIndex] = useState(0);
    const [loadingThemes, setLoadingThemes] = useState(false);
    const [loadingFacts, setLoadingFacts] = useState(false);

    const cacheRef = useRef<Record<string, Record<string, string[]>>>({});

    useImperativeHandle(ref, () => ({
      getValues: () => ({
        phase,
        step,
        theme: selectedTheme,
        capsule: selectedCapsule,
        factIndex,
      }),
    }));

    // Load all subject phases from API on mount
    useEffect(() => {
      apiFetch<{ subjects: Record<string, { tutor: string; phases: PhaseEntry[] }> }>("/api/subject-phases")
        .then((data) => {
          const mapped: Record<string, PhaseEntry[]> = {};
          for (const [name, info] of Object.entries(data.subjects)) mapped[name] = info.phases;
          setAllPhases(mapped);
        })
        .catch(() => {});
    }, []);

    // Reset phase when subject changes
    useEffect(() => {
      const subjectPhases = allPhases[currentSubject];
      setPhase(subjectPhases?.[0]?.phase ?? 1);
    }, [currentSubject, allPhases]);

    // Load themes when phase or subject changes
    const loadThemes = useCallback(async () => {
      const cacheKey = `${currentSubject}_${phase}`;
      if (cacheRef.current[cacheKey]) {
        const cached = cacheRef.current[cacheKey];
        setThemes(cached);
        const themeNames = Object.keys(cached);
        setSelectedTheme(themeNames[0] || "");
        return;
      }

      setLoadingThemes(true);
      try {
        const data = await apiFetch<{ themes: Record<string, string[]> }>(
          `/api/curriculum-structure/${phase}?subject=${encodeURIComponent(currentSubject)}`
        );
        if (data.themes) {
          cacheRef.current[cacheKey] = data.themes;
          setThemes(data.themes);
          const themeNames = Object.keys(data.themes);
          setSelectedTheme(themeNames[0] || "");
        }
      } catch {
        setThemes({});
        setSelectedTheme("");
      } finally {
        setLoadingThemes(false);
      }
    }, [currentSubject, phase]);

    useEffect(() => {
      loadThemes();
    }, [loadThemes]);

    // Update capsules when theme changes
    useEffect(() => {
      const caps = themes[selectedTheme] || [];
      setCapsules(caps);
      setSelectedCapsule(caps[0] || "");
    }, [selectedTheme, themes]);

    // Load facts when capsule changes
    useEffect(() => {
      if (!selectedCapsule) {
        setFacts([]);
        setFactIndex(0);
        return;
      }

      let cancelled = false;
      setLoadingFacts(true);

      fetch(`/api/capsule-facts/${encodeURIComponent(selectedCapsule)}`, {
        credentials: "include",
      })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setFacts(data.facts || []);
          setFactIndex(0);
        })
        .catch(() => {
          if (!cancelled) setFacts([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingFacts(false);
        });

      return () => {
        cancelled = true;
      };
    }, [selectedCapsule]);

    const themeNames = Object.keys(themes);

    return (
      <div className="start-sim-controls">
        <div className="sim-row">
          <div className="sim-group">
            <label>Phase:</label>
            <select
              id="simPhase"
              value={phase}
              onChange={(e) => setPhase(Number(e.target.value))}
            >
              {phases.length === 0
                ? <option disabled>Loading...</option>
                : phases.map((p) => (
                    <option key={p.phase} value={p.phase}>
                      Phase {p.phase} (Ages {p.age_range})
                    </option>
                  ))}
            </select>
          </div>
          <div className="sim-group">
            <label>Theme:</label>
            <select
              id="simTheme"
              value={selectedTheme}
              onChange={(e) => setSelectedTheme(e.target.value)}
              disabled={loadingThemes}
            >
              {loadingThemes ? (
                <option disabled>Loading...</option>
              ) : themeNames.length === 0 ? (
                <option disabled>No themes available</option>
              ) : (
                themeNames.map((t, i) => (
                  <option key={t} value={t}>
                    Theme {i + 1}: {t}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        <div className="sim-row">
          <div className="sim-group">
            <label>Capsule:</label>
            <select
              id="simCapsule"
              value={selectedCapsule}
              onChange={(e) => setSelectedCapsule(e.target.value)}
            >
              {capsules.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="sim-group">
            <label>Start at Fact:</label>
            <select
              id="simFacts"
              value={factIndex}
              onChange={(e) => setFactIndex(Number(e.target.value))}
              disabled={loadingFacts}
            >
              <option value={0}>Start from beginning</option>
              {facts.map((f, i) => (
                <option key={i} value={i} title={f}>
                  {i + 1}. {f}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  }
);
