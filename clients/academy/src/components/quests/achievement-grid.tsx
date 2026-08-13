"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Badge } from "@/components/shared/ui/badge"

interface Achievement {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  unlocked: boolean
  bgColor: string
  iconBg: string
  requirement: string
}

export function AchievementGrid() {
  const [stats, setStats] = useState({
    lessonsCompleted: 0,
    currentStreak: 0,
    totalTime: 0,
  })

  useEffect(() => {
    const savedStats = localStorage.getItem("stats")
    if (savedStats) {
      setStats(JSON.parse(savedStats))
    }
  }, [])

  const achievements: Achievement[] = [
    {
      id: "first-lesson",
      title: "First Steps",
      description: "Complete your first lesson",
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      unlocked: stats.lessonsCompleted >= 1,
      bgColor: "bg-orange-50 border-orange-200",
      iconBg: "bg-orange-200 text-orange-700",
      requirement: "Complete 1 lesson",
    },
    {
      id: "five-lessons",
      title: "Quick Learner",
      description: "Complete 5 lessons",
      icon: (
        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ),
      unlocked: stats.lessonsCompleted >= 5,
      bgColor: "bg-blue-50 border-blue-200",
      iconBg: "bg-blue-200 text-blue-700",
      requirement: "Complete 5 lessons",
    },
    {
      id: "streak-3",
      title: "On Fire",
      description: "Maintain a 3-day streak",
      icon: (
        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
            clipRule="evenodd"
          />
        </svg>
      ),
      unlocked: stats.currentStreak >= 3,
      bgColor: "bg-yellow-50 border-yellow-200",
      iconBg: "bg-yellow-200 text-yellow-700",
      requirement: "3-day learning streak",
    },
    {
      id: "time-30",
      title: "Dedicated Student",
      description: "Spend 30 minutes learning",
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      unlocked: stats.totalTime >= 30,
      bgColor: "bg-amber-50 border-amber-200",
      iconBg: "bg-amber-200 text-amber-700",
      requirement: "30 minutes of practice",
    },
    {
      id: "perfect-score",
      title: "Perfect Score",
      description: "Get 100% on a lesson",
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          />
        </svg>
      ),
      unlocked: false,
      bgColor: "bg-gray-50 border-gray-200",
      iconBg: "bg-gray-200 text-gray-600",
      requirement: "Score 100% on any lesson",
    },
    {
      id: "ten-lessons",
      title: "Knowledge Seeker",
      description: "Complete 10 lessons",
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      ),
      unlocked: stats.lessonsCompleted >= 10,
      bgColor: "bg-slate-50 border-slate-200",
      iconBg: "bg-slate-200 text-slate-700",
      requirement: "Complete 10 lessons",
    },
  ]

  return (
    <div>
      <h2 className="text-2xl font-medium mb-4">Badges & Achievements</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {achievements.map((achievement) => (
          <Card
            key={achievement.id}
            className={`border-2 transition-all ${
              achievement.unlocked
                ? `${achievement.bgColor} hover:shadow-xl hover:brightness-95 active:shadow-none active:scale-[0.98]`
                : "opacity-60 hover:opacity-80 grayscale hover:grayscale-0"
            }`}
          >
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                    achievement.unlocked ? achievement.iconBg : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {achievement.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{achievement.title}</h3>
                    {achievement.unlocked && (
                      <Badge className="bg-orange-500 hover:bg-orange-600 flex-shrink-0">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{achievement.description}</p>
                  <p className="text-xs text-gray-600">{achievement.requirement}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
