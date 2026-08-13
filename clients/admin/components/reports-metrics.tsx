import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  TrendingUp,
  TrendingDown,
  Users,
  MessageSquare,
  BookOpen,
  Award,
  Clock,
  Brain,
  Target,
  Zap,
  GraduationCap,
  BarChart3,
} from "lucide-react"

export function ReportsMetrics() {
  const primaryMetrics = [
    {
      title: "Total Students",
      value: "2,847",
      change: "+12.5%",
      trend: "up",
      icon: Users,
      description: "Enrolled across all schools",
    },
    {
      title: "Active Learners",
      value: "1,923",
      change: "+8.3%",
      trend: "up",
      icon: BookOpen,
      description: "Active in last 7 days",
    },
    {
      title: "Chat Sessions",
      value: "15,892",
      change: "+23.1%",
      trend: "up",
      icon: MessageSquare,
      description: "Total AI conversations",
    },
    {
      title: "Completion Rate",
      value: "87.3%",
      change: "-2.1%",
      trend: "down",
      icon: Award,
      description: "Modules completed",
    },
  ]

  const secondaryMetrics = [
    {
      title: "Avg. Session Duration",
      value: "18.4 min",
      change: "+3.2%",
      trend: "up",
      icon: Clock,
    },
    {
      title: "Questions Asked",
      value: "42,156",
      change: "+31.5%",
      trend: "up",
      icon: Brain,
    },
    {
      title: "Learning Goals Met",
      value: "78.9%",
      change: "+5.4%",
      trend: "up",
      icon: Target,
    },
    {
      title: "AI Response Rate",
      value: "99.2%",
      change: "+0.3%",
      trend: "up",
      icon: Zap,
    },
    {
      title: "Avg. Score",
      value: "82.4%",
      change: "+2.8%",
      trend: "up",
      icon: GraduationCap,
    },
    {
      title: "Engagement Score",
      value: "8.7/10",
      change: "+0.5",
      trend: "up",
      icon: BarChart3,
    },
  ]

  const subjectBreakdown = [
    { name: "Biology", students: 2134, progress: 72, color: "#10b981" },
    { name: "Mathematics", students: 2456, progress: 65, color: "#3b82f6" },
    { name: "Islamic Studies", students: 1987, progress: 84, color: "#f59e0b" },
    { name: "Language", students: 1654, progress: 58, color: "#ec4899" },
  ]

  return (
    <div className="space-y-6 mb-6">
      {/* Primary Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {primaryMetrics.map((metric) => (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{metric.title}</CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <div className="flex items-center gap-1 text-xs mt-1">
                {metric.trend === "up" ? (
                  <TrendingUp className="h-3 w-3 text-green-500" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                )}
                <span className={metric.trend === "up" ? "text-green-500" : "text-red-500"}>{metric.change}</span>
                <span className="text-muted-foreground">from last period</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{metric.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary Metrics */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {secondaryMetrics.map((metric) => (
          <Card key={metric.title}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <metric.icon className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">{metric.title}</span>
              </div>
              <div className="text-xl font-bold">{metric.value}</div>
              <div className="flex items-center gap-1 text-xs mt-1">
                {metric.trend === "up" ? (
                  <TrendingUp className="h-3 w-3 text-green-500" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                )}
                <span className={metric.trend === "up" ? "text-green-500" : "text-red-500"}>{metric.change}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Subject Progress Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject Performance Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {subjectBreakdown.map((subject) => (
              <div key={subject.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{subject.name}</span>
                  <span className="text-sm text-muted-foreground">{subject.progress}%</span>
                </div>
                <Progress 
                  value={subject.progress} 
                  className="h-2"
                  style={{ 
                    // @ts-ignore
                    "--progress-background": subject.color 
                  } as React.CSSProperties}
                />
                <p className="text-xs text-muted-foreground">{subject.students.toLocaleString()} active students</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
