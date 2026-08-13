"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { TrendingUp, TrendingDown, MessageSquare, CheckCircle2, Clock } from "lucide-react"

const conversationMetrics = [
  {
    type: "Socratic Questioning",
    effectiveness: 92,
    avgDuration: "12 min",
    completionRate: 89,
    studentSatisfaction: 4.7,
    trend: "up",
    trendValue: 8,
    totalSessions: 1247,
  },
  {
    type: "Step-by-Step Guidance",
    effectiveness: 88,
    avgDuration: "15 min",
    completionRate: 94,
    studentSatisfaction: 4.5,
    trend: "up",
    trendValue: 5,
    totalSessions: 2103,
  },
  {
    type: "Conceptual Explanation",
    effectiveness: 85,
    avgDuration: "10 min",
    completionRate: 82,
    studentSatisfaction: 4.3,
    trend: "down",
    trendValue: 3,
    totalSessions: 1856,
  },
  {
    type: "Practice Problems",
    effectiveness: 91,
    avgDuration: "18 min",
    completionRate: 87,
    studentSatisfaction: 4.6,
    trend: "up",
    trendValue: 12,
    totalSessions: 3421,
  },
  {
    type: "Real-World Examples",
    effectiveness: 87,
    avgDuration: "14 min",
    completionRate: 85,
    studentSatisfaction: 4.4,
    trend: "up",
    trendValue: 6,
    totalSessions: 1632,
  },
]

export function ConversationEffectiveness() {
  return (
    <div className="mb-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Conversation Effectiveness</h2>
        <p className="text-sm text-muted-foreground">
          Analysis of which teaching approaches yield the best learning outcomes
        </p>
      </div>

      <div className="grid gap-4">
        {conversationMetrics.map((metric) => (
          <Card key={metric.type} className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="mb-4 flex items-center gap-3">
                  <h3 className="text-lg font-semibold">{metric.type}</h3>
                  <Badge
                    variant="outline"
                    className={
                      metric.trend === "up"
                        ? "bg-green-500/10 text-green-500 border-green-500/20"
                        : "bg-red-500/10 text-red-500 border-red-500/20"
                    }
                  >
                    {metric.trend === "up" ? (
                      <TrendingUp className="mr-1 h-3 w-3" />
                    ) : (
                      <TrendingDown className="mr-1 h-3 w-3" />
                    )}
                    {metric.trendValue}%
                  </Badge>
                </div>

                <div className="mb-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Overall Effectiveness</span>
                    <span className="font-semibold">{metric.effectiveness}%</span>
                  </div>
                  <Progress value={metric.effectiveness} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span className="text-xs">Avg Duration</span>
                    </div>
                    <p className="text-sm font-medium">{metric.avgDuration}</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-xs">Completion</span>
                    </div>
                    <p className="text-sm font-medium">{metric.completionRate}%</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MessageSquare className="h-4 w-4" />
                      <span className="text-xs">Total Sessions</span>
                    </div>
                    <p className="text-sm font-medium">{metric.totalSessions.toLocaleString()}</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="text-xs">Satisfaction</span>
                    </div>
                    <p className="text-sm font-medium">{metric.studentSatisfaction}/5.0</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
