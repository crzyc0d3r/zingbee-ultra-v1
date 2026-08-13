import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { SchoolsTable } from "@/components/schools-table"
import { SchoolsFilters } from "@/components/schools-filters"
import { CreateSchoolButton } from "@/components/create-school-button"
import { Card } from "@/components/ui/card"
import { Building2, Users, GraduationCap, TrendingUp } from "lucide-react"

export default function SchoolsPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Schools Management</h1>
              <p className="text-muted-foreground">Manage schools and their configurations</p>
            </div>
            <CreateSchoolButton />
          </div>

          <div className="mb-6 grid gap-4 md:grid-cols-4">
            <Card className="border-card bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Schools</p>
                  <p className="text-2xl font-bold text-foreground">24</p>
                </div>
              </div>
            </Card>
            <Card className="border-card bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <GraduationCap className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Students</p>
                  <p className="text-2xl font-bold text-foreground">3,847</p>
                </div>
              </div>
            </Card>
            <Card className="border-card bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-500/10 p-2">
                  <Users className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Schools</p>
                  <p className="text-2xl font-bold text-foreground">22</p>
                </div>
              </div>
            </Card>
            <Card className="border-card bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-500/10 p-2">
                  <TrendingUp className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Growth</p>
                  <p className="text-2xl font-bold text-foreground">+12%</p>
                </div>
              </div>
            </Card>
          </div>

          <SchoolsFilters />
          <SchoolsTable />
        </main>
      </div>
    </div>
  )
}
