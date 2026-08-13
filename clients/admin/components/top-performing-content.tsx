"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Star, ThumbsUp, MessageSquare } from "lucide-react"

const topContent = [
  {
    title: "Introduction to Algebra",
    subject: "Mathematics",
    completionRate: 94,
    avgRating: 4.8,
    engagementScore: 92,
    totalStudents: 856,
    avgTimeSpent: "22 min",
  },
  {
    title: "Photosynthesis Explained",
    subject: "Science",
    completionRate: 91,
    avgRating: 4.7,
    engagementScore: 89,
    totalStudents: 743,
    avgTimeSpent: "18 min",
  },
  {
    title: "World War II Timeline",
    subject: "History",
    completionRate: 88,
    avgRating: 4.6,
    engagementScore: 85,
    totalStudents: 621,
    avgTimeSpent: "25 min",
  },
  {
    title: "Shakespeare's Sonnets",
    subject: "English",
    completionRate: 86,
    avgRating: 4.5,
    engagementScore: 83,
    totalStudents: 534,
    avgTimeSpent: "20 min",
  },
  {
    title: "Geometry Fundamentals",
    subject: "Mathematics",
    completionRate: 90,
    avgRating: 4.7,
    engagementScore: 88,
    totalStudents: 789,
    avgTimeSpent: "24 min",
  },
]

const subjectColors: Record<string, string> = {
  Mathematics: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Science: "bg-green-500/10 text-green-500 border-green-500/20",
  History: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  English: "bg-orange-500/10 text-orange-500 border-orange-500/20",
}

export function TopPerformingContent() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Top Performing Content</h2>
        <p className="text-sm text-muted-foreground">
          Lessons and modules with highest engagement and completion rates
        </p>
      </div>

      <div className="grid gap-4">
        {topContent.map((content, index) => (
          <Card key={content.title} className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-lg font-bold text-primary">
                {index + 1}
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{content.title}</h3>
                    <Badge variant="outline" className={subjectColors[content.subject]}>
                      {content.subject}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-yellow-500">
                    <Star className="h-4 w-4 fill-current" />
                    <span className="text-sm font-semibold">{content.avgRating}</span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Completion Rate</span>
                      <span className="font-semibold">{content.completionRate}%</span>
                    </div>
                    <Progress value={content.completionRate} className="h-2" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Engagement Score</span>
                      <span className="font-semibold">{content.engagementScore}%</span>
                    </div>
                    <Progress value={content.engagementScore} className="h-2" />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <MessageSquare className="h-4 w-4" />
                        <span>{content.totalStudents}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <ThumbsUp className="h-4 w-4" />
                        <span>{content.avgTimeSpent}</span>
                      </div>
                    </div>
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
