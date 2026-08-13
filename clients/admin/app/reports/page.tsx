import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { ReportsFilters } from "@/components/reports-filters"
import { ReportsCharts } from "@/components/reports-charts"
import { ReportsMetrics } from "@/components/reports-metrics"
import { KnowledgeGraph } from "@/components/knowledge-graph"

export default function ReportsPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Analytics & Reports</h1>
            <p className="text-muted-foreground">Comprehensive insights and performance metrics</p>
          </div>

          <ReportsFilters />
          <ReportsMetrics />
          <KnowledgeGraph />
          <div className="mt-6">
            <ReportsCharts />
          </div>
        </main>
      </div>
    </div>
  )
}
