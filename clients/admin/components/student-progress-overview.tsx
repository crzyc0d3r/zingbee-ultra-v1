"use client"

import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, Users, Award, AlertTriangle } from "lucide-react"

const progressSegments = [
  {
    category: "Excelling",
    count: 342,
    percentage: 28,
    color: "bg-green-500",
    description: "Above 85% completion with high engagement",
  },
  {
    category: "On Track",
    count: 687,
    percentage: 56,
    color: "bg-blue-500",
    description: "60-85% completion, steady progress",
  },
  {
    category: "Needs Support",
    count: 143,
    percentage: 12,
    color: "bg-yellow-500",
    description: "40-60% completion, irregular engagement",
  },
  {
    category: "At Risk",
    count: 49,
    percentage: 4,
    color: "bg-red-500",
    description: "Below 40% completion or inactive",
  },
]

const topPerformers = [
  { name: "Sarah Johnson", progress: 98, lessonsCompleted: 47, streak: 28 },
  { name: "Michael Chen", progress: 96, lessonsCompleted: 46, streak: 24 },
  { name: "Emma Williams", progress: 94, lessonsCompleted: 45, streak: 21 },
  { name: "David Brown", progress: 93, lessonsCompleted: 44, streak: 19 },
  { name: "Olivia Davis", progress: 92, lessonsCompleted: 44, streak: 17 },
]

export function StudentProgressOverview() {
  return (
    <div className="mb-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Student Progress Overview</h2>
        <p className="text-sm text-muted-foreground">Comprehensive view of student performance and engagement</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <h3 className="mb-4 text-lg font-semibold">Progress Distribution</h3>
          <div className="space-y-4">
            {progressSegments.map((segment) => (
              <div key={segment.category} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-3 w-3 rounded-full ${segment.color}`} />
                    <span className="text-sm font-medium">{segment.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{segment.count} students</span>
                    <Badge variant="outline">{segment.percentage}%</Badge>
                  </div>
                </div>
                <Progress value={segment.percentage} className="h-2" />
                <p className="text-xs text-muted-foreground">{segment.description}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Top Performers</h3>
            <Award className="h-5 w-5 text-yellow-500" />
          </div>
          <div className="space-y-3">
            {topPerformers.map((student, index) => (
              <div key={student.name} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{student.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{student.lessonsCompleted} lessons</span>
                    <span>•</span>
                    <span>{student.streak} day streak</span>
                  </div>
                </div>
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                  {student.progress}%
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="mb-4 text-lg font-semibold">Key Insights</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex items-start gap-3 rounded-lg border border-border p-4">
            <div className="rounded-lg bg-green-500/10 p-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Average Progress Rate</p>
              <p className="text-2xl font-bold">73%</p>
              <p className="text-xs text-muted-foreground">+5% from last month</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border p-4">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <Users className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Active Learners</p>
              <p className="text-2xl font-bold">1,029</p>
              <p className="text-xs text-muted-foreground">84% of total users</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border p-4">
            <div className="rounded-lg bg-yellow-500/10 p-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Need Intervention</p>
              <p className="text-2xl font-bold">192</p>
              <p className="text-xs text-muted-foreground">16% require support</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
