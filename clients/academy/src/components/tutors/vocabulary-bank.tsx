"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { BookOpen, Check, ChevronDown, Pin, PinOff } from "lucide-react"
import { ScrollArea } from "@/components/shared/ui/scroll-area"
import type { VocabTerm } from "@/hooks/use-chat-stream"

// Age tiers map to working-memory capacity (Cowan): younger learners hold
// fewer chunks, so fewer terms stay expanded and definitions stay visible
// rather than gated behind a tap.
export type VocabTier = "young" | "middle" | "older"

export function ageTier(ageRange: string): VocabTier {
  const m = (ageRange || "").match(/\d+/)
  const low = m ? parseInt(m[0], 10) : NaN
  if (!Number.isNaN(low)) {
    if (low <= 10) return "young"
    if (low <= 13) return "middle"
    return "older"
  }
  return "middle" // safe default
}

const EXPAND_CAP: Record<VocabTier, number> = { young: 3, middle: 4, older: 4 }

interface Props {
  terms: VocabTerm[]
  ageRange: string
  pinned: string[]
  onTogglePin: (term: string) => void
  definitionsHidden?: boolean
  variant?: "sidebar" | "drawer"
}

export function VocabularyBank({
  terms,
  ageRange,
  pinned,
  onTogglePin,
  definitionsHidden = false,
  variant = "sidebar",
}: Props) {
  const t = useTranslations()
  const tier = ageTier(ageRange)
  const cap = EXPAND_CAP[tier]
  const allowPin = tier !== "young"
  // Older learners get retrieval practice: already-taught definitions hide
  // behind a tap. Young/middle keep them visible.
  const tapToReveal = tier === "older"

  const pinnedSet = new Set(pinned.map((p) => p.toLowerCase()))

  // Track which terms are newly arrived (for an aria announcement + a one-shot
  // pulse) by diffing the term set across renders.
  const prevKeys = useRef<Set<string>>(new Set())
  const [pulsed, setPulsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    const current = new Set(terms.map((v) => v.term.toLowerCase()))
    const fresh = new Set<string>()
    current.forEach((k) => {
      if (!prevKeys.current.has(k)) fresh.add(k)
    })
    prevKeys.current = current
    if (fresh.size) {
      setPulsed(fresh)
      const id = setTimeout(() => setPulsed(new Set()), 1500)
      return () => clearTimeout(id)
    }
  }, [terms])

  if (!terms.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-slate-600">
        <BookOpen className="h-5 w-5 text-slate-500" aria-hidden />
        <p className="text-xs">{t("tutors.vocab.empty")}</p>
      </div>
    )
  }

  // Announce newly-arrived terms with context, using original casing so a
  // screen reader says "DNA", not "dna". pulsed holds lowercased keys.
  const announcement = terms
    .filter((v) => pulsed.has(v.term.toLowerCase()))
    .map((v) => t("tutors.vocab.added", { term: v.term }))
    .join(". ")

  // Order: current fact's terms → pinned → the rest (most recent last from the
  // server already). The expanded set is the first `cap` of this order; the
  // remainder collapses under a disclosure (the working-memory offload).
  const rank = (v: VocabTerm) =>
    v.status === "current" ? 0 : pinnedSet.has(v.term.toLowerCase()) ? 1 : 2
  const ordered = [...terms].sort((a, b) => rank(a) - rank(b))
  const expanded = ordered.slice(0, cap)
  const overflow = ordered.slice(cap)

  const title = tier === "young" ? t("tutors.vocab.titleYoung") : t("tutors.vocab.title")
  const statusLabelFor = (s: VocabTerm["status"]) =>
    s === "current" ? t("tutors.vocab.statusCurrent")
      : s === "mastered" ? t("tutors.vocab.statusMastered")
        : t("tutors.vocab.statusTaught")

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50">
        <BookOpen className="h-4 w-4 text-blue-600" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-800">
          {title}
        </h2>
        <span
          className="ms-auto inline-flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold px-2 py-0.5"
          aria-label={t("tutors.vocab.wordCount", { count: terms.length })}
        >
          <span aria-hidden>{terms.length}</span>
        </span>
      </div>

      {definitionsHidden && (
        <p className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
          {t("tutors.vocab.quizTime")}
        </p>
      )}

      {/* Polite live region so screen readers hear new terms (with context) as
          they arrive. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <ScrollArea className="flex-1">
        <ul className="p-3 space-y-2">
          {expanded.map((v) => (
            <VocabRow
              key={v.term}
              v={v}
              tier={tier}
              allowPin={allowPin}
              pinned={pinnedSet.has(v.term.toLowerCase())}
              onTogglePin={onTogglePin}
              tapToReveal={tapToReveal && v.status !== "current"}
              definitionsHidden={definitionsHidden}
              pulse={pulsed.has(v.term.toLowerCase())}
              pinLabel={t("tutors.vocab.pin")}
              unpinLabel={t("tutors.vocab.unpin")}
              showLabel={t("tutors.vocab.showDefinition")}
              statusLabel={statusLabelFor(v.status)}
            />
          ))}
        </ul>

        {overflow.length > 0 && (
          <details className="px-3 pb-3 group">
            <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 py-1.5 list-none">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
              {t("tutors.vocab.moreWords", { count: overflow.length })}
            </summary>
            <ul className="space-y-2 mt-2">
              {overflow.map((v) => (
                <VocabRow
                  key={v.term}
                  v={v}
                  tier={tier}
                  allowPin={allowPin}
                  pinned={pinnedSet.has(v.term.toLowerCase())}
                  onTogglePin={onTogglePin}
                  tapToReveal={tapToReveal && v.status !== "current"}
                  definitionsHidden={definitionsHidden}
                  pulse={false}
                  pinLabel={t("tutors.vocab.pin")}
                  unpinLabel={t("tutors.vocab.unpin")}
                  showLabel={t("tutors.vocab.showDefinition")}
                  statusLabel={statusLabelFor(v.status)}
                />
              ))}
            </ul>
          </details>
        )}
      </ScrollArea>
    </div>
  )
}

interface RowProps {
  v: VocabTerm
  tier: VocabTier
  allowPin: boolean
  pinned: boolean
  onTogglePin: (term: string) => void
  tapToReveal: boolean
  definitionsHidden: boolean
  pulse: boolean
  pinLabel: string
  unpinLabel: string
  showLabel: string
  statusLabel: string
}

function VocabRow({
  v,
  tier,
  allowPin,
  pinned,
  onTogglePin,
  tapToReveal,
  definitionsHidden,
  pulse,
  pinLabel,
  unpinLabel,
  showLabel,
  statusLabel,
}: RowProps) {
  const [revealed, setRevealed] = useState(false)
  const isCurrent = v.status === "current"
  const isMastered = v.status === "mastered"
  const hasDef = !!v.definition && !definitionsHidden

  // Definitions are plain text nodes — never routed through the chat markdown
  // renderer — so curriculum content can't inject markup.
  const showDef = hasDef && (!tapToReveal || revealed)

  return (
    <li
      aria-current={isCurrent ? "true" : undefined}
      className={[
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
        isCurrent ? "bg-blue-50 border-blue-200" : "bg-white border-slate-200",
        pulse ? "ring-1 ring-blue-300" : "",
      ].join(" ")}
    >
      {/* Status is otherwise conveyed only by color — give SR users text. */}
      <span className="sr-only">{statusLabel}: </span>
      {/* Status dot — mirrors the colored indicators used in the left pane. */}
      <span
        className={[
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          isCurrent ? "bg-blue-500" : isMastered ? "bg-emerald-400" : "bg-slate-300",
        ].join(" ")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-slate-800 leading-snug">
            {v.term}
          </span>
          {isMastered && (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
          )}
          {allowPin && (
            <button
              type="button"
              onClick={() => onTogglePin(v.term)}
              aria-label={pinned ? unpinLabel : pinLabel}
              aria-pressed={pinned}
              className="ms-auto -mr-1 rounded p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {showDef && (
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{v.definition}</p>
        )}
        {hasDef && tapToReveal && !revealed && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-1 text-[11px] text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            {showLabel}
          </button>
        )}
      </div>
    </li>
  )
}
