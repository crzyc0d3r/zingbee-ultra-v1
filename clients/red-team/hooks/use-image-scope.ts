"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchImageOptions,
  fetchScopeStructure,
  fetchSubjectPhases,
} from "@/lib/images/api";
import type {
  ImageEvalOptions,
  ImageScope,
  SubjectPhase,
} from "@/lib/images/types";

const STORAGE_PREFIX = "zb-scope-";

type PersistedScope = {
  subject: string;
  phase: number;
  theme: string;
  capsule: string;
};

function loadPersistedScope(key: string): PersistedScope | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersistedScope(key: string, scope: PersistedScope) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(scope));
  } catch {
    // localStorage unavailable or full
  }
}

export function useImageScope(persistKey?: string) {
  const [subjects, setSubjects] = useState<Record<string, SubjectPhase[]>>({});
  const [subject, setSubject] = useState("");
  const [phase, setPhase] = useState(0);
  const [themes, setThemes] = useState<Record<string, string[]>>({});
  const [theme, setTheme] = useState("");
  const [capsule, setCapsule] = useState("");
  const [scopeWarning, setScopeWarning] = useState("");
  const restoredRef = useRef(false);
  const [options, setOptions] = useState<ImageEvalOptions>({
    availableImageModels: [],
    availablePromptStrategies: [],
    promptVersions: [],
    models: [],
    promptStrategies: [],
  });
  const [error, setError] = useState("");

  const phaseOptions = useMemo(() => subjects[subject] || [], [subjects, subject]);
  const themeOptions = useMemo(() => Object.keys(themes), [themes]);
  const capsuleOptions = useMemo(() => themes[theme] || [], [themes, theme]);
  const scope: ImageScope = useMemo(
    () => ({ subject, phase, theme, capsule }),
    [subject, phase, theme, capsule],
  );

  const loadSubjects = useCallback(async () => {
    const data = await fetchSubjectPhases();
    const mapped: Record<string, SubjectPhase[]> = {};
    Object.entries(data.subjects || {}).forEach(([name, info]) => {
      mapped[name] = info.phases || [];
    });
    setSubjects(mapped);
  }, []);

  const loadScopeStructure = useCallback(async () => {
    if (!subject || !phase) return;
    const data = await fetchScopeStructure({ subject, phase });
    setThemes(data.themes || {});
  }, [subject, phase]);

  const loadScopeOptions = useCallback(async () => {
    if (!subject || !phase || !theme || !capsule) {
      setOptions({
        availableImageModels: [],
        availablePromptStrategies: [],
        promptVersions: [],
        models: [],
        promptStrategies: [],
      });
      return;
    }
    const data = await fetchImageOptions({ subject, phase, theme, capsule });
    setOptions({
      availableImageModels: data.availableImageModels || [],
      availablePromptStrategies: data.availablePromptStrategies || [],
      promptVersions: data.promptVersions || [],
      models: data.models || [],
      promptStrategies: data.promptStrategies || [],
    });
  }, [subject, phase, theme, capsule]);

  useEffect(() => {
    loadSubjects().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load subjects.");
    });
  }, [loadSubjects]);

  // Restore persisted scope after subjects load
  useEffect(() => {
    if (!persistKey || restoredRef.current) return;
    const subjectNames = Object.keys(subjects);
    if (subjectNames.length === 0) return;
    restoredRef.current = true;

    const saved = loadPersistedScope(persistKey);
    if (!saved) return;

    if (subjectNames.includes(saved.subject)) {
      setSubject(saved.subject);
      setPhase(saved.phase);
      setTheme(saved.theme);
      setCapsule(saved.capsule);
      setScopeWarning("");
    } else {
      setScopeWarning("Previous scope no longer valid. Please reselect.");
    }
  }, [persistKey, subjects]);

  // Persist scope changes
  useEffect(() => {
    if (!persistKey || !subject) return;
    savePersistedScope(persistKey, { subject, phase, theme, capsule });
  }, [persistKey, subject, phase, theme, capsule]);

  useEffect(() => {
    if (!subject) return;
    if (phase && !phaseOptions.some((p) => p.phase === phase)) {
      setPhase(phaseOptions[0]?.phase || 0);
    }
  }, [subject, phase, phaseOptions]);

  useEffect(() => {
    if (!subject || !phase) return;
    loadScopeStructure().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load curriculum structure.");
    });
  }, [subject, phase, loadScopeStructure]);

  useEffect(() => {
    if (theme && !themeOptions.includes(theme)) {
      setTheme("");
    }
  }, [theme, themeOptions]);

  useEffect(() => {
    if (capsule && !capsuleOptions.includes(capsule)) {
      setCapsule("");
    }
  }, [capsule, capsuleOptions]);

  useEffect(() => {
    if (!subject || !phase || !theme || !capsule) return;
    loadScopeOptions().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load image options.");
    });
  }, [subject, phase, theme, capsule, loadScopeOptions]);

  return {
    subjects,
    phaseOptions,
    themeOptions,
    capsuleOptions,
    options,
    scope,
    subject,
    phase,
    theme,
    capsule,
    setSubject,
    setPhase,
    setTheme,
    setCapsule,
    error,
    setError,
    scopeWarning,
    reloadScopeOptions: loadScopeOptions,
  };
}
