import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { ModelTestingInterface } from "@/components/model-testing-interface"
import { ModelBenchmarks } from "@/components/model-benchmarks"
import { ABTestConfig } from "@/components/ab-test-config"

export default function ModelTestingPage() {
  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground">Model Testing & Evaluation</h1>
            <p className="text-muted-foreground">Test and compare AI models to find the best fit for your students</p>
          </div>

          <ModelTestingInterface />
          <ModelBenchmarks />
          <ABTestConfig />
        </main>
      </div>
    </div>
  )
}
