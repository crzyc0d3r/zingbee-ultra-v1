"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shared/ui/card"
import { Badge } from "@/components/shared/ui/badge"
import { ScrollArea } from "@/components/shared/ui/scroll-area"

interface Lesson {
  id: string
  title: string
  subject: string
  difficulty: "Easy" | "Medium" | "Hard"
  credits: number
  completed: boolean
}

export function LessonSelector() {
  const [selectedLesson, setSelectedLesson] = useState<string>("lesson-1")

  const lessons: Lesson[] = [
    {
      id: "lesson-1",
      title: "Addition Basics",
      subject: "Math",
      difficulty: "Easy",
      credits: 10,
      completed: false,
    },
    {
      id: "lesson-2",
      title: "Subtraction Fun",
      subject: "Math",
      difficulty: "Easy",
      credits: 10,
      completed: false,
    },
    {
      id: "lesson-3",
      title: "Multiplication Tables",
      subject: "Math",
      difficulty: "Medium",
      credits: 15,
      completed: false,
    },
    {
      id: "lesson-4",
      title: "Reading Comprehension",
      subject: "Reading",
      difficulty: "Easy",
      credits: 10,
      completed: false,
    },
    {
      id: "lesson-5",
      title: "Creative Writing",
      subject: "Writing",
      difficulty: "Medium",
      credits: 15,
      completed: false,
    },
    {
      id: "lesson-6",
      title: "Science Experiments",
      subject: "Science",
      difficulty: "Medium",
      credits: 15,
      completed: false,
    },
  ]

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case "Easy":
        return "bg-chart-1/20 text-chart-1"
      case "Medium":
        return "bg-chart-4/20 text-chart-4"
      case "Hard":
        return "bg-destructive/20 text-destructive"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  return (
    <Card className="h-fit sticky top-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          Choose a Lesson
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-3">
            {lessons.map((lesson) => (
              <div
                key={lesson.id}
                className={`p-4 rounded-lg border cursor-pointer transition-all ${
                  selectedLesson === lesson.id ? "border-slate-400 bg-slate-50 shadow-md" : "border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98]"
                }`}
                onClick={() => setSelectedLesson(lesson.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-sm leading-tight">{lesson.title}</h3>
                  {lesson.completed && (
                    <svg className="w-5 h-5 text-chart-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">
                    {lesson.subject}
                  </Badge>
                  <Badge className={`text-xs ${getDifficultyColor(lesson.difficulty)}`}>{lesson.difficulty}</Badge>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    {lesson.credits} credits
                  </span>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
