"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { DashboardHeader } from "@/components/tutors/dashboard-header"
import Image from "next/image"
import { apiClient, type Phase } from "@/lib/api-client"
import { useAuth } from "@/hooks/use-auth"
import { useTranslations } from "next-intl"

const defaultPhaseIcons: Record<number, string> = {
  1: "/icons/glassmorphism/open-book.svg",
  2: "/icons/glassmorphism/brain.svg",
  3: "/icons/glassmorphism/graduation-cap.svg",
  4: "/icons/glassmorphism/certificate.svg",
}

export default function PhasesPage() {
  const { isLoading: isAuthLoading } = useAuth()
  const t = useTranslations()
  const router = useRouter()
  const [subjectData, setSubjectData] = useState<any>(null)
  const [phases, setPhases] = useState<Phase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const checkPlacementAndLoad = async () => {
      const selectedSubject = localStorage.getItem("selectedSubject")
      if (!selectedSubject) {
        router.push("/tutors/dashboard")
        return
      }

      try {
        const subject = JSON.parse(selectedSubject)
        setSubjectData(subject)

        // Check if user already has placement - redirect to themes
        const student = JSON.parse(localStorage.getItem("student") || "{}")
        if (student.id) {
          const placementCheck = await apiClient.studentPreferences.checkPlacement(student.id, subject.id)
          if (placementCheck.has_placement) {
            // User has placement, skip phases and go to themes
            localStorage.setItem("assignedPhase", JSON.stringify({
              phase_id: placementCheck.placement?.phase_id,
              phase_number: placementCheck.placement?.phase_number,
            }))
            router.push("/tutors/themes")
            return
          }
        }

        fetchPhases()
      } catch {
        router.push("/tutors/dashboard")
      }
    }

    checkPlacementAndLoad()
  }, [router])

  const fetchPhases = async () => {
    try {
      setLoading(true)
      const data = await apiClient.phases.list()
      setPhases(data.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)))
      setError("")
    } catch (err: any) {
      console.error("Error fetching phases:", err)
      setError("Failed to load phases. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handlePhaseSelect = (phase: Phase) => {
    const phaseData = {
      id: phase.id,
      name: phase.name,
      ageRange: phase.age_range,
      description: phase.description
    }
    localStorage.setItem("selectedPhase", JSON.stringify(phaseData))
    router.push("/tutors/themes")
  }

  if (isAuthLoading || !subjectData || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 text-center">
          <p className="text-lg text-slate-600">{t('tutors.phases.loadingPhases')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 text-center">
          <p className="text-lg text-red-600">{t('tutors.phases.failedLoad')}</p>
          <Button onClick={fetchPhases} className="mt-4">{t('tutors.phases.tryAgain')}</Button>
        </div>
      </div>
    )
  }

  const isIslamic = subjectData.specialty === "Islamic Studies"

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <DashboardHeader />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-medium text-slate-900 mb-2">
            {isIslamic
              ? t('tutors.phases.selectTitleIslamic', { subject: subjectData.name })
              : t('tutors.phases.selectTitle', { subject: subjectData.name })}
          </h1>
          <p className="text-lg text-slate-600">
            {isIslamic
              ? t('tutors.phases.selectSubtitleIslamic')
              : t('tutors.phases.selectSubtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {phases.map((phase) => {
            // Use database icon, fallback to default based on display_order
            const iconSrc = phase.icon || defaultPhaseIcons[phase.display_order ?? 1] || "/icons/glassmorphism/open-book.svg"
            return (
              <Card
                key={phase.id}
                className="cursor-pointer border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all bg-white overflow-hidden"
                onClick={() => handlePhaseSelect(phase)}
              >
                <div className="p-6 flex flex-col items-center text-center space-y-4">
                  <div className="w-24 h-24 rounded-2xl flex items-center justify-center">
                    <Image src={iconSrc} alt={phase.name} width={64} height={64} className="object-contain" />
                  </div>

                  <div>
                    <h3 className="text-2xl font-medium text-slate-900 mb-1">{phase.name}</h3>
                    <p className="text-sm font-medium text-slate-600">{phase.age_range}</p>
                  </div>

                  <p className="text-sm text-slate-600 leading-relaxed">{phase.description || ""}</p>
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
