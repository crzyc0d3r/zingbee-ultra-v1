import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { ProblemsFilters } from "@/components/problems-filters"
import { ProblemsTable } from "@/components/problems-table"
import { ProblemsStats } from "@/components/problems-stats"

export default function ProblemsPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Problem Management</h1>
            <p className="text-muted-foreground">Track and resolve system issues and user-reported problems</p>
          </div>

          <ProblemsStats />
          <ProblemsFilters />
          <ProblemsTable />
        </main>
      </div>
    </div>
  )
}
