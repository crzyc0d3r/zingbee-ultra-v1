"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shared/ui/card"
import { Progress } from "@/components/shared/ui/progress"

export function LevelProgress() {
  const [user, setUser] = useState<{ username: string; credits: number; level: number } | null>(null)

  useEffect(() => {
    const userData = localStorage.getItem("user")
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  if (!user) return null

  const creditsForNextLevel = user.level * 100
  const currentLevelProgress = (user.credits % 100) / 100
  const progressPercentage = currentLevelProgress * 100

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          Level Progress
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-chart-1 flex items-center justify-center text-white font-bold text-2xl">
                {user.level}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{user.credits} total credits</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-primary">{Math.round(progressPercentage)}%</p>
              <p className="text-xs text-muted-foreground">to Level {user.level + 1}</p>
            </div>
          </div>
          <div className="space-y-2">
            <Progress value={progressPercentage} className="h-3" />
            <p className="text-xs text-muted-foreground text-center">
              {100 - (user.credits % 100)} more credits to reach Level {user.level + 1}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
