"use client"

import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { StatsCards } from "@/components/tutors/stats-cards"
import { RecentActivity } from "@/components/tutors/recent-activity"
import { TutorGrid } from "@/components/tutors/tutor-grid"
import { useAuth } from "@/hooks/use-auth"

export default function DashboardPage() {
  const { isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <DashboardHeader />
      <main className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="space-y-8">
          <div>
            <TutorGrid />
          </div>
        </div>
      </main>
    </div>
  )
}
