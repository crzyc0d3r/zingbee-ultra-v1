"use client"

import { useEffect, useState } from "react"
import { Check, GraduationCap, History, PencilLine, Square, Star, Trophy } from "lucide-react"

export interface SidebarData {
  subject: string
  theme: string
  capsuleName: string
  currentFact: string
  currentStep: string
  tutor: { name: string; emoji: string }
  factsState: { taught: number; assessed: number; mastered: number }
  totalFacts: number
  phase: number
  onStopSession?: () => void
  busy?: boolean
  allFacts: string[]
  taughtTexts: string[]
  assessedTexts: string[]
  masteredTexts: string[]
}

// The session journey: Recall (returning students only) -> Learn -> Practice.
// The session ends when practice ends; the capsule's single Evidence check only
// happens once ALL facts are complete, in its own session — so Evidence is not
// a step of this per-session tracker. When the engine does report EVIDENCE /
// CAPSULE_COMPLETE, every step shows done and the caption explains the moment.
const RECALL_STEP = { key: "RECALL", label: "Recall", Icon: History }
const LEARN_STEPS = [
  { key: "TEACH", label: "Learn", Icon: GraduationCap },
  { key: "TRY", label: "Practice", Icon: PencilLine },
]

const PHASE_CAPTION: Record<string, string> = {
  RECALL: "Warming up — a quick recap",
  TEACH: "Learning something new",
  TRY: "Trying it yourself",
  EVIDENCE: "Showing what you've learned",
  CAPSULE_COMPLETE: "Capsule complete — great work!",
}

function journeyIndex(steps: { key: string }[], step: string): number {
  // EVIDENCE / CAPSULE_COMPLETE come after the whole journey -> all steps done
  if (step === "EVIDENCE" || step === "CAPSULE_COMPLETE") return steps.length
  const i = steps.findIndex((s) => s.key === step)
  return i // unknown -> -1, nothing filled yet
}

// Shared label style so the left pane reads the same as the vocab pane.
const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-slate-400"

