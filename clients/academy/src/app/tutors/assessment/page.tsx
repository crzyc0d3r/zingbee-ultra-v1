"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { Card } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Progress } from "@/components/shared/ui/progress"
import { Textarea } from "@/components/shared/ui/textarea"
import { useAuth } from "@/hooks/use-auth"
import {
  apiClient,
  type PlacementQuestionWithVariant,
  type AssessmentResultResponse,
  type AssessmentResponseData,
} from "@/lib/api-client"
import Image from "next/image"
import { ChevronLeft, ChevronRight, Clock, CheckCircle2, AlertCircle, Trophy, RotateCcw } from "lucide-react"

type AssessmentStatus = "loading" | "intro" | "in_progress" | "completed"

interface AssessmentState {
  status: AssessmentStatus
  assessmentId: string | null  // Server-side assessment ID for resumable flow
  assessmentStartedAt: string
  currentQuestionIndex: number
  currentQuestionStartedAt: string
  questions: PlacementQuestionWithVariant[]
  responses: AssessmentResponseData[]
  results?: AssessmentResultResponse
  subjectName: string
  subjectId: string
  maxScore: number
  hasInProgressAssessment: boolean
  inProgressAssessmentId: string | null
}

const subjectIcons: Record<string, string> = {
  Math: "/icons/glassmorphism/drafting-compass.svg",
  Mathematics: "/icons/glassmorphism/drafting-compass.svg",
  English: "/icons/glassmorphism/quill-with-ink.svg",
  "English Language & Literature": "/icons/glassmorphism/quill-with-ink.svg",
  Biology: "/icons/glassmorphism/biotech.svg",
  Chemistry: "/icons/glassmorphism/microscope.svg",
  Physics: "/icons/glassmorphism/telescope.svg",
}

