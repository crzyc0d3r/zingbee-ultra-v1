"use client"

import { useState, useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import {
  Dna,
  Calculator,
  BookOpen,
  Languages,
  Trophy,
  Clock,
  Target,
  TrendingUp,
  CheckCircle,
  Circle,
  PlayCircle,
  Lock,
  ChevronRight,
  Star,
  Flame,
} from "lucide-react"

interface StudentProgressPortalProps {
  student: {
    id: number
    name: string
    email: string
    school: string
    grade: number
  }
  onClose?: () => void
}

// Seeded random number generator for consistent per-student data
function seededRandom(seed: number) {
  const x = Math.sin(seed++) * 10000
  return x - Math.floor(x)
}

function generateStudentData(studentId: number) {
  const seed = studentId * 1000
  
  // Helper to get random number within range based on student
  const getRandom = (min: number, max: number, offset: number) => {
    return Math.floor(seededRandom(seed + offset) * (max - min + 1)) + min
  }
  
  // Generate theme data with progression logic
  const generateThemes = (
    themeNames: string[],
    lessonCounts: number[],
    subjectOffset: number
  ) => {
    const studentProgress = getRandom(20, 95, subjectOffset)
    const themesCompleted = Math.floor((studentProgress / 100) * themeNames.length)
    
    return themeNames.map((name, idx) => {
      const lessons = lessonCounts[idx]
      let status: "completed" | "in-progress" | "locked"
      let progress: number
      let score: number | null
      let completedLessons: number
      
      if (idx < themesCompleted) {
        status = "completed"
        progress = 100
        score = getRandom(70, 98, subjectOffset + idx * 10)
        completedLessons = lessons
      } else if (idx === themesCompleted) {
        status = "in-progress"
        progress = getRandom(15, 85, subjectOffset + idx * 10)
        completedLessons = Math.floor((progress / 100) * lessons)
        score = completedLessons > 0 ? getRandom(60, 90, subjectOffset + idx * 10 + 1) : null
      } else {
        status = "locked"
        progress = 0
        score = null
        completedLessons = 0
      }
      
      return {
        id: idx + 1,
        name,
        progress,
        status,
        score,
        lessons,
        completedLessons,
      }
    })
  }
  
  // Biology themes
  const biologyThemes = generateThemes(
    [
      "Cell Structure & Function",
      "Genetics & Heredity",
      "Evolution & Natural Selection",
      "Ecosystems & Ecology",
      "Human Body Systems",
      "Microbiology",
    ],
    [8, 10, 6, 8, 12, 7],
    100
  )
  
  // Math themes
  const mathThemes = generateThemes(
    [
      "Number Systems & Operations",
      "Algebraic Expressions",
      "Linear Equations",
      "Quadratic Functions",
      "Geometry & Trigonometry",
      "Statistics & Probability",
      "Calculus Foundations",
    ],
    [10, 12, 8, 10, 14, 9, 11],
    200
  )
  
  // Islamic Studies themes
  const islamicThemes = generateThemes(
    [
      "Quran Recitation & Tajweed",
      "Pillars of Islam",
      "Prophetic Stories",
      "Islamic History",
      "Fiqh & Daily Practice",
      "Islamic Ethics & Character",
    ],
    [15, 8, 12, 10, 8, 6],
    300
  )
  
  // Language themes
  const languageThemes = generateThemes(
    [
      "Arabic Alphabet & Pronunciation",
      "Basic Vocabulary",
      "Sentence Structure",
      "Reading Comprehension",
      "Writing Skills",
      "Conversational Practice",
      "Advanced Grammar",
    ],
    [10, 12, 8, 10, 9, 11, 8],
    400
  )
  
  // Calculate subject-level stats from themes
  const calculateSubjectStats = (themes: ReturnType<typeof generateThemes>, totalModules: number) => {
    const completedModules = themes.filter(t => t.status === "completed").length
    const inProgressTheme = themes.find(t => t.status === "in-progress")
    const totalProgress = Math.round(
      (completedModules / totalModules) * 100 + 
      (inProgressTheme ? (inProgressTheme.progress / totalModules) : 0)
    )
    const completedScores = themes.filter(t => t.score !== null).map(t => t.score as number)
    const avgScore = completedScores.length > 0 
      ? Math.round(completedScores.reduce((a, b) => a + b, 0) / completedScores.length)
      : 0
    
    return { totalProgress, completedModules, avgScore }
  }
  
  const biologyStats = calculateSubjectStats(biologyThemes, 6)
  const mathStats = calculateSubjectStats(mathThemes, 7)
  const islamicStats = calculateSubjectStats(islamicThemes, 6)
  const languageStats = calculateSubjectStats(languageThemes, 7)
  
  // Generate hours based on progress
  const generateTimeSpent = (progress: number, offset: number) => {
    const baseHours = Math.floor((progress / 100) * 30) + getRandom(2, 8, offset)
    const minutes = getRandom(0, 59, offset + 1)
    return `${baseHours}h ${minutes}m`
  }

  return {
    streak: getRandom(1, 30, 500),
    level: getRandom(3, 15, 501),
    biology: {
      name: "Biology",
      icon: Dna,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
      borderColor: "border-green-500/20",
      progress: biologyStats.totalProgress,
      totalModules: 6,
      completedModules: biologyStats.completedModules,
      currentStreak: getRandom(0, 14, 502),
      avgScore: biologyStats.avgScore,
      timeSpent: generateTimeSpent(biologyStats.totalProgress, 503),
      themes: biologyThemes,
    },
    math: {
      name: "Mathematics",
      icon: Calculator,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      progress: mathStats.totalProgress,
      totalModules: 7,
      completedModules: mathStats.completedModules,
      currentStreak: getRandom(0, 10, 504),
      avgScore: mathStats.avgScore,
      timeSpent: generateTimeSpent(mathStats.totalProgress, 505),
      themes: mathThemes,
    },
    islamic: {
      name: "Islamic Studies",
      icon: BookOpen,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      progress: islamicStats.totalProgress,
      totalModules: 6,
      completedModules: islamicStats.completedModules,
      currentStreak: getRandom(0, 20, 506),
      avgScore: islamicStats.avgScore,
      timeSpent: generateTimeSpent(islamicStats.totalProgress, 507),
      themes: islamicThemes,
    },
    language: {
      name: "Language",
      icon: Languages,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      borderColor: "border-purple-500/20",
      progress: languageStats.totalProgress,
      totalModules: 7,
      completedModules: languageStats.completedModules,
      currentStreak: getRandom(0, 8, 508),
      avgScore: languageStats.avgScore,
      timeSpent: generateTimeSpent(languageStats.totalProgress, 509),
      themes: languageThemes,
    },
  }
}

// Activity templates for generating per-student activity
const activityTemplates = [
  { subjects: ["Islamic Studies", "Biology", "Mathematics", "Language"], actions: ["Completed lesson", "Quiz score: {score}%", "Started new lesson", "Practice session", "Reviewed material"] },
]

function generateRecentActivity(studentId: number, subjectData: ReturnType<typeof generateStudentData>) {
  const seed = studentId * 2000
  const activities: Array<{ subject: string; theme: string; action: string; time: string }> = []
  const times = ["1 hour ago", "2 hours ago", "3 hours ago", "Yesterday", "2 days ago", "3 days ago", "4 days ago"]
  
  const subjects = [
    { name: "Islamic Studies", data: subjectData.islamic },
    { name: "Mathematics", data: subjectData.math },
    { name: "Biology", data: subjectData.biology },
    { name: "Language", data: subjectData.language },
  ]
  
  for (let i = 0; i < 4; i++) {
    const subjectIdx = Math.floor(seededRandom(seed + i * 10) * subjects.length)
    const subject = subjects[subjectIdx]
    const activeThemes = subject.data.themes.filter(t => t.status !== "locked")
    if (activeThemes.length === 0) continue
    
    const themeIdx = Math.floor(seededRandom(seed + i * 10 + 1) * activeThemes.length)
    const theme = activeThemes[themeIdx]
    
    const actions = ["Completed lesson", `Quiz score: ${Math.floor(seededRandom(seed + i * 10 + 2) * 30) + 70}%`, "Started new lesson", "Practice session"]
    const actionIdx = Math.floor(seededRandom(seed + i * 10 + 3) * actions.length)
    
    activities.push({
      subject: subject.name,
      theme: theme.name,
      action: actions[actionIdx],
      time: times[i],
    })
  }
  
  return activities
}

export function StudentProgressPortal({ student, onClose }: StudentProgressPortalProps) {
  // Generate unique data for this student based on their ID
  const studentData = useMemo(() => generateStudentData(student.id), [student.id])
  const recentActivity = useMemo(() => generateRecentActivity(student.id, studentData), [student.id, studentData])
  
  const subjectData = useMemo(() => ({
    biology: studentData.biology,
    math: studentData.math,
    islamic: studentData.islamic,
    language: studentData.language,
  }), [studentData])
  
  const [activeSubject, setActiveSubject] = useState<keyof typeof subjectData>("biology")

  const currentSubject = subjectData[activeSubject]
  const SubjectIcon = currentSubject.icon

  const overallProgress = Math.round(
    (subjectData.biology.progress +
      subjectData.math.progress +
      subjectData.islamic.progress +
      subjectData.language.progress) /
      4
  )

  return (
    <div className="space-y-6">
      {/* Student Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{student.name}</h2>
          <p className="text-muted-foreground">
            {student.school} - Grade {student.grade}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            <span className="font-medium text-foreground">{studentData.streak} day streak</span>
          </div>
          <Badge variant="default" className="bg-primary">
            <Star className="mr-1 h-3 w-3" />
            Level {studentData.level}
          </Badge>
        </div>
      </div>

      {/* Overall Progress Summary */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-card bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Overall Progress</p>
              <p className="text-2xl font-bold text-foreground">{overallProgress}%</p>
            </div>
          </div>
        </Card>
        {Object.entries(subjectData).map(([key, subject]) => {
          const Icon = subject.icon
          return (
            <Card
              key={key}
              className={`cursor-pointer border p-4 transition-all hover:border-primary/50 ${
                activeSubject === key ? "border-primary bg-primary/5" : "border-card bg-card"
              }`}
              onClick={() => setActiveSubject(key as keyof typeof subjectData)}
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${subject.bgColor}`}>
                  <Icon className={`h-5 w-5 ${subject.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{subject.name}</p>
                  <p className="text-xl font-bold text-foreground">{subject.progress}%</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Subject Detail Tabs */}
      <Tabs value={activeSubject} onValueChange={(v) => setActiveSubject(v as keyof typeof subjectData)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="biology" className="flex items-center gap-2">
            <Dna className="h-4 w-4" />
            <span className="hidden sm:inline">Biology</span>
          </TabsTrigger>
          <TabsTrigger value="math" className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            <span className="hidden sm:inline">Math</span>
          </TabsTrigger>
          <TabsTrigger value="islamic" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Islamic Studies</span>
          </TabsTrigger>
          <TabsTrigger value="language" className="flex items-center gap-2">
            <Languages className="h-4 w-4" />
            <span className="hidden sm:inline">Language</span>
          </TabsTrigger>
        </TabsList>

        {Object.entries(subjectData).map(([key, subject]) => (
          <TabsContent key={key} value={key} className="mt-6">
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Subject Stats */}
              <div className="space-y-4 lg:col-span-1">
                <Card className={`border p-4 ${subject.borderColor} bg-card`}>
                  <div className="mb-4 flex items-center gap-3">
                    <div className={`rounded-lg p-3 ${subject.bgColor}`}>
                      <SubjectIcon className={`h-6 w-6 ${subject.color}`} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{subject.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {subject.completedModules} of {subject.totalModules} modules
                      </p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="mb-2 flex justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium text-foreground">{subject.progress}%</span>
                    </div>
                    <Progress value={subject.progress} className="h-2" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="flex items-center gap-2">
                        <Trophy className="h-4 w-4 text-amber-500" />
                        <span className="text-xs text-muted-foreground">Avg Score</span>
                      </div>
                      <p className="mt-1 text-lg font-bold text-foreground">{subject.avgScore}%</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-blue-500" />
                        <span className="text-xs text-muted-foreground">Time</span>
                      </div>
                      <p className="mt-1 text-lg font-bold text-foreground">{subject.timeSpent}</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="flex items-center gap-2">
                        <Flame className="h-4 w-4 text-orange-500" />
                        <span className="text-xs text-muted-foreground">Streak</span>
                      </div>
                      <p className="mt-1 text-lg font-bold text-foreground">{subject.currentStreak} days</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <span className="text-xs text-muted-foreground">Trend</span>
                      </div>
                      <p className="mt-1 text-lg font-bold text-green-500">+12%</p>
                    </div>
                  </div>
                </Card>

                {/* Recent Activity */}
                <Card className="border-card bg-card p-4">
                  <h4 className="mb-3 font-medium text-foreground">Recent Activity</h4>
                  <div className="space-y-3">
                    {recentActivity.map((activity, idx) => (
                      <div key={idx} className="flex items-start gap-3 text-sm">
                        <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                        <div>
                          <p className="text-foreground">
                            {activity.action} - {activity.theme}
                          </p>
                          <p className="text-xs text-muted-foreground">{activity.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Theme Progress */}
              <div className="lg:col-span-2">
                <Card className="border-card bg-card p-4">
                  <h4 className="mb-4 font-medium text-foreground">Learning Themes</h4>
                  <div className="space-y-3">
                    {subject.themes.map((theme) => (
                      <div
                        key={theme.id}
                        className={`rounded-lg border p-4 transition-all ${
                          theme.status === "locked"
                            ? "border-muted bg-muted/30 opacity-60"
                            : theme.status === "in-progress"
                              ? "border-primary/50 bg-primary/5"
                              : "border-card bg-card hover:border-muted-foreground/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {theme.status === "completed" ? (
                              <CheckCircle className="h-5 w-5 text-green-500" />
                            ) : theme.status === "in-progress" ? (
                              <PlayCircle className="h-5 w-5 text-primary" />
                            ) : theme.status === "locked" ? (
                              <Lock className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground" />
                            )}
                            <div>
                              <p className="font-medium text-foreground">{theme.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {theme.completedLessons} of {theme.lessons} lessons
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {theme.score !== null && (
                              <div className="text-right">
                                <p className="text-sm text-muted-foreground">Score</p>
                                <p
                                  className={`font-bold ${theme.score >= 80 ? "text-green-500" : theme.score >= 60 ? "text-amber-500" : "text-red-500"}`}
                                >
                                  {theme.score}%
                                </p>
                              </div>
                            )}
                            <div className="w-24">
                              <div className="mb-1 flex justify-between text-xs">
                                <span className="text-muted-foreground">Progress</span>
                                <span className="text-foreground">{theme.progress}%</span>
                              </div>
                              <Progress value={theme.progress} className="h-1.5" />
                            </div>
                            {theme.status !== "locked" && (
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
