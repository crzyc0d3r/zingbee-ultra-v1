"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { apiClient, type CapsuleWithProgress, type CapsuleFact } from "@/lib/api-client"
import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import {
  Check,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  Play,
  Sparkles,
  Star,
  Trophy,
  Zap,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThemeData {
  id: string
  title: string
  title_key: string
  name: string
  description: string
  icon?: string
  capsule_count: number
  phase: number
}

interface CapsuleProgress {
  id: string
  name: string
  title?: string
  capsule_order: number
  display_order?: number
  has_completed?: boolean
  status?: "not_started" | "in_progress" | "completed" | "mastered"
  session_count?: number
  best_accuracy?: number
  check_score?: number
  credit_value?: number
  credit_earned?: number
}

interface TutorInfo {
  id: string
  name: string
  description: string
  traits: string[]
}

// ---------------------------------------------------------------------------
// Subject icon mapping (mirrors themes page)
// ---------------------------------------------------------------------------

const subjectIcons: Record<string, string> = {
  Math: "/icons/glassmorphism/drafting-compass.svg",
  Mathematics: "/icons/glassmorphism/drafting-compass.svg",
  English: "/icons/glassmorphism/quill-with-ink.svg",
  "English Language & Literature": "/icons/glassmorphism/quill-with-ink.svg",
  Biology: "/icons/glassmorphism/biotech.svg",
  Chemistry: "/icons/glassmorphism/microscope.svg",
  Physics: "/icons/glassmorphism/telescope.svg",
}

// ---------------------------------------------------------------------------
// Tutor gradient palette -- gives each tutor card a distinct color
// ---------------------------------------------------------------------------

const tutorGradients = [
  { bg: "from-violet-500 to-purple-600", light: "bg-violet-50 border-violet-200", ring: "ring-violet-300", text: "text-violet-700" },
  { bg: "from-sky-500 to-cyan-600", light: "bg-sky-50 border-sky-200", ring: "ring-sky-300", text: "text-sky-700" },
  { bg: "from-amber-500 to-orange-600", light: "bg-amber-50 border-amber-200", ring: "ring-amber-300", text: "text-amber-700" },
  { bg: "from-emerald-500 to-teal-600", light: "bg-emerald-50 border-emerald-200", ring: "ring-emerald-300", text: "text-emerald-700" },
  { bg: "from-rose-500 to-pink-600", light: "bg-rose-50 border-rose-200", ring: "ring-rose-300", text: "text-rose-700" },
  { bg: "from-indigo-500 to-blue-600", light: "bg-indigo-50 border-indigo-200", ring: "ring-indigo-300", text: "text-indigo-700" },
]

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function StartSessionPage() {
  const router = useRouter()
  const { isLoading: isAuthLoading } = useAuth()

  const [themeData, setThemeData] = useState<ThemeData | null>(null)
  const [subjectData, setSubjectData] = useState<any>(null)
  const [capsules, setCapsules] = useState<CapsuleProgress[]>([])
  const [tutors, setTutors] = useState<TutorInfo[]>([])
  const [selectedTutor, setSelectedTutor] = useState<TutorInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  // Capsule -> its facts (children). Fetched lazily when a capsule is expanded.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [factsByCapsule, setFactsByCapsule] = useState<Record<string, CapsuleFact[]>>({})
  const [factsLoading, setFactsLoading] = useState<Record<string, boolean>>({})

  const loadFacts = (capsuleId: string) => {
    if (factsByCapsule[capsuleId] || factsLoading[capsuleId]) return
    setFactsLoading((m) => ({ ...m, [capsuleId]: true }))
    // Pass the student so each fact carries its completion flags
    let studentId: string | undefined
    try {
      studentId = JSON.parse(localStorage.getItem("student") || "null")?.id
    } catch {}
    apiClient.capsules
      .getFacts(capsuleId, studentId)
      .then((facts) => setFactsByCapsule((m) => ({ ...m, [capsuleId]: facts })))
      .catch(() => setFactsByCapsule((m) => ({ ...m, [capsuleId]: [] })))
      .finally(() => setFactsLoading((m) => ({ ...m, [capsuleId]: false })))
  }

  const toggleCapsule = (capsuleId: string) => {
    setExpandedId((cur) => (cur === capsuleId ? null : capsuleId))
    loadFacts(capsuleId)
  }

  // Which fact (step) the student has selected to jump to.
  const [selectedFact, setSelectedFact] = useState<{ capsuleId: string; factId: string } | null>(null)

  // Selection is sticky: the selected fact is what the session starts on, so
  // clicking it again must NOT deselect it — you can only move the selection
  // to another (incomplete) fact, never to nothing.
  const selectFact = (capsuleId: string, factId: string) => {
    setSelectedFact({ capsuleId, factId })
    localStorage.setItem("selectedFact", JSON.stringify({ capsuleId, factId }))
  }

  // ---- Data loading -------------------------------------------------------

  useEffect(() => {
    const theme = localStorage.getItem("selectedTheme")
    const subject = localStorage.getItem("selectedSubject")

    if (!theme) {
      router.push("/tutors/themes")
      return
    }

    const parsedTheme = JSON.parse(theme) as ThemeData
    setThemeData(parsedTheme)

    if (subject) {
      setSubjectData(JSON.parse(subject))
    }

    // Load tutors
    const backendUrl = (
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000/api"
    ).replace(/\/api\/?$/, "")
    fetch(`${backendUrl}/api/tutors`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: TutorInfo[]) => {
        setTutors(data)
        if (data.length > 0) setSelectedTutor(data[0])
      })
      .catch(() => {})

    // Load capsule progress
    const student = localStorage.getItem("student")
    if (student && parsedTheme.id) {
      const studentId = JSON.parse(student).id
      apiClient.capsules
        .getWithProgress(studentId, parsedTheme.id)
        .then((data) => setCapsules(normalizeCapsules(data)))
        .catch(() => {
          apiClient.capsules
            .list(parsedTheme.id)
            .then((data) =>
              setCapsules(
                data.map((c) => ({
                  id: c.id,
                  name: c.title,
                  capsule_order: c.display_order,
                }))
              )
            )
            .catch(() => setCapsules([]))
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [router])

  // Auto-expand the "Up Next" capsule so its facts show as children by default
  // when the student lands here to start a session.
  useEffect(() => {
    if (capsules.length === 0) return
    const idx = capsules.findIndex((c) => !c.has_completed)
    const next = capsules[idx >= 0 ? idx : 0]
    if (next) {
      setExpandedId(next.id)
      loadFacts(next.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capsules])

  // Auto-select the first not-yet-completed fact once the "Up Next" capsule's
  // facts load, so the student starts on the right step by default. Runs once;
  // if every fact is complete, nothing is selected.
  const autoSelectedFactRef = useRef(false)
  useEffect(() => {
    if (autoSelectedFactRef.current || capsules.length === 0) return
    const idx = capsules.findIndex((c) => !c.has_completed)
    const next = capsules[idx >= 0 ? idx : 0]
    const facts = next ? factsByCapsule[next.id] : undefined
    if (!next || !facts) return
    autoSelectedFactRef.current = true
    if (selectedFact?.capsuleId === next.id) return
    const nextFact = facts.find(
      (f) => !(f.is_mastered || f.is_taught || f.is_assessed)
    )
    if (nextFact) selectFact(next.id, nextFact.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capsules, factsByCapsule])

  // Normalize CapsuleWithProgress into our local CapsuleProgress shape
  function normalizeCapsules(data: CapsuleWithProgress[]): CapsuleProgress[] {
    return data.map((c) => ({
      id: c.id,
      name: c.title,
      title: c.title,
      capsule_order: c.display_order,
      display_order: c.display_order,
      has_completed: c.status === "completed" || c.status === "mastered",
      status: c.status,
      check_score: c.check_score,
      credit_value: c.credit_value,
      credit_earned: c.credit_earned,
    }))
  }

  // ---- Handlers -----------------------------------------------------------

  const handleStart = async () => {
    if (!themeData || !selectedTutor) return
    setStarting(true)

    // Write the capsule AND the selected fact to the report card so the
    // backend starts the session exactly where the student chose. A silent
    // failure here previously meant the student stayed on whatever
    // current_position was last persisted (often a different subject).
    const nextCap = capsules[nextCapsuleIdx >= 0 ? nextCapsuleIdx : 0]
    const startCapsuleId = selectedFact?.capsuleId || nextCap?.id
    const student = localStorage.getItem("student")
    if (startCapsuleId && student) {
      try {
        const studentId = JSON.parse(student).id
        const resp = await fetch("/api/academy/start-capsule", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            student_id: studentId,
            capsule_id: startCapsuleId,
            fact_id: selectedFact?.factId || null,
          }),
        })
        if (!resp.ok) {
          console.error("[start-capsule] non-OK response", resp.status, await resp.text().catch(() => ""))
        }
      } catch (err) {
        console.error("[start-capsule] network error", err)
      }
    }

    localStorage.setItem(
      "selectedTutor",
      JSON.stringify({
        id: selectedTutor.id,
        name: selectedTutor.name,
        description: selectedTutor.description,
        specialty: subjectData?.specialty || "",
        voice: (selectedTutor as any).voice || "",
      })
    )
    localStorage.setItem("sessionStartTime", new Date().toISOString())
    router.push("/tutors/learning")
  }

  // ---- Derived data -------------------------------------------------------

  const completedCount = capsules.filter((c) => c.has_completed).length
  const totalCount = capsules.length
  const progressPct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  // Find the "next" capsule -- first one that is not completed
  const nextCapsuleIdx = capsules.findIndex((c) => !c.has_completed)

  const subjectIconSrc =
    subjectIcons[subjectData?.specialty] || "/icons/glassmorphism/open-book.svg"

  // ---- Loading state ------------------------------------------------------

  if (isAuthLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <DashboardHeader />
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/80 shadow-lg flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
          <p className="text-slate-500 text-sm">Preparing your session...</p>
        </div>
      </div>
    )
  }

  // ---- Render -------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <DashboardHeader />

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* ---------------------------------------------------------------- */}
        {/* Hero banner                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section className="relative mb-10 rounded-3xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 p-8 md:p-10 text-white overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" aria-hidden="true" />
          <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-white/10" aria-hidden="true" />
          <div className="absolute top-1/2 right-1/4 w-16 h-16 rounded-full bg-white/5" aria-hidden="true" />

          <div className="relative flex flex-col md:flex-row items-center gap-6">
            {/* Subject icon */}
            <div className="shrink-0 w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
              <Image
                src={subjectIconSrc}
                alt={subjectData?.specialty || "Subject"}
                width={52}
                height={52}
                className="object-contain drop-shadow-lg"
              />
            </div>

            <div className="flex-1 text-center md:text-left">
              <p className="text-blue-100 text-sm font-medium tracking-wide uppercase mb-1">
                {subjectData?.specialty || "Subject"} -- Phase{" "}
                {themeData?.phase || 1}
              </p>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
                {themeData?.title || themeData?.name}
              </h1>
              {themeData?.description && (
                <p className="text-blue-100 text-sm md:text-base max-w-xl leading-relaxed">
                  {themeData.description}
                </p>
              )}
            </div>

            {/* Stats pills */}
            <div className="shrink-0 flex flex-row md:flex-col gap-3">
              <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2.5">
                <Trophy className="w-5 h-5 text-amber-300" />
                <div className="text-center">
                  <p className="text-lg font-medium leading-tight">
                    {completedCount}/{totalCount}
                  </p>
                  <p className="text-[10px] text-blue-100 uppercase tracking-wide">
                    Done
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2.5">
                <Zap className="w-5 h-5 text-yellow-300" />
                <div className="text-center">
                  <p className="text-lg font-medium leading-tight">
                    {progressPct}%
                  </p>
                  <p className="text-[10px] text-blue-100 uppercase tracking-wide">
                    Progress
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Full-width progress bar at bottom of banner */}
          <div className="relative mt-6">
            <div className="w-full h-3 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-yellow-300 to-amber-400 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Two column layout: Capsules + Tutor selection                     */}
        {/* ---------------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* ============================================================== */}
          {/* LEFT COLUMN - Capsule roadmap (takes 3 of 5 cols on desktop)   */}
          {/* ============================================================== */}
          <section className="lg:col-span-3" aria-label="Capsule progress">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-medium text-slate-800">
                Your Learning Roadmap
              </h2>
              <span className="text-sm text-slate-500 font-medium">
                {completedCount} of {totalCount} capsules
              </span>
            </div>

            <div className="space-y-3">
              {capsules.map((capsule, idx) => {
                const isCompleted = capsule.has_completed
                const isMastered = capsule.status === "mastered"
                const isNext = idx === nextCapsuleIdx
                const isLocked = !isCompleted && !isNext

                return (
                  <Card
                    key={capsule.id}
                    className={`border transition-all duration-200 ${
                      isCompleted
                        ? "bg-emerald-50/60 border-emerald-200 shadow-sm"
                        : isNext
                          ? "bg-blue-50/80 border-blue-300 shadow-md ring-1 ring-blue-200"
                          : "bg-white border-slate-150 opacity-75"
                    }`}
                  >
                    <CardContent className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => toggleCapsule(capsule.id)}
                        aria-expanded={expandedId === capsule.id}
                        className="w-full flex items-center gap-4 text-left"
                      >
                        {/* Step indicator */}
                        <div className="shrink-0">
                          {isMastered ? (
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shadow-md">
                              <Star className="w-5 h-5 text-white fill-white" />
                            </div>
                          ) : isCompleted ? (
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-md">
                              <Check className="w-5 h-5 text-white" strokeWidth={3} />
                            </div>
                          ) : isNext ? (
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center shadow-md animate-pulse">
                              <Play className="w-5 h-5 text-white ml-0.5" />
                            </div>
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
                              {isLocked ? (
                                <Lock className="w-4 h-4 text-slate-300" />
                              ) : (
                                <span className="text-sm font-semibold text-slate-400">
                                  {idx + 1}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p
                              className={`text-sm font-semibold ${
                                isCompleted
                                  ? "text-emerald-800"
                                  : isNext
                                    ? "text-blue-800"
                                    : "text-slate-500"
                              }`}
                            >
                              Capsule {idx + 1}
                            </p>
                            {isNext && (
                              <span className="text-[10px] font-medium uppercase tracking-wider text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                Up Next
                              </span>
                            )}
                            {isMastered && (
                              <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                                Mastered
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-base font-medium mt-0.5 ${
                              isCompleted
                                ? "text-emerald-900"
                                : isNext
                                  ? "text-slate-900"
                                  : "text-slate-400"
                            }`}
                          >
                            {capsule.name || capsule.title}
                          </p>
                        </div>

                        {/* Right side badges */}
                        <div className="shrink-0 flex items-center gap-2">
                          {capsule.check_score != null && capsule.check_score > 0 && (
                            <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                              {Math.round(capsule.check_score * 100)}%
                            </span>
                          )}
                          {capsule.best_accuracy != null && capsule.best_accuracy > 0 && (
                            <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                              {Math.round(capsule.best_accuracy * 100)}%
                            </span>
                          )}
                          {capsule.session_count != null && capsule.session_count > 0 && (
                            <span className="text-xs text-slate-400">
                              {capsule.session_count} session
                              {capsule.session_count > 1 ? "s" : ""}
                            </span>
                          )}
                          <ChevronRight
                            className={`w-5 h-5 shrink-0 transition-transform ${
                              expandedId === capsule.id
                                ? "rotate-90 text-blue-500"
                                : "text-slate-400"
                            }`}
                          />
                        </div>
                      </button>

                      {/* Facts as children of this capsule */}
                      {expandedId === capsule.id && (
                        <div className="mt-3 ml-[3.75rem] border-l border-slate-200 pl-4">
                          {factsLoading[capsule.id] ? (
                            <p className="flex items-center gap-2 py-2 text-xs text-slate-400">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Loading facts...
                            </p>
                          ) : factsByCapsule[capsule.id]?.length ? (
                            <ol className="space-y-1.5 py-1">
                              {factsByCapsule[capsule.id].map((f, fi) => {
                                const isSelected = selectedFact?.factId === f.id
                                const isFactMastered = !!f.is_mastered
                                const isFactDone =
                                  isFactMastered || !!f.is_taught || !!f.is_assessed
                                return (
                                  <li key={f.id} className="relative">
                                    <span
                                      className="absolute -left-4 top-1/2 w-3 h-px bg-slate-200"
                                      aria-hidden="true"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => selectFact(capsule.id, f.id)}
                                      disabled={isFactDone}
                                      aria-disabled={isFactDone}
                                      aria-pressed={isSelected}
                                      className={`w-full flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                                        isSelected
                                          ? "border-blue-300 bg-blue-50 ring-1 ring-blue-200"
                                          : isFactDone
                                            ? "border-emerald-150 bg-emerald-50/50 cursor-default"
                                            : "border-slate-150 bg-white hover:border-blue-200 hover:bg-blue-50/40"
                                      }`}
                                    >
                                      <span
                                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                                          isSelected
                                            ? "bg-blue-500 text-white"
                                            : isFactMastered
                                              ? "bg-gradient-to-br from-amber-400 to-yellow-500 text-white"
                                              : isFactDone
                                                ? "bg-emerald-500 text-white"
                                                : "bg-slate-100 text-slate-500"
                                        }`}
                                      >
                                        {isSelected ? (
                                          <Check className="w-3 h-3" strokeWidth={3} />
                                        ) : isFactMastered ? (
                                          <Star className="w-3 h-3 fill-white" />
                                        ) : isFactDone ? (
                                          <Check className="w-3 h-3" strokeWidth={3} />
                                        ) : (
                                          fi + 1
                                        )}
                                      </span>
                                      <span
                                        className={`flex-1 leading-relaxed ${
                                          isSelected
                                            ? "font-medium text-blue-900"
                                            : isFactDone
                                              ? "text-slate-500"
                                              : "text-slate-600"
                                        }`}
                                      >
                                        {f.core_fact}
                                      </span>
                                      {!isSelected && isFactDone && (
                                        <span
                                          className={`mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${
                                            isFactMastered
                                              ? "text-amber-700 bg-amber-100"
                                              : "text-emerald-700 bg-emerald-100"
                                          }`}
                                        >
                                          {isFactMastered ? "Mastered" : "Completed"}
                                        </span>
                                      )}
                                    </button>
                                  </li>
                                )
                              })}

                              {/* Final EVIDENCE step — comes after all facts */}
                              <li className="relative">
                                <span
                                  className="absolute -left-4 top-1/2 w-3 h-px bg-slate-200"
                                  aria-hidden="true"
                                />
                                <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
                                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                                    <Trophy className="w-3 h-3" />
                                  </span>
                                  <span className="leading-relaxed font-medium text-amber-800">
                                    Evidence — final check on everything
                                  </span>
                                </div>
                              </li>
                            </ol>
                          ) : (
                            <p className="py-2 text-xs text-slate-400">
                              No facts listed for this capsule yet.
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}

              {capsules.length === 0 && (
                <Card className="border border-dashed border-slate-200">
                  <CardContent className="py-12 text-center">
                    <p className="text-slate-400 text-sm">
                      No capsules found for this theme yet.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </section>

          {/* ============================================================== */}
          {/* RIGHT COLUMN - Tutor selection + Start button (2 of 5 cols)    */}
          {/* ============================================================== */}
          <section className="lg:col-span-2 space-y-6" aria-label="Choose your tutor">
            {/* Tutor picker */}
            <div>
              <h2 className="text-xl font-medium text-slate-800 mb-4">
                Choose Your Tutor
              </h2>

              <div className="space-y-3">
                {tutors.map((tutor, idx) => {
                  const isSelected = selectedTutor?.id === tutor.id
                  const palette = tutorGradients[idx % tutorGradients.length]
                  const traits = Array.isArray(tutor.traits) ? tutor.traits : []

                  return (
                    <button
                      key={tutor.id}
                      onClick={() => setSelectedTutor(tutor)}
                      className={`w-full text-left rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
                        isSelected
                          ? `${palette.light} ring-2 ${palette.ring} shadow-md`
                          : "bg-white border-slate-150 hover:border-slate-200 hover:shadow-sm"
                      }`}
                      aria-pressed={isSelected}
                    >
                      <div className="p-4">
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div
                            className={`w-12 h-12 rounded-xl bg-gradient-to-br ${palette.bg} flex items-center justify-center shadow-md`}
                          >
                            <span className="text-xl font-medium text-white">
                              {tutor.name.charAt(0)}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-base font-medium text-slate-800">
                              {tutor.name}
                            </p>
                            <p className="text-xs text-slate-500 capitalize truncate">
                              {tutor.description}
                            </p>
                          </div>

                          {/* Selection indicator */}
                          {isSelected && (
                            <div
                              className={`w-7 h-7 rounded-full bg-gradient-to-br ${palette.bg} flex items-center justify-center shadow-sm`}
                            >
                              <Check
                                className="w-4 h-4 text-white"
                                strokeWidth={3}
                              />
                            </div>
                          )}
                        </div>

                        {/* Personality traits -- shown only for the selected tutor */}
                        {isSelected && traits.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <p
                              className={`text-[11px] font-semibold uppercase tracking-wider ${palette.text} mb-2`}
                            >
                              Personality
                            </p>
                            <p className="text-sm text-slate-600 leading-relaxed">
                              {traits
                                .map((trait) =>
                                  typeof trait === "string"
                                    ? trait.replace(/^[-\s]+/, "").trim()
                                    : ""
                                )
                                .filter(Boolean)
                                .map((s) => (/[.!?]$/.test(s) ? s : s + "."))
                                .join(" ")}
                            </p>
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}

                {tutors.length === 0 && (
                  <Card className="border border-dashed border-slate-200">
                    <CardContent className="py-8 text-center">
                      <Loader2 className="w-5 h-5 animate-spin text-slate-300 mx-auto mb-2" />
                      <p className="text-xs text-slate-400">Loading tutors...</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* Start session card */}
            <Card className="border-0 bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 text-white shadow-xl rounded-2xl overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Sparkles className="w-6 h-6 text-yellow-300" />
                  <h3 className="text-lg font-medium">Ready to learn?</h3>
                </div>

                {selectedTutor && (
                  <p className="text-blue-100 text-sm mb-5 leading-relaxed">
                    <span className="font-semibold text-white">
                      {selectedTutor.name}
                    </span>{" "}
                    will guide you through{" "}
                    {nextCapsuleIdx >= 0
                      ? `"${capsules[nextCapsuleIdx]?.name || "the next capsule"}"`
                      : "your learning session"}
                    .
                  </p>
                )}

                <Button
                  onClick={handleStart}
                  disabled={starting || !selectedTutor}
                  size="lg"
                  className="w-full h-14 text-lg font-medium bg-white text-indigo-700 hover:bg-indigo-50 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {starting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 mr-2" />
                      Start Learning Session
                    </>
                  )}
                </Button>

                <p className="text-blue-200 text-xs text-center mt-3 flex items-center justify-center gap-1">
                  <Clock className="w-3 h-3" />
                  Session timer starts when you begin
                </p>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  )
}