export default function AssessmentPage() {
  const { isLoading: isAuthLoading } = useAuth()
  const router = useRouter()
  const t = useTranslations("assessment")
  const [subjectData, setSubjectData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [elapsedTime, setElapsedTime] = useState(0)
  const savingRef = useRef(false)  // Prevent duplicate save calls
  const pendingSaveRef = useRef<{responses: AssessmentResponseData[], questionIndex: number} | null>(null)

  const [state, setState] = useState<AssessmentState>({
    status: "loading",
    assessmentId: null,
    assessmentStartedAt: "",
    currentQuestionIndex: 0,
    currentQuestionStartedAt: "",
    questions: [],
    responses: [],
    subjectName: "",
    subjectId: "",
    maxScore: 0,
    hasInProgressAssessment: false,
    inProgressAssessmentId: null,
  })

  const [currentAnswer, setCurrentAnswer] = useState<string>("")

  // Load subject and check for in-progress assessment
  useEffect(() => {
    const initializeAssessment = async () => {
      const selectedSubject = localStorage.getItem("selectedSubject")
      if (!selectedSubject) {
        router.push("/tutors/dashboard")
        return
      }

      try {
        const subject = JSON.parse(selectedSubject)
        setSubjectData(subject)

        // Get student ID
        const studentData = localStorage.getItem("student")
        if (!studentData) {
          router.push("/login")
          return
        }
        const student = JSON.parse(studentData)

        // Check for in-progress assessment
        const placementCheck = await apiClient.studentPreferences.checkPlacement(student.id, subject.id)

        if (placementCheck.has_in_progress && placementCheck.in_progress_assessment_id) {
          // Resume existing assessment
          setState((prev) => ({
            ...prev,
            subjectName: subject.specialty,
            subjectId: subject.id,
            hasInProgressAssessment: true,
            inProgressAssessmentId: placementCheck.in_progress_assessment_id!,
            status: "intro",
          }))
        } else if (placementCheck.has_placement) {
          // Already has placement, go to themes
          router.push("/tutors/themes")
          return
        } else {
          // No placement, show intro for new assessment
          setState((prev) => ({
            ...prev,
            subjectName: subject.specialty,
            subjectId: subject.id,
            status: "intro",
          }))
        }
        setError("")
      } catch (err: any) {
        console.error("Error initializing assessment:", err)
        setError(t("failedToLoad"))
      } finally {
        setLoading(false)
      }
    }

    initializeAssessment()
  }, [router])

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (state.status === "in_progress") {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1)
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [state.status])

  // Warn user before leaving page during assessment
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.status === "in_progress") {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [state.status])

  // Start a new assessment via API
  const startAssessment = async () => {
    try {
      setLoading(true)
      const studentData = localStorage.getItem("student")
      if (!studentData) {
        router.push("/login")
        return
      }
      const student = JSON.parse(studentData)

      const startResponse = await apiClient.studentAssessments.start({
        student_id: student.id,
        subject_id: state.subjectId,
      })

      const now = new Date().toISOString()
      setState((prev) => ({
        ...prev,
        status: "in_progress",
        assessmentId: startResponse.id,
        assessmentStartedAt: startResponse.started_at.toString(),
        currentQuestionStartedAt: now,
        currentQuestionIndex: 0,
        questions: startResponse.questions as PlacementQuestionWithVariant[],
        responses: [],
        maxScore: startResponse.questions.length,
      }))
      setCurrentAnswer("")
      setElapsedTime(0)
      setError("")
    } catch (err: any) {
      console.error("Error starting assessment:", err)
      setError(t("failedToStart"))
    } finally {
      setLoading(false)
    }
  }

  // Resume an in-progress assessment
  const resumeAssessment = async () => {
    if (!state.inProgressAssessmentId) return

    try {
      setLoading(true)
      const resumeResponse = await apiClient.studentAssessments.resume(state.inProgressAssessmentId)

      // Calculate elapsed time from start
      // Server returns UTC time without timezone suffix, so append 'Z' to parse correctly
      const startTimeStr = resumeResponse.started_at.toString()
      const startTime = new Date(startTimeStr.endsWith('Z') ? startTimeStr : startTimeStr + 'Z').getTime()
      const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000))

      const now = new Date().toISOString()
      setState((prev) => ({
        ...prev,
        status: "in_progress",
        assessmentId: resumeResponse.id,
        assessmentStartedAt: resumeResponse.started_at.toString(),
        currentQuestionStartedAt: now,
        currentQuestionIndex: resumeResponse.current_question_index,
        questions: resumeResponse.questions as PlacementQuestionWithVariant[],
        responses: resumeResponse.responses as AssessmentResponseData[],
        maxScore: resumeResponse.questions.length,
      }))

      // Set current answer if resuming to a previously answered question
      const currentResponse = resumeResponse.responses.find(
        (r: any) => r.question_id === resumeResponse.questions[resumeResponse.current_question_index]?.id
      )
      setCurrentAnswer(currentResponse?.student_answer || "")
      setElapsedTime(elapsed)
      setError("")
    } catch (err: any) {
      console.error("Error resuming assessment:", err)
      setError(t("failedToResume"))
    } finally {
      setLoading(false)
    }
  }

  const handleAnswerSelect = (answer: string) => {
    setCurrentAnswer(answer)
  }

  // Build response object for current question
  const buildCurrentResponse = useCallback((): AssessmentResponseData | null => {
    if (!state.questions[state.currentQuestionIndex] || !currentAnswer) return null

    const now = new Date().toISOString()
    const question = state.questions[state.currentQuestionIndex]
    const startedAt = state.currentQuestionStartedAt
    const startTime = new Date(startedAt).getTime()
    const endTime = new Date(now).getTime()
    const timeSpent = Math.round((endTime - startTime) / 1000)

    return {
      question_id: question.id,
      question_code: question.question_code,
      question_number: state.currentQuestionIndex + 1,
      variant_id: question.variant_id,
      student_answer: currentAnswer,
      started_at: startedAt,
      answered_at: now,
      time_spent_seconds: timeSpent,
    }
  }, [state.questions, state.currentQuestionIndex, state.currentQuestionStartedAt, currentAnswer])

  // Save current response locally and return updated responses array
  const saveCurrentResponseLocally = useCallback(() => {
    const response = buildCurrentResponse()
    if (!response) return state.responses

    const existingIndex = state.responses.findIndex((r) => r.question_id === response.question_id)
    const newResponses = [...state.responses]
    if (existingIndex >= 0) {
      newResponses[existingIndex] = response
    } else {
      newResponses.push(response)
    }
    return newResponses
  }, [buildCurrentResponse, state.responses])

  // Save progress to server (auto-save after each question)
  const saveProgressToServer = useCallback(async (responses: AssessmentResponseData[], questionIndex: number) => {
    if (!state.assessmentId) return

    // If already saving, queue the latest state
    if (savingRef.current) {
      pendingSaveRef.current = { responses, questionIndex }
      return
    }

    try {
      savingRef.current = true
      await apiClient.studentAssessments.saveProgress(state.assessmentId, {
        current_question_index: questionIndex,
        responses: responses,
      })
    } catch (err: any) {
      console.error("Error auto-saving progress:", err)
      // Don't show error for auto-save failures, just log
    } finally {
      savingRef.current = false
      // Process any pending save that came in while we were saving
      if (pendingSaveRef.current) {
        const pending = pendingSaveRef.current
        pendingSaveRef.current = null
        // Use setTimeout to avoid blocking and potential stack overflow
        setTimeout(() => saveProgressToServer(pending.responses, pending.questionIndex), 0)
      }
    }
  }, [state.assessmentId])

  const goToNextQuestion = async () => {
    const newResponses = saveCurrentResponseLocally()
    const now = new Date().toISOString()

    if (state.currentQuestionIndex < state.questions.length - 1) {
      const nextIndex = state.currentQuestionIndex + 1
      const existingResponse = newResponses.find(
        (r) => r.question_id === state.questions[nextIndex].id
      )

      setState((prev) => ({
        ...prev,
        responses: newResponses,
        currentQuestionIndex: nextIndex,
        currentQuestionStartedAt: now,
      }))
      setCurrentAnswer(existingResponse?.student_answer || "")

      // Auto-save progress to server
      await saveProgressToServer(newResponses, nextIndex)
    }
  }

  const goToPreviousQuestion = async () => {
    const newResponses = saveCurrentResponseLocally()
    const now = new Date().toISOString()

    if (state.currentQuestionIndex > 0) {
      const prevIndex = state.currentQuestionIndex - 1
      const existingResponse = newResponses.find(
        (r) => r.question_id === state.questions[prevIndex].id
      )

      setState((prev) => ({
        ...prev,
        responses: newResponses,
        currentQuestionIndex: prevIndex,
        currentQuestionStartedAt: now,
      }))
      setCurrentAnswer(existingResponse?.student_answer || "")

      // Auto-save progress to server
      await saveProgressToServer(newResponses, prevIndex)
    }
  }

  // Jump to a specific question
  const jumpToQuestion = async (targetIndex: number) => {
    const newResponses = saveCurrentResponseLocally()
    const existingResponse = newResponses.find(
      (r) => r.question_id === state.questions[targetIndex].id
    )

    setState((prev) => ({
      ...prev,
      responses: newResponses,
      currentQuestionIndex: targetIndex,
      currentQuestionStartedAt: new Date().toISOString(),
    }))
    setCurrentAnswer(existingResponse?.student_answer || "")

    // Auto-save progress to server
    await saveProgressToServer(newResponses, targetIndex)
  }

  const submitAssessment = async () => {
    const finalResponses = saveCurrentResponseLocally()

    if (!state.assessmentId) {
      setError(t("sessionNotFound"))
      return
    }

    try {
      setIsSubmitting(true)
      const result = await apiClient.studentAssessments.submit({
        assessment_id: state.assessmentId,
        responses: finalResponses,
      })

      setState((prev) => ({
        ...prev,
        status: "completed",
        responses: finalResponses,
        results: result,
      }))
    } catch (err: any) {
      console.error("Error submitting assessment:", err)
      setError(t("failedToSubmit"))
    } finally {
      setIsSubmitting(false)
    }
  }

  const continueToThemes = () => {
    if (state.results) {
      localStorage.setItem(
        "assignedPhase",
        JSON.stringify({
          phase_id: state.results.assigned_phase_id || state.results.assigned_phase_number || (state.results as any).assigned_phase,
          phase_number: state.results.assigned_phase_number || (state.results as any).assigned_phase,
          phase_name: state.results.assigned_phase_name || `Phase ${state.results.assigned_phase_number || (state.results as any).assigned_phase}`,
          assigned_phase: (state.results as any).assigned_phase || state.results.assigned_phase_number,
        })
      )
    }
    router.push("/tutors/themes")
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  if (isAuthLoading || loading || state.status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-primary/10">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 text-center">
          <p className="text-lg text-slate-600">{t("loadingAssessment")}</p>
        </div>
      </div>
    )
  }

  // Fun animated "Reviewing assessment" screen
  if (isSubmitting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-primary/10 flex items-center justify-center">
        <div className="text-center">
          {/* Dancing Robot Animation */}
          <div className="relative w-32 h-32 mx-auto mb-8">
            {/* Robot Body */}
            <div className="absolute inset-0 animate-bounce" style={{ animationDuration: '1s' }}>
              <svg viewBox="0 0 100 100" className="w-full h-full">
                {/* Antenna */}
                <circle cx="50" cy="8" r="4" fill="#6366f1" className="animate-pulse" />
                <rect x="48" y="10" width="4" height="10" fill="#94a3b8" />

                {/* Head */}
                <rect x="25" y="20" width="50" height="35" rx="8" fill="#6366f1" />

                {/* Eyes */}
                <circle cx="38" cy="35" r="6" fill="white" />
                <circle cx="62" cy="35" r="6" fill="white" />
                <circle cx="38" cy="35" r="3" fill="#1e293b">
                  <animate attributeName="cx" values="36;40;36" dur="2s" repeatCount="indefinite" />
                </circle>
                <circle cx="62" cy="35" r="3" fill="#1e293b">
                  <animate attributeName="cx" values="60;64;60" dur="2s" repeatCount="indefinite" />
                </circle>

                {/* Mouth - Happy smile */}
                <path d="M 40 45 Q 50 52 60 45" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />

                {/* Body */}
                <rect x="30" y="55" width="40" height="30" rx="5" fill="#6366f1" />

                {/* Screen on body */}
                <rect x="38" y="60" width="24" height="12" rx="2" fill="#22c55e" className="animate-pulse" />

                {/* Arms */}
                <g className="origin-top-right" style={{ transformOrigin: '30px 60px' }}>
                  <rect x="15" y="58" width="15" height="8" rx="4" fill="#94a3b8">
                    <animateTransform attributeName="transform" type="rotate" values="-10;10;-10" dur="0.5s" repeatCount="indefinite" />
                  </rect>
                </g>
                <g style={{ transformOrigin: '70px 60px' }}>
                  <rect x="70" y="58" width="15" height="8" rx="4" fill="#94a3b8">
                    <animateTransform attributeName="transform" type="rotate" values="10;-10;10" dur="0.5s" repeatCount="indefinite" />
                  </rect>
                </g>

                {/* Legs */}
                <rect x="35" y="85" width="10" height="12" rx="3" fill="#94a3b8">
                  <animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" dur="0.5s" repeatCount="indefinite" />
                </rect>
                <rect x="55" y="85" width="10" height="12" rx="3" fill="#94a3b8">
                  <animateTransform attributeName="transform" type="translate" values="0,-3;0,0;0,-3" dur="0.5s" repeatCount="indefinite" />
                </rect>
              </svg>
            </div>

            {/* Sparkles around robot */}
            <div className="absolute -top-2 -left-2 text-2xl animate-ping" style={{ animationDuration: '1.5s' }}>✨</div>
            <div className="absolute -top-2 -right-2 text-2xl animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }}>✨</div>
            <div className="absolute -bottom-2 left-4 text-xl animate-ping" style={{ animationDuration: '1.8s', animationDelay: '0.3s' }}>⭐</div>
            <div className="absolute -bottom-2 right-4 text-xl animate-ping" style={{ animationDuration: '1.6s', animationDelay: '0.7s' }}>⭐</div>
          </div>

          {/* Loading Text */}
          <h2 className="text-2xl font-medium text-slate-800 mb-3">
            {t("reviewingAssessment")}
          </h2>
          <p className="text-slate-600 mb-6">
            {t("pleaseWait")}
          </p>

          {/* Animated dots */}
          <div className="flex justify-center gap-2">
            <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    )
  }

  if (error && state.status !== "in_progress") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-primary/10">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 text-center">
          <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <p className="text-lg text-slate-700 mb-4">{error}</p>
          <div className="flex gap-4 justify-center">
            <Button onClick={() => router.push("/tutors/dashboard")} variant="outline">
              {t("backToDashboard")}
            </Button>
            <Button onClick={() => window.location.reload()}>
              {t("tryAgain")}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Show error with retry during assessment if submission fails
  if (error && state.status === "in_progress") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-primary/10">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-slate-900 mb-2">{t("submissionFailed")}</h2>
          <p className="text-slate-600 mb-6">{error}</p>
          <div className="flex gap-4 justify-center">
            <Button onClick={() => setError("")} variant="outline">
              {t("continueAssessment")}
            </Button>
            <Button onClick={submitAssessment}>
              {t("retrySubmission")}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const subjectIconSrc = subjectData ? subjectIcons[subjectData.specialty] || "/icons/glassmorphism/open-book.svg" : "/icons/glassmorphism/open-book.svg"

  if (state.status === "intro") {
    const hasInProgress = state.hasInProgressAssessment

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-primary/10">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <Card className="p-8 bg-white border border-slate-200">
            <div className="text-center">
              <div className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Image src={subjectIconSrc} alt={state.subjectName} width={64} height={64} className="object-contain" />
              </div>
              <h1 className="text-3xl text-slate-900 mb-2">
                {t("title", { subject: state.subjectName })}
              </h1>
              <div className="w-16 h-1 bg-primary mx-auto mb-6 rounded-full" />

              {hasInProgress ? (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                    <div className="flex items-center justify-center gap-2 text-amber-700 mb-2">
                      <RotateCcw className="w-5 h-5" />
                      <span className="font-semibold">{t("inProgressTitle")}</span>
                    </div>
                    <p className="text-amber-600 text-sm">
                      {t("inProgressMessage")}
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <Button
                      onClick={resumeAssessment}
                      size="lg"
                      disabled={loading}
                      className="bg-primary hover:bg-primary/90 text-white px-8 py-6 text-lg rounded-xl"
                    >
                      {loading ? t("loadingButton") : t("resumeButton")}
                    </Button>
                    <Button
                      onClick={startAssessment}
                      variant="outline"
                      size="lg"
                      disabled={loading}
                      className="text-slate-600"
                    >
                      {t("startOverButton")}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-lg text-slate-600 mb-8 italic">
                    "{t("intro")}"
                  </p>

                  <div className="bg-slate-50 rounded-xl p-6 mb-8 text-left">
                    <ul className="space-y-3">
                      <li className="flex items-center text-slate-700">
                        <CheckCircle2 className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                        <span>{t("questionCount")}</span>
                      </li>
                      <li className="flex items-center text-slate-700">
                        <CheckCircle2 className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                        <span>{t("questionTypes")}</span>
                      </li>
                      <li className="flex items-center text-slate-700">
                        <Clock className="w-5 h-5 text-primary mr-3 flex-shrink-0" />
                        <span>{t("duration")}</span>
                      </li>
                      <li className="flex items-center text-slate-700">
                        <CheckCircle2 className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                        <span>{t("autoSave")}</span>
                      </li>
                    </ul>
                  </div>

                  <Button
                    onClick={startAssessment}
                    size="lg"
                    disabled={loading}
                    className="bg-primary hover:bg-primary/90 text-white px-8 py-6 text-lg rounded-xl"
                  >
                    {loading ? t("startingButton") : t("startButton")}
                  </Button>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (state.status === "in_progress") {
    const question = state.questions[state.currentQuestionIndex]
    const progress = ((state.currentQuestionIndex + 1) / state.questions.length) * 100
    const isLastQuestion = state.currentQuestionIndex === state.questions.length - 1
    const isMCQ = question.question_type === "MCQ"
    // Count answered questions correctly (avoid double-counting when revisiting)
    const currentQuestionAlreadyAnswered = state.responses.some(
      (r) => r.question_id === question.id
    )
    const answeredCount = state.responses.length + (currentAnswer && !currentQuestionAlreadyAnswered ? 1 : 0)
    const canSubmit = answeredCount === state.questions.length

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-primary/10">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-4 max-w-3xl">
          <div className="flex items-center justify-between mb-4 text-sm text-slate-600">
            <span className="font-medium">
              {t("questionOf", { current: state.currentQuestionIndex + 1, total: state.questions.length })}
            </span>
            <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-slate-200">
              <Clock className="w-4 h-4 text-primary" />
              <span className="font-mono">{formatTime(elapsedTime)}</span>
            </div>
          </div>

          <Progress value={progress} className="h-2 mb-6" />

          <Card className="p-6 bg-white border border-slate-200">
            <div className="mb-2">
              <span className="text-xs font-semibold text-primary bg-primary/10 px-3 py-1 rounded-full">
                {question.theme_name}
              </span>
            </div>

            <h2 className="text-xl font-semibold text-slate-900 mb-6 leading-relaxed">
              {question.question_text}
            </h2>

            {isMCQ && question.options ? (
              <div className="space-y-3">
                {question.options.map((option, index) => {
                  const letter = String.fromCharCode(65 + index)
                  const isSelected = currentAnswer === letter
                  return (
                    <button
                      key={index}
                      onClick={() => handleAnswerSelect(letter)}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span className="font-medium">{option}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <Textarea
                  placeholder={t("typeAnswer")}
                  value={currentAnswer}
                  onChange={(e) => setCurrentAnswer(e.target.value.slice(0, 500))}
                  maxLength={500}
                  className="min-h-[150px] text-base"
                />
                <p className="text-xs text-slate-500 text-right">
                  {t("characters", { count: currentAnswer.length })}
                </p>
              </div>
            )}
          </Card>

          <div className="flex justify-between mt-6">
            <Button
              variant="outline"
              onClick={goToPreviousQuestion}
              disabled={state.currentQuestionIndex === 0}
              className="flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              {t("previousButton")}
            </Button>

            {isLastQuestion ? (
              <Button
                onClick={submitAssessment}
                disabled={!canSubmit || loading}
                className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
              >
                {loading ? t("submittingButton") : t("submitButton")}
                <CheckCircle2 className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={goToNextQuestion}
                disabled={!currentAnswer}
                className="flex items-center gap-2"
              >
                {t("nextButton")}
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2 justify-center">
            {state.questions.map((q, idx) => {
              const hasResponse = state.responses.some((r) => r.question_id === q.id) ||
                (idx === state.currentQuestionIndex && currentAnswer)
              const isCurrent = idx === state.currentQuestionIndex
              return (
                <button
                  key={q.id}
                  onClick={() => jumpToQuestion(idx)}
                  className={`w-8 h-8 rounded-full text-sm font-medium transition-all ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : hasResponse
                        ? "bg-green-100 text-green-700 border border-green-300"
                        : "bg-slate-100 text-slate-500 border border-slate-200"
                  }`}
                >
                  {idx + 1}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  if (state.status === "completed" && state.results) {
    const results = state.results
    const scorePercentage = (results.total_score / results.max_score) * 100

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-primary/10">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <Card className="p-8 bg-white border border-slate-200">
            <div className="text-center">
              <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 bg-gradient-to-br from-amber-100 to-orange-100">
                <Trophy className="w-12 h-12 text-amber-600" />
              </div>
              <h1 className="text-3xl text-slate-900 mb-2">{t("completeTitle")}</h1>

              <div className="my-8">
                <div className="relative w-32 h-32 mx-auto">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      stroke="#e2e8f0"
                      strokeWidth="10"
                      fill="none"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      stroke="url(#scoreGradient)"
                      strokeWidth="10"
                      fill="none"
                      strokeDasharray={`${scorePercentage * 2.83} 283`}
                      strokeLinecap="round"
                    />
                    <defs>
                      <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="hsl(var(--primary))" />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.8" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-medium text-slate-900">{results.total_score}</span>
                    <span className="text-sm text-slate-500">/ {results.max_score}</span>
                  </div>
                </div>
              </div>

              <p className="text-lg text-slate-600 mb-2">{results.message || "Assessment complete!"}</p>

              <div className="bg-primary/10 rounded-xl p-4 mb-6">
                <p className="text-sm text-slate-600 mb-1">{t("placedAt")}</p>
                <p className="text-2xl text-primary">{results.assigned_phase_name || `Phase ${results.assigned_phase_number || (results as any).assigned_phase || '?'}`}</p>
              </div>

              {(results.strengths?.length ?? 0) > 0 && (
                <div className="bg-green-50 rounded-xl p-4 mb-4 text-left">
                  <h3 className="font-semibold text-green-800 mb-2">{t("strengths")}</h3>
                  <ul className="space-y-1">
                    {results.strengths.map((strength, idx) => (
                      <li key={idx} className="text-green-700 text-sm flex items-center">
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        {strength} ({Math.round(results.theme_scores[strength]?.percentage || 0)}%)
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(results.areas_to_develop?.length ?? 0) > 0 && (
                <div className="bg-amber-50 rounded-xl p-4 mb-6 text-left">
                  <h3 className="font-semibold text-amber-800 mb-2">{t("areasToImprove")}</h3>
                  <ul className="space-y-1">
                    {results.areas_to_develop.map((area, idx) => (
                      <li key={idx} className="text-amber-700 text-sm flex items-center">
                        <AlertCircle className="w-4 h-4 mr-2" />
                        {area} ({Math.round(results.theme_scores[area]?.percentage || 0)}%)
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-sm text-slate-500 mb-6">
                {t("timeTaken", {
                  minutes: Math.floor((results.total_time_seconds || elapsedTime) / 60),
                  seconds: (results.total_time_seconds || elapsedTime) % 60
                })}
              </p>

              <Button
                onClick={continueToThemes}
                size="lg"
                className="bg-primary hover:bg-primary/90 text-white px-8 py-6 text-lg rounded-xl"
              >
                {t("continueButton")}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return null
}