export function CapsuleSidebar({ data }: { data: SidebarData }) {
  const { factsState, totalFacts } = data
  // taught/assessed/mastered are mutually exclusive buckets; a fact advances
  // taught -> assessed -> mastered and never moves back, so their sum is a
  // monotonic "how far through the session" signal. Mastery/assessment only
  // land at the final EVIDENCE step, so counting only those would leave the bar
  // at 0% for the whole teaching run.
  const done = factsState.taught + factsState.assessed + factsState.mastered
  const progressPct = totalFacts > 0 ? Math.round((done / totalFacts) * 100) : 0
  // Recall only exists for returning students. The step is latched (not just
  // currentStep === "RECALL") so it stays visible — marked done — after the
  // session moves into Learn. Re-arm on capsule switch.
  const [hadRecall, setHadRecall] = useState(false)
  useEffect(() => {
    setHadRecall(false)
  }, [data.capsuleName])
  useEffect(() => {
    if (data.currentStep === "RECALL") setHadRecall(true)
  }, [data.currentStep])
  const journey = hadRecall ? [RECALL_STEP, ...LEARN_STEPS] : LEARN_STEPS
  const active = journeyIndex(journey, data.currentStep)
  const caption = PHASE_CAPTION[data.currentStep]

  return (
    <div className="flex flex-col h-full">
      {/* Header — mirrors the vocab pane header treatment for a matching look */}
      <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-800 leading-tight truncate">
            {data.capsuleName || data.subject}
          </h2>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {data.subject} · Phase {data.phase}
          {data.tutor.name ? ` · with ${data.tutor.name}` : ""}
        </p>
        {data.theme && (
          <p className="mt-1 text-[11px] text-slate-500 leading-snug line-clamp-2">
            {data.theme}
          </p>
        )}
        {/* Today's fact — the one this session teaches */}
        {data.currentFact && (
          <p
            className="mt-1.5 text-[11px] font-medium text-blue-700 leading-snug line-clamp-2"
            title={data.currentFact}
          >
            {data.currentFact}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
        {/* Session journey tracker: Recall (when appropriate) -> Learn -> Practice */}
        <div>
          <p className={LABEL}>This session</p>
          <div className="mt-2.5 flex items-start">
            {journey.map((s, i) => {
              const state = i < active ? "done" : i === active ? "active" : "todo"
              const Icon = s.Icon
              return (
                <div
                  key={s.key}
                  className={`flex items-start ${i < journey.length - 1 ? "flex-1" : ""}`}
                >
                  <div className="flex w-14 shrink-0 flex-col items-center gap-1.5">
                    <div
                      className={[
                        "flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                        state === "active"
                          ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                          : state === "done"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-600"
                            : "border-slate-200 bg-white text-slate-300",
                      ].join(" ")}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span
                      className={[
                        "text-[10px] font-medium",
                        state === "active"
                          ? "text-blue-700"
                          : state === "done"
                            ? "text-emerald-600"
                            : "text-slate-400",
                      ].join(" ")}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < journey.length - 1 && (
                    <div
                      className={`mt-4 h-px flex-1 ${
                        i < active ? "bg-emerald-300" : "bg-slate-200"
                      }`}
                    />
                  )}
                </div>
              )
            })}
          </div>
          {caption && <p className="mt-3 text-xs text-slate-500">{caption}</p>}
        </div>

        {/* Current fact — the one fact this session is on */}
        {data.currentFact && (
          <div>
            <p className={LABEL}>You&apos;re on</p>
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm leading-relaxed text-slate-700">
                {data.currentFact}
              </p>
            </div>
          </div>
        )}

        {/* Capsule progress — how far through the WHOLE capsule this student
            is (facts persist across sessions; a session is just one slice).
            The final Evidence check is called out separately since it now
            runs in its own session after all facts are practiced. */}
        {totalFacts > 0 && (
          <div>
            <div className="flex items-center justify-between">
              <p className={LABEL}>Capsule progress</p>
              <span className="text-[11px] font-semibold text-slate-500">
                {done}/{totalFacts} facts
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {data.currentStep === "EVIDENCE"
                ? "Final check in progress"
                : data.currentStep === "CAPSULE_COMPLETE"
                  ? "Capsule complete!"
                  : done >= totalFacts
                    ? "All facts practiced — final check next session"
                    : `${totalFacts - done} to go`}
              {factsState.mastered > 0 && ` · ${factsState.mastered} mastered`}
            </p>

            {/* Mini capsule tree: every fact in order, then the final
                Evidence check. Statuses come from the same text lists the
                engine reports (taught/assessed/mastered + current). */}
            {data.allFacts.length > 0 && (
              <div className="mt-3 ml-1 border-l border-slate-200 pl-3 space-y-1.5">
                {data.allFacts.map((fact) => {
                  const isMastered = data.masteredTexts.includes(fact)
                  const isDone =
                    isMastered ||
                    data.taughtTexts.includes(fact) ||
                    data.assessedTexts.includes(fact)
                  const isCurrent = fact === data.currentFact && !isDone
                  return (
                    <div
                      key={fact}
                      className="flex items-start gap-2 text-[11px] leading-snug"
                      title={fact}
                    >
                      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        {isMastered ? (
                          <Star className="h-3 w-3 text-amber-500 fill-amber-400" />
                        ) : isDone ? (
                          <Check className="h-3 w-3 text-emerald-500" strokeWidth={3} />
                        ) : isCurrent ? (
                          <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                        ) : (
                          <span className="h-2 w-2 rounded-full border border-slate-300 bg-white" />
                        )}
                      </span>
                      <span
                        className={`line-clamp-1 ${
                          isCurrent
                            ? "font-medium text-blue-700"
                            : isDone
                              ? "text-slate-400"
                              : "text-slate-500"
                        }`}
                      >
                        {fact}
                      </span>
                    </div>
                  )
                })}

                {/* Final Evidence node */}
                <div className="flex items-start gap-2 text-[11px] leading-snug">
                  <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    <Trophy
                      className={`h-3 w-3 ${
                        data.currentStep === "CAPSULE_COMPLETE"
                          ? "text-amber-500 fill-amber-400"
                          : data.currentStep === "EVIDENCE"
                            ? "text-blue-500"
                            : done >= totalFacts
                              ? "text-amber-500"
                              : "text-slate-300"
                      }`}
                    />
                  </span>
                  <span
                    className={
                      data.currentStep === "CAPSULE_COMPLETE"
                        ? "font-medium text-amber-600"
                        : data.currentStep === "EVIDENCE"
                          ? "font-medium text-blue-700"
                          : done >= totalFacts
                            ? "text-amber-600"
                            : "text-slate-400"
                    }
                  >
                    {data.currentStep === "CAPSULE_COMPLETE"
                      ? "Evidence — passed!"
                      : data.currentStep === "EVIDENCE"
                        ? "Evidence — in progress"
                        : done >= totalFacts
                          ? "Evidence — next session"
                          : "Evidence — final check"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stop Session */}
      {data.onStopSession && (
        <div className="p-4 border-t border-slate-200">
          <button
            onClick={data.onStopSession}
            disabled={data.busy}
            className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors ${data.busy ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed" : "bg-red-50 hover:bg-red-100 border-red-200 text-red-600"}`}
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            Stop Session
          </button>
        </div>
      )}
    </div>
  )
}
