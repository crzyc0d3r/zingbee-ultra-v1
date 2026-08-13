"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import {
  BookOpen,
  Check,
  Clock,
  Star,
  Target,
  Trophy,
  XCircle,
} from "lucide-react"

interface SessionSummary {
  status?: string
  duration_seconds?: number
  questions_asked?: number
  correct_answers?: number
  facts_taught_count?: number
  accuracy?: number
  capsule_name?: string
  subject?: string
  theme?: string
  tutor?: string
  factsState?: { taught: number; assessed: number; mastered: number }
  totalFacts?: number
  currentStep?: string
  questionsAsked?: number
  correctAnswers?: number
  sessionStartTime?: string
  // From end-session response
  facts_taught?: string[]
  facts_assessed?: string[]
  facts_mastered?: string[]
  total_facts?: number
}

export default function SessionSummaryPage() {
  const router = useRouter()
  const [summary, setSummary] = useState<SessionSummary | null>(null)

  useEffect(() => {
    const data = localStorage.getItem("sessionSummary")
    if (data) {
      try {
        setSummary(JSON.parse(data))
      } catch {
        router.push("/tutors/themes")
      }
    } else {
      router.push("/tutors/themes")
    }
  }, [router])

  if (!summary) return null

  const duration = summary.duration_seconds || 0
  const startTime = summary.sessionStartTime ? new Date(summary.sessionStartTime) : null
  const sessionMinutes = startTime
    ? Math.round((Date.now() - startTime.getTime()) / 60000)
    : Math.round(duration / 60)

  const facts = summary.factsState || { taught: 0, assessed: 0, mastered: 0 }
  const total = summary.totalFacts || summary.total_facts || 0
  const questions = summary.questionsAsked ?? summary.questions_asked ?? 0
  const correct = summary.correctAnswers ?? summary.correct_answers ?? 0
  const accuracy = questions > 0 ? Math.round((correct / questions) * 100) : 0
  const progressPct = total > 0 ? Math.round(((facts.mastered + facts.assessed) / total) * 100) : 0

  const factsTaughtList = summary.facts_taught || []
  const factsMasteredList = summary.facts_mastered || []
  const factsAssessedList = summary.facts_assessed || []
  const pending = Math.max(0, total - facts.taught - facts.assessed - facts.mastered)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <DashboardHeader />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Trophy className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-medium text-slate-900 mb-1">Session Complete</h1>
          <p className="text-slate-500">
            {summary.subject} &middot; {summary.theme}
          </p>
          {summary.capsule_name && (
            <p className="text-sm text-slate-400 mt-1">{summary.capsule_name}</p>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Card className="border border-slate-200">
            <CardContent className="p-4 text-center">
              <Clock className="w-5 h-5 text-blue-500 mx-auto mb-1" />
              <p className="text-xl font-medium text-slate-800">{sessionMinutes}</p>
              <p className="text-[10px] text-slate-500">Minutes</p>
            </CardContent>
          </Card>
          <Card className="border border-slate-200">
            <CardContent className="p-4 text-center">
              <Target className="w-5 h-5 text-purple-500 mx-auto mb-1" />
              <p className="text-xl font-medium text-slate-800">{questions}</p>
              <p className="text-[10px] text-slate-500">Questions</p>
            </CardContent>
          </Card>
          <Card className="border border-slate-200">
            <CardContent className="p-4 text-center">
              <Check className="w-5 h-5 text-green-500 mx-auto mb-1" />
              <p className="text-xl font-medium text-slate-800">{accuracy}%</p>
              <p className="text-[10px] text-slate-500">Accuracy</p>
            </CardContent>
          </Card>
          <Card className="border border-slate-200">
            <CardContent className="p-4 text-center">
              <Star className="w-5 h-5 text-yellow-500 mx-auto mb-1" />
              <p className="text-xl font-medium text-slate-800">{facts.mastered}</p>
              <p className="text-[10px] text-slate-500">Mastered</p>
            </CardContent>
          </Card>
        </div>

        {/* Progress */}
        <Card className="border border-slate-200 mb-6">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">Facts Progress</h2>
              <span className="text-sm font-medium text-slate-600">{progressPct}%</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-gradient-to-r from-blue-400 via-green-400 to-yellow-400 rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <p className="text-lg font-medium text-blue-600">{facts.taught}</p>
                <p className="text-[10px] text-slate-500">Taught</p>
              </div>
              <div>
                <p className="text-lg font-medium text-green-600">{facts.assessed}</p>
                <p className="text-[10px] text-slate-500">Assessed</p>
              </div>
              <div>
                <p className="text-lg font-medium text-yellow-600">{facts.mastered}</p>
                <p className="text-[10px] text-slate-500">Mastered</p>
              </div>
              <div>
                <p className="text-lg font-medium text-slate-400">{pending}</p>
                <p className="text-[10px] text-slate-500">Remaining</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Facts Breakdown */}
        {(factsMasteredList.length > 0 || factsAssessedList.length > 0 || factsTaughtList.length > 0) && (
          <Card className="border border-slate-200 mb-6">
            <CardContent className="p-5 space-y-4">
              {factsMasteredList.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-yellow-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-yellow-500" />
                    Mastered ({factsMasteredList.length})
                  </h3>
                  <ul className="space-y-1">
                    {factsMasteredList.map((fact, i) => (
                      <li key={i} className="text-xs text-slate-700 flex items-start gap-2 py-1">
                        <Check className="w-3.5 h-3.5 text-yellow-500 mt-0.5 shrink-0" />
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {factsAssessedList.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-green-500" />
                    Assessed ({factsAssessedList.length})
                  </h3>
                  <ul className="space-y-1">
                    {factsAssessedList.map((fact, i) => (
                      <li key={i} className="text-xs text-slate-700 flex items-start gap-2 py-1">
                        <Check className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {factsTaughtList.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                    Taught ({factsTaughtList.length})
                  </h3>
                  <ul className="space-y-1">
                    {factsTaughtList.map((fact, i) => (
                      <li key={i} className="text-xs text-slate-700 flex items-start gap-2 py-1">
                        <BookOpen className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pending > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5 text-slate-400" />
                    Not covered ({pending})
                  </h3>
                  <p className="text-xs text-slate-400">These facts will be covered in your next session.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* OK Button */}
        <Button
          onClick={() => {
            localStorage.removeItem("sessionSummary")
            // Go back to start-session for the same theme to pick the next capsule
            router.push("/tutors/start-session")
          }}
          className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl"
        >
          Continue Learning
        </Button>
      </div>
    </div>
  )
}
