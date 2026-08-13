"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { DashboardHeader } from "@/components/tutors/dashboard-header"
import Image from "next/image"
import { apiClient, type Theme, type Subject } from "@/lib/api-client"
import { useAuth } from "@/hooks/use-auth"
import { useTranslations } from "next-intl"

const subjectIcons: Record<string, string> = {
  Math: "/icons/glassmorphism/drafting-compass.svg",
  English: "/icons/glassmorphism/quill-with-ink.svg",
  Biology: "/icons/glassmorphism/biotech.svg",
  Chemistry: "/icons/glassmorphism/microscope.svg",
  Physics: "/icons/glassmorphism/telescope.svg",
}

export default function ThemesPage() {
  const { isLoading: isAuthLoading } = useAuth()
  const t = useTranslations()
  const router = useRouter()
  const [subjectData, setSubjectData] = useState<any>(null)
  const [themes, setThemes] = useState<Theme[]>([])
  const [phaseData, setPhaseData] = useState<any>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [themeProgress, setThemeProgress] = useState<Record<string, { completed: number; total: number }>>({})

  useEffect(() => {
    const selectedSubject = localStorage.getItem("selectedSubject")
    const selectedPhase = localStorage.getItem("selectedPhase")
    const assignedPhase = localStorage.getItem("assignedPhase")

    if (selectedSubject) {
      try {
        const subject = JSON.parse(selectedSubject)
        setSubjectData(subject)

        // Fetch placement from API -- database is the source of truth
        const studentStr = localStorage.getItem("student")
        if (studentStr && subject.id) {
          const studentId = JSON.parse(studentStr).id
          fetch(`/api/student-assessments/student/${studentId}/placement/${subject.id}`, { credentials: "include" })
            .then((r) => r.json())
            .then((data) => {
              const phaseNum = data.placement?.assigned_phase
              if (phaseNum) {
                setPhaseData({ id: String(phaseNum), name: `Phase ${phaseNum}`, ageRange: "" })
                fetchThemes(subject, { id: String(phaseNum) })
              } else {
                setPhaseData({ id: "1", name: "Phase 1", ageRange: "" })
                fetchThemes(subject, { id: "1" })
              }
            })
            .catch(() => {
              setPhaseData({ id: "1", name: "Phase 1", ageRange: "" })
              fetchThemes(subject, { id: "1" })
            })
        } else {
          setPhaseData({ id: "1", name: "Phase 1", ageRange: "" })
          fetchThemes(subject, { id: "1" })
        }
      } catch {
        router.push("/tutors/dashboard")
      }
    } else {
      router.push("/tutors/dashboard")
    }
  }, [router])

  const fetchThemes = async (subject: any, phase: any) => {
    try {
      setLoading(true)
      setSubject({ name: subject.specialty, color_code: subject.color_code, character_emoji: subject.character_emoji } as any)
      const themeData = await apiClient.themes.list(
        subject.id,
        phase?.id
      )
      setThemes(themeData)
      setError("")

      // Load per-theme capsule progress
      const studentStr = localStorage.getItem("student")
      if (studentStr) {
        const sid = JSON.parse(studentStr).id
        if (sid) {
          const results: Record<string, { completed: number; total: number }> = {}
          await Promise.all(themeData.map(async (theme: Theme) => {
            try {
              const capsules = await apiClient.capsules.getWithProgress(sid, theme.id)
              const total = capsules.length
              const completed = capsules.filter((c: any) => c.has_completed || c.status === "completed" || c.status === "mastered").length
              results[theme.id] = { completed, total }
            } catch {
              results[theme.id] = { completed: 0, total: 0 }
            }
          }))
          setThemeProgress(results)
        }
      }
    } catch (err: any) {
      console.error("Error fetching topics:", err)
      setError("Failed to load topics. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleThemeSelect = async (theme: Theme) => {
    localStorage.setItem("selectedTheme", JSON.stringify(theme))
    // Write theme selection to report card so the backend knows the correct phase/theme.
    // If this fails the student would previously be silently routed to whatever stale
    // current_position was last written — log it loudly so we notice next time.
    const student = localStorage.getItem("student")
    if (student) {
      try {
        const studentId = JSON.parse(student).id
        const resp = await fetch("/api/academy/select-theme", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: studentId, theme_id: theme.id }),
        })
        if (!resp.ok) {
          console.error("[select-theme] non-OK response", resp.status, await resp.text().catch(() => ""))
        }
      } catch (err) {
        console.error("[select-theme] network error", err)
      }
    }
    router.push("/tutors/start-session")
  }

  if (isAuthLoading || !subjectData || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 text-center">
          <p className="text-lg text-slate-600">{t('tutors.themes.loadingTopics')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 text-center">
          <p className="text-lg text-red-600">{t('tutors.themes.failedLoad')}</p>
          <Button onClick={() => fetchThemes(subjectData, phaseData)} className="mt-4">{t('tutors.themes.tryAgain')}</Button>
        </div>
      </div>
    )
  }

  // Unique icon pools per subject — each theme gets a distinct icon by index
  const G = '/icons/glassmorphism'
  const subjectIconPools: Record<string, string[]> = {
    Biology: [
      `${G}/leaf.svg`,          // green leaf
      `${G}/running.svg`,       // green sneaker
      `${G}/heart-health.svg`,  // pink heart
      `${G}/ecosystem.svg`,     // green trees
      `${G}/brain.svg`,         // pink brain
      `${G}/nature.svg`,        // yellow sun/flower
      `${G}/microscope.svg`,    // green microscope
      `${G}/globe-theme.svg`,   // teal globe
      `${G}/law.svg`,           // purple scales
      `${G}/medal.svg`,         // gold medal
      `${G}/hourglass.svg`,     // blue hourglass
      `${G}/trophy.svg`,        // gold trophy
    ],
    Chemistry: [
      `${G}/bunsen.svg`,        // blue droplet burner
      `${G}/fire.svg`,          // orange flame
      `${G}/design.svg`,        // teal cross
      `${G}/measuring.svg`,     // pink circles
      `${G}/test-tube.svg`,     // pink test tube
      `${G}/circuit.svg`,       // green chip
      `${G}/statistics.svg`,    // green bars
      `${G}/engineering.svg`,   // blue hexagons
      `${G}/notepad.svg`,       // purple grid
      `${G}/globe.svg`,         // blue globe
      `${G}/star.svg`,          // yellow star
      `${G}/trophy.svg`,        // gold trophy
      `${G}/briefcase.svg`,     // orange briefcase
      `${G}/clock.svg`,         // blue clock
      `${G}/rocket.svg`,        // grey/pink rocket
    ],
    Physics: [
      `${G}/running.svg`,       // green sneaker
      `${G}/target.svg`,        // purple crosshair
      `${G}/planet.svg`,        // ringed planet
      `${G}/sound-wave.svg`,    // blue waves
      `${G}/engineering.svg`,   // blue hexagons
      `${G}/comet.svg`,         // pink comet
      `${G}/rocket.svg`,        // grey/pink rocket
      `${G}/future.svg`,        // pink eye
      `${G}/telescope.svg`,     // green telescope
      `${G}/fire.svg`,          // orange flame
      `${G}/clock.svg`,         // blue clock
      `${G}/briefcase.svg`,     // orange briefcase
      `${G}/trophy.svg`,        // gold trophy
      `${G}/medal.svg`,         // gold medal
    ],
    Math: [
      `${G}/drafting-compass.svg`, `${G}/brainstorm.svg`, `${G}/statistics.svg`, `${G}/robot.svg`,
      `${G}/certificate.svg`, `${G}/scroll.svg`, `${G}/circuit.svg`, `${G}/engineering.svg`,
      `${G}/notepad.svg`, `${G}/hourglass.svg`, `${G}/star.svg`,
    ],
    English: [
      `${G}/pen.svg`, `${G}/literature.svg`, `${G}/speech.svg`, `${G}/lighthouse.svg`,
      `${G}/star.svg`, `${G}/palette.svg`, `${G}/brain.svg`, `${G}/globe-theme.svg`,
      `${G}/quill-with-ink.svg`, `${G}/scroll.svg`, `${G}/medal.svg`,
    ],
  }

  const getThemeIcon = (_themeName: string, index: number): string => {
    const subjectName = subjectData?.specialty || subjectData?.name || ""
    const pool = subjectIconPools[subjectName] || Object.values(subjectIconPools).flat()
    return pool[index % pool.length]
  }

  const subjectIconSrc = subjectIcons[subjectData.specialty] || "/icons/glassmorphism/open-book.svg"
  const isMath = ["Math", "Mathematics"].includes(subjectData.specialty)
  const isEnglish = ["English", "English Language & Literature"].includes(subjectData.specialty)
  const isBiology = subjectData.specialty === "Biology"
  const isChemistry = subjectData.specialty === "Chemistry"
  const isPhysics = subjectData.specialty === "Physics"

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <DashboardHeader />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8 text-center">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Image src={subjectIconSrc} alt={subjectData.specialty} width={64} height={64} className="object-contain" />
          </div>
          <h1 className="text-4xl font-medium text-slate-900 mb-2">
            {isMath
              ? t('tutors.themes.titleMath')
              : isBiology
                ? t('tutors.themes.titleBiology')
                : t('tutors.themes.titleDefault', { subject: subjectData.name })}
          </h1>
          {phaseData && (
            <p className="text-md text-slate-500 mb-2">
              {phaseData.name}{phaseData.ageRange ? ` (${phaseData.ageRange})` : ""}
            </p>
          )}
          <p className="text-lg text-slate-600">
            {isEnglish
              ? t('tutors.themes.subtitleEnglish')
              : isMath
                ? t('tutors.themes.subtitleMath')
                : isBiology
                  ? t('tutors.themes.subtitleBiology')
                  : t('tutors.themes.subtitleDefault')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {themes.map((theme, idx) => {
            const themeIconSrc = getThemeIcon(theme.title || '', idx)
            return (
              <Card
                key={theme.id}
                className="cursor-pointer transition-all hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] bg-white border border-slate-200 overflow-hidden h-full"
                onClick={() => handleThemeSelect(theme)}
              >
                <div className="p-6 flex flex-col items-center text-center h-full justify-between">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4">
                    <Image src={themeIconSrc} alt={theme.title} width={48} height={48} className="object-contain" />
                  </div>

                <div className="flex-1 flex flex-col justify-center">
                  <h3 className="text-xl font-medium text-slate-900 mb-2">{theme.title}</h3>
                  {theme.driving_question && (
                    <p className="text-xs font-semibold text-purple-600 mb-2 italic">"{theme.driving_question}"</p>
                  )}
                  <p className="text-sm text-slate-600 leading-relaxed mb-3">{theme.description}</p>
                  {theme.application_focus && (
                    <p className="text-xs text-slate-500 mb-2">
                      <span className="font-semibold">{t('tutors.themes.applications')}</span>{" "}
                      {theme.application_focus}
                    </p>
                  )}
                  {theme.conceptual_goal && (
                    <div className="text-xs text-slate-500">
                      <span className="font-semibold">{t('tutors.themes.goal')}</span>{" "}
                      {theme.conceptual_goal}
                    </div>
                  )}
                </div>
                {themeProgress[theme.id] && themeProgress[theme.id].total > 0 && (
                  <div className="w-full mt-3">
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/60 rounded-full transition-all"
                        style={{ width: `${Math.round((themeProgress[theme.id].completed / themeProgress[theme.id].total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {themeProgress[theme.id].completed}/{themeProgress[theme.id].total} capsules
                    </p>
                  </div>
                )}
              </div>
            </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
