"use client"

import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { TutorGrid } from "@/components/tutors/tutor-grid"
import { useAuth } from "@/hooks/use-auth"
import { useTranslations } from "next-intl"

export default function TutorsPage() {
  const { isLoading } = useAuth()
  const t = useTranslations()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <DashboardHeader />
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-medium mb-4 text-balance">{t('tutors.subjects.title')}</h1>
          <p className="text-gray-600 text-lg text-balance max-w-2xl mx-auto">
            {t('tutors.subjects.subtitle')}
          </p>
        </div>

        <TutorGrid />
      </div>
    </div>
  )
}
