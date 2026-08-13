"use client"

import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { AchievementGrid } from "@/components/tutors/achievement-grid"
import { LevelProgress } from "@/components/shared/common/level-progress"
import { RewardsCelebration } from "@/components/tutors/rewards-celebration"
import { useAuth } from "@/hooks/use-auth"

export default function AchievementsPage() {
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
            <h1 className="text-3xl font-medium mb-2">Your Achievements</h1>
            <p className="text-muted-foreground">Track your progress and collect badges as you learn</p>
          </div>
          <RewardsCelebration />
          <LevelProgress />
          <AchievementGrid />
        </div>
      </main>
    </div>
  )
}
