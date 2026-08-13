import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { SessionsTable } from "@/components/sessions-table"
import { SessionsFilters } from "@/components/sessions-filters"
import { SessionsStats } from "@/components/sessions-stats"

export default function SessionsPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Active Sessions</h1>
            <p className="text-muted-foreground">Monitor real-time user sessions and system activity</p>
          </div>

          <SessionsStats />
          <SessionsFilters />
          <SessionsTable />
        </main>
      </div>
    </div>
  )
}
