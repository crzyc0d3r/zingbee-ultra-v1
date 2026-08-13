"use client"

import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { StudentList } from "@/components/tutors/student-list"
import { useAuth } from "@/hooks/use-auth"

export default function CommunityPage() {
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
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-medium mb-2">Learn with Others</h1>
            <p className="text-muted-foreground">
              Connect with other students learning similar topics and study together
            </p>
          </div>
          <StudentList />
        </div>
      </main>
    </div>
  )
}
