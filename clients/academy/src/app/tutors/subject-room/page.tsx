"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { Brain, BookOpen, PenTool, CheckCircle, FileText, ArrowRight, Play, RotateCcw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

interface LearningStep {
  id: string
  name: string
  icon: any
  description: string
  color: string
}

const learningSteps: LearningStep[] = [
  {
    id: "recall",
    name: "Recall",
    icon: Brain,
    description: "Review what you learned last time",
    color: "bg-purple-500",
  },
  {
    id: "teach",
    name: "Teach",
    icon: BookOpen,
    description: "Learn new concepts and ideas",
    color: "bg-blue-500",
  },
  {
    id: "try",
    name: "Try",
    icon: PenTool,
    description: "Practice what you've learned",
    color: "bg-slate-500",
  },
  {
    id: "check",
    name: "Check",
    icon: CheckCircle,
    description: "Verify your understanding",
    color: "bg-yellow-500",
  },
  {
    id: "evidence",
    name: "Evidence",
    icon: FileText,
    description: "Show what you know",
    color: "bg-orange-500",
  },
  {
    id: "next",
    name: "Next Steps",
    icon: ArrowRight,
    description: "Plan your continued learning",
    color: "bg-pink-500",
  },
]

export default function SubjectRoomPage() {
  const { isLoading } = useAuth()
  const router = useRouter()
  const [tutorData, setTutorData] = useState<any>(null)
  const [selectedTheme, setSelectedTheme] = useState<any>(null)
  const [showWelcome, setShowWelcome] = useState(true)
  const [lastSession, setLastSession] = useState<any>(null)

  useEffect(() => {
    const selectedTutor = localStorage.getItem("selectedTutor")
    const topic = localStorage.getItem("selectedTheme")

    if (selectedTutor) {
      try {
        const tutor = JSON.parse(selectedTutor)
        setTutorData(tutor)

        if (topic) {
          const parsedTheme = JSON.parse(topic)
          setSelectedTheme(parsedTheme)

          // Check for last session
          const sessionKey = `last_session_${tutor.name}_${parsedTheme.id}`
          const savedSession = localStorage.getItem(sessionKey)
          if (savedSession) {
            setLastSession(JSON.parse(savedSession))
          }
        }
      } catch {
        router.push("/tutors/dashboard")
      }
    } else {
      router.push("/tutors/dashboard")
    }
  }, [router])

  const handleContinue = () => {
    // Store that we're continuing from last session
    localStorage.setItem("continueSession", "true")
    localStorage.setItem("currentPhase", lastSession?.phase || "recall")
    router.push("/tutors/learning")
  }

  const handleNewTheme = () => {
    // Clear session and start fresh
    localStorage.removeItem("continueSession")
    localStorage.setItem("currentPhase", "recall")
    router.push("/tutors/learning")
  }

  if (isLoading || !tutorData || !selectedTheme) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  const tutorCharacter = tutorData.character || "🎓"

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <DashboardHeader />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {showWelcome ? (
          <div className="space-y-6">
            {/* Welcome Header */}
            <div className="text-center mb-8">
              <div
                className={`w-24 h-24 rounded-3xl ${tutorData.color} flex items-center justify-center mx-auto mb-4 shadow-lg`}
              >
                <span className="text-5xl">{tutorCharacter}</span>
              </div>
              <h1 className="text-4xl font-medium text-slate-900 mb-3">Welcome to {selectedTheme.title}!</h1>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Hi! I'm {tutorData.name}, and I'm excited to help you learn about {selectedTheme.title}.
                {selectedTheme.description}
              </p>
            </div>

            {/* Session Options */}
            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {/* Continue Last Session */}
              {lastSession && (
                <Card className="border border-slate-200 bg-white hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all cursor-pointer group">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
                        <RotateCcw className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-medium text-slate-900 mb-2">Continue Where You Left Off</h3>
                        <p className="text-sm text-slate-600 mb-3">
                          Pick up from your last session and review what you learned
                        </p>
                        <div className="bg-blue-50 rounded-lg p-3 mb-3">
                          <p className="text-xs text-blue-900 font-medium mb-1">Last Session:</p>
                          <p className="text-sm text-blue-700">
                            {lastSession.summary || "You were working on understanding key concepts"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>Phase: {lastSession.phase || "Recall"}</span>
                          <span>•</span>
                          <span>{new Date(lastSession.timestamp).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <Button onClick={handleContinue} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                      Continue Learning
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Start New Topic */}
              <Card className="border border-slate-200 bg-white hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all cursor-pointer group">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <Play className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-medium text-slate-900 mb-2">Start Fresh</h3>
                      <p className="text-sm text-slate-600 mb-4">Begin a new learning journey with this topic</p>
                      <div className="bg-slate-50 rounded-lg p-3 mb-3">
                        <p className="text-xs text-slate-900 font-medium mb-2">You'll go through:</p>
                        <ul className="text-xs text-slate-700 space-y-1">
                          <li>• Recall - Warm up your brain</li>
                          <li>• Teach - Learn new concepts</li>
                          <li>• Try - Practice skills</li>
                          <li>• Check - Test understanding</li>
                          <li>• Evidence - Show what you know</li>
                          <li>• Next Steps - Plan ahead</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <Button onClick={handleNewTheme} className="w-full bg-slate-900 hover:bg-slate-800 text-white">
                    Start New Session
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Learning Process Overview */}
            <div className="mt-12">
              <h2 className="text-2xl font-medium text-slate-900 text-center mb-6">Your Learning Journey</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {learningSteps.map((step, index) => {
                  const Icon = step.icon
                  return (
                    <Card key={step.id} className="border border-slate-200 bg-white">
                      <CardContent className="p-4 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <div className={`w-12 h-12 rounded-xl ${step.color} flex items-center justify-center`}>
                            <Icon className="w-6 h-6 text-white" />
                          </div>
                          <div className="text-xs font-medium text-slate-900">
                            {index + 1}. {step.name}
                          </div>
                          <p className="text-xs text-slate-600 leading-tight">{step.description}</p>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
