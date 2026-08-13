import { DashboardHeader } from "@/components/quests/dashboard-header"
import { AchievementGrid } from "@/components/quests/achievement-grid"
import { LevelProgress } from "@/components/shared/common/level-progress"
import { RewardsCelebration } from "@/components/quests/rewards-celebration"

export default function AchievementsPage() {
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
