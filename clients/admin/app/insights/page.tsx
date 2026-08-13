import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { InsightsFilters } from "@/components/insights-filters"
import { ConversationEffectiveness } from "@/components/conversation-effectiveness"
import { StudentProgressOverview } from "@/components/student-progress-overview"
import { TopPerformingContent } from "@/components/top-performing-content"

export default function InsightsPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Learning Insights</h1>
            <p className="text-muted-foreground">Analyze conversation effectiveness and student progress patterns</p>
          </div>

          <InsightsFilters />
          <ConversationEffectiveness />
          <StudentProgressOverview />
          <TopPerformingContent />
        </main>
      </div>
    </div>
  )
}
