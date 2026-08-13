import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { ModelsTable } from "@/components/models-table"
import { CreateModelButton } from "@/components/create-model-button"
import { Card } from "@/components/ui/card"
import { Cpu, Zap, DollarSign, TrendingUp } from "lucide-react"

export default function ModelsPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">AI Model Management</h1>
              <p className="text-muted-foreground">Configure and manage AI models for Academy</p>
            </div>
            <CreateModelButton />
          </div>

          <div className="mb-6 grid gap-4 md:grid-cols-4">
            <Card className="border-card-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Models</p>
                  <p className="text-2xl font-bold text-card-foreground">4</p>
                </div>
              </div>
            </Card>

            <Card className="border-card-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-500/10 p-2">
                  <Zap className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Response Time</p>
                  <p className="text-2xl font-bold text-card-foreground">1.2s</p>
                </div>
              </div>
            </Card>

            <Card className="border-card-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <DollarSign className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Monthly Cost</p>
                  <p className="text-2xl font-bold text-card-foreground">$847</p>
                </div>
              </div>
            </Card>

            <Card className="border-card-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-500/10 p-2">
                  <TrendingUp className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Success Rate</p>
                  <p className="text-2xl font-bold text-card-foreground">98.5%</p>
                </div>
              </div>
            </Card>
          </div>

          <ModelsTable />
        </main>
      </div>
    </div>
  )
}
