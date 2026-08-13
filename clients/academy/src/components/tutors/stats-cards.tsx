"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shared/ui/dialog"
import { Badge } from "@/components/shared/ui/badge"
import { Progress } from "@/components/shared/ui/progress"
import Image from "next/image"

interface CompletedLesson {
  id: string
  title: string
  subject: string
  completedAt: string
}

interface StreakDay {
  date: string
  minutesLearned: number
}

interface CreditInfo {
  totalMinutes: number
  creditsEarned: number
  creditsNeeded: number
  yearlyProgress: { year: number; credits: number }[]
}

// Map language codes to locale strings for toLocaleDateString
const localeMap: Record<string, string> = {
  en: "en-US", es: "es-ES", zh: "zh-CN", hi: "hi-IN", ar: "ar-SA",
  fr: "fr-FR", pt: "pt-BR", bn: "bn-BD", ru: "ru-RU", de: "de-DE", ur: "ur-PK"
}

export function StatsCards() {
  const t = useTranslations()
  const [preferredLanguage, setPreferredLanguage] = useState("en")
  const [stats, setStats] = useState({
    lessonsCompleted: 0,
    currentStreak: 0,
    totalTime: 0,
  })

  const [openDialog, setOpenDialog] = useState<"lessons" | "streak" | "credits" | null>(null)

  // Load preferred language from localStorage
  useEffect(() => {
    const savedLang = localStorage.getItem("preferredLanguage")
    if (savedLang) setPreferredLanguage(savedLang)
  }, [])

  // Use translation keys for lesson titles and subjects
  const completedLessons: CompletedLesson[] = [
    { id: "1", title: t("stats.lessons.introAlgebra"), subject: t("stats.subjects.math"), completedAt: "2025-01-10" },
    { id: "2", title: t("stats.lessons.readingBasics"), subject: t("stats.subjects.reading"), completedAt: "2025-01-11" },
    { id: "3", title: t("stats.lessons.waterCycle"), subject: t("stats.subjects.science"), completedAt: "2025-01-12" },
    { id: "4", title: t("stats.lessons.fractions"), subject: t("stats.subjects.math"), completedAt: "2025-01-13" },
    { id: "5", title: t("stats.lessons.grammar"), subject: t("stats.subjects.english"), completedAt: "2025-01-14" },
  ]

  const [streakDays] = useState<StreakDay[]>([
    { date: "2025-01-10", minutesLearned: 45 },
    { date: "2025-01-11", minutesLearned: 60 },
    { date: "2025-01-12", minutesLearned: 30 },
    { date: "2025-01-13", minutesLearned: 55 },
    { date: "2025-01-14", minutesLearned: 40 },
  ])

  const calculateCredits = (): CreditInfo => {
    const totalMinutes = stats.totalTime
    const creditsEarned = Math.floor(totalMinutes / 60)
    const creditsNeeded = 120 // Credits needed per year

    // Mock yearly progress
    const yearlyProgress = [
      { year: 2025, credits: creditsEarned },
      { year: 2024, credits: 95 },
      { year: 2023, credits: 110 },
    ]

    return { totalMinutes, creditsEarned, creditsNeeded, yearlyProgress }
  }

  useEffect(() => {
    // Load stats from localStorage
    const savedStats = localStorage.getItem("stats")
    if (savedStats) {
      setStats(JSON.parse(savedStats))
    }
  }, [])

  const creditInfo = calculateCredits()

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          className="border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all cursor-pointer"
          onClick={() => setOpenDialog("lessons")}
        >
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center">
                <Image src="/icons/glassmorphism/medal.svg" alt="Lessons" width={24} height={24} className="object-contain" />
              </div>
              <div>
                <p className="text-2xl font-medium">{stats.lessonsCompleted}</p>
                <p className="text-sm text-muted-foreground">{t("stats.lessonsCompleted")}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className="border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all cursor-pointer"
          onClick={() => setOpenDialog("streak")}
        >
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center">
                <Image src="/icons/glassmorphism/fire.svg" alt="Streak" width={24} height={24} className="object-contain" />
              </div>
              <div>
                <p className="text-2xl font-medium">{stats.currentStreak}</p>
                <p className="text-sm text-muted-foreground">{t("stats.dayStreak")}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className="border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all cursor-pointer"
          onClick={() => setOpenDialog("credits")}
        >
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center">
                <Image src="/icons/glassmorphism/hourglass.svg" alt="Time" width={24} height={24} className="object-contain" />
              </div>
              <div>
                <p className="text-2xl font-medium">{stats.totalTime}</p>
                <p className="text-sm text-muted-foreground">{t("stats.minutesLearning")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={openDialog === "lessons"} onOpenChange={() => setOpenDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("stats.lessonsCompleted")}</DialogTitle>
            <DialogDescription>
              {t("stats.lessonsDescription", { count: completedLessons.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            {completedLessons.map((lesson) => (
              <div
                key={lesson.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1">
                  <h4 className="font-semibold">{lesson.title}</h4>
                  <p className="text-sm text-muted-foreground">{lesson.subject}</p>
                </div>
                <div className="text-right">
                  <Badge variant="secondary">{new Date(lesson.completedAt).toLocaleDateString(localeMap[preferredLanguage] || "en-US")}</Badge>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openDialog === "streak"} onOpenChange={() => setOpenDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("stats.streakTitle", { count: stats.currentStreak })}</DialogTitle>
            <DialogDescription>{t("stats.streakDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            {streakDays.map((day, index) => (
              <div
                key={day.date}
                className="flex items-center gap-4 p-4 border rounded-lg bg-gradient-to-r from-chart-1/10 to-transparent"
              >
                <div className="w-10 h-10 rounded-full bg-chart-1 flex items-center justify-center text-white font-medium">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="font-semibold">
                    {new Date(day.date).toLocaleDateString(localeMap[preferredLanguage] || "en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground">{t("stats.minutesLearned", { minutes: day.minutesLearned })}</p>
                </div>
                <svg className="w-6 h-6 text-chart-1" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openDialog === "credits"} onOpenChange={() => setOpenDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("stats.creditsTitle")}</DialogTitle>
            <DialogDescription>
              {t("stats.creditsDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 mt-4">
            {/* Current Year Progress */}
            <div className="p-6 border rounded-lg bg-gradient-to-br from-primary/5 to-chart-4/5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-2xl font-medium">{t("stats.creditsEarned", { count: creditInfo.creditsEarned })}</h3>
                  <p className="text-sm text-muted-foreground">{t("stats.earnedThisYear")}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{t("stats.totalMinutes", { count: creditInfo.totalMinutes })}</p>
                  <p className="text-sm text-muted-foreground">{t("stats.totalLearningTime")}</p>
                </div>
              </div>
              <Progress value={(creditInfo.creditsEarned / creditInfo.creditsNeeded) * 100} className="h-3" />
              <p className="text-sm text-muted-foreground mt-2">
                {t("stats.creditsNeeded", { count: creditInfo.creditsNeeded - creditInfo.creditsEarned })}
              </p>
            </div>

            {/* Credit Conversion Info */}
            <div className="p-4 border rounded-lg bg-accent/30">
              <h4 className="font-semibold mb-2">{t("stats.howCreditsWork")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                  {t("stats.creditRule1")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                  {t("stats.creditRule2")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                  {t("stats.creditRule3")}
                </li>
              </ul>
            </div>

            {/* Yearly History */}
            <div>
              <h4 className="font-semibold mb-3">{t("stats.yearlyProgress")}</h4>
              <div className="space-y-3">
                {creditInfo.yearlyProgress.map((yearData) => (
                  <div key={yearData.year} className="flex items-center justify-between p-3 border rounded-lg">
                    <span className="font-medium">{yearData.year}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {t("stats.creditsProgress", { earned: yearData.credits, total: creditInfo.creditsNeeded })}
                      </span>
                      <Badge variant={yearData.credits >= creditInfo.creditsNeeded ? "default" : "secondary"}>
                        {yearData.credits >= creditInfo.creditsNeeded ? t("stats.complete") : t("stats.inProgress")}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
