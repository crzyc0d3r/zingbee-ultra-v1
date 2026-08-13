"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardFooter } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/shared/ui/radio-group"
import { Label } from "@/components/shared/ui/label"
import { Progress } from "@/components/shared/ui/progress"
import { Alert, AlertDescription } from "@/components/shared/ui/alert"
import { ChevronLeft, ChevronRight, Trophy, RefreshCw, AlertCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import type { CapsuleQuestion, QuestionAnswer, SubmitCheckResponse } from "@/lib/api-client"
import { apiClient } from "@/lib/api-client"

interface CapsuleQuizProps {
  studentId: string
  capsuleId: string
  questions: CapsuleQuestion[]
  onComplete: (result: SubmitCheckResponse) => void
  onCancel: () => void
  subjectTheme: {
    color: string
    buttonColor: string
    accentColor: string
  }
}

export function CapsuleQuiz({
  studentId,
  capsuleId,
  questions,
  onComplete,
  onCancel,
  subjectTheme,
}: CapsuleQuizProps) {
  const t = useTranslations("common")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitCheckResponse | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const currentQuestion = questions[currentIndex]
  const progress = ((currentIndex + 1) / questions.length) * 100
  const answeredCount = Object.keys(answers).length
  const allAnswered = answeredCount === questions.length

  const handleAnswer = (questionId: string, answer: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }))
  }

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1)
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1)
    }
  }

  const handleSubmit = async () => {
    if (!allAnswered) return

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const formattedAnswers: QuestionAnswer[] = Object.entries(answers).map(([questionId, answer]) => ({
        question_id: questionId,
        answer,
      }))

      const response = await apiClient.studentCapsules.submitCheck(studentId, capsuleId, formattedAnswers)
      setResult(response)
      onComplete(response)
    } catch (error) {
      console.error("Failed to submit quiz:", error)
      setSubmitError(t("assessment.failedToSubmit"))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRetry = () => {
    setAnswers({})
    setCurrentIndex(0)
    setResult(null)
    setSubmitError(null)
  }

  if (result) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4">
            {result.passed ? (
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <Trophy className="w-8 h-8 text-green-600" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-yellow-600" />
              </div>
            )}
          </div>
          <h2 className="text-2xl font-medium">
            {result.passed ? t("learning.quizPassed") : t("learning.quizTryAgain")}
          </h2>
          <p className="text-gray-600 mt-2">{result.feedback}</p>
        </CardHeader>
        <CardContent className="text-center">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-medium text-gray-900">{Math.round(result.score * 100)}%</p>
              <p className="text-sm text-gray-500">{t("learning.score")}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-medium text-gray-900">
                {result.questions_correct}/{result.total_questions}
              </p>
              <p className="text-sm text-gray-500">{t("learning.correct")}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-medium text-gray-900">{result.credit_earned.toFixed(2)}</p>
              <p className="text-sm text-gray-500">{t("learning.credits")}</p>
            </div>
          </div>

          {result.weak_concepts.length > 0 && (
            <Alert className="text-left mb-4">
              <AlertDescription>
                <p className="font-medium mb-2">{t("learning.reviewConcepts")}:</p>
                <ul className="list-disc list-inside text-sm">
                  {result.weak_concepts.map((concept, index) => (
                    <li key={index}>{concept}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="flex justify-center gap-3">
          {!result.passed && (
            <Button variant="outline" onClick={handleRetry}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t("learning.tryAgain")}
            </Button>
          )}
          <Button onClick={onCancel} className={subjectTheme.buttonColor}>
            {result.passed ? t("learning.continue") : t("learning.reviewLater")}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-gray-500">
            {t("learning.question")} {currentIndex + 1} / {questions.length}
          </span>
          <span className="text-sm text-gray-500">
            {answeredCount} {t("learning.answered")}
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </CardHeader>

      <CardContent className="min-h-[300px]">
        {currentQuestion && (
          <div className="space-y-6">
            <div>
              <span className={`inline-block px-2 py-1 text-xs rounded-full mb-3 ${
                currentQuestion.difficulty === 1 ? "bg-green-100 text-green-700" :
                currentQuestion.difficulty === 2 ? "bg-yellow-100 text-yellow-700" :
                "bg-red-100 text-red-700"
              }`}>
                {currentQuestion.difficulty === 1 ? t("learning.easy") :
                 currentQuestion.difficulty === 2 ? t("learning.medium") :
                 t("learning.hard")}
              </span>
              <h3 className="text-lg font-medium text-gray-900">{currentQuestion.question_text}</h3>
            </div>

            {currentQuestion.question_type === "mcq" && currentQuestion.options && (
              <RadioGroup
                value={answers[currentQuestion.id] || ""}
                onValueChange={(value) => handleAnswer(currentQuestion.id, value)}
                className="space-y-3"
              >
                {currentQuestion.options.map((option, index) => {
                  const optionLetter = String.fromCharCode(65 + index)
                  return (
                    <div
                      key={index}
                      className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${
                        answers[currentQuestion.id] === optionLetter
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <RadioGroupItem value={optionLetter} id={`option-${index}`} />
                      <Label htmlFor={`option-${index}`} className="flex-1 cursor-pointer">
                        {option}
                      </Label>
                    </div>
                  )
                })}
              </RadioGroup>
            )}

            {currentQuestion.question_type === "true_false" && (
              <RadioGroup
                value={answers[currentQuestion.id] || ""}
                onValueChange={(value) => handleAnswer(currentQuestion.id, value)}
                className="space-y-3"
              >
                {["TRUE", "FALSE"].map((option) => (
                  <div
                    key={option}
                    className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${
                      answers[currentQuestion.id] === option
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <RadioGroupItem value={option} id={`option-${option}`} />
                    <Label htmlFor={`option-${option}`} className="flex-1 cursor-pointer">
                      {option === "TRUE" ? t("learning.true") : t("learning.false")}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}

            {currentQuestion.question_type === "short_answer" && (
              <Input
                value={answers[currentQuestion.id] || ""}
                onChange={(e) => handleAnswer(currentQuestion.id, e.target.value)}
                placeholder={t("learning.enterAnswer")}
                className="w-full"
              />
            )}
          </div>
        )}
      </CardContent>

      {submitError && (
        <div className="px-6 pb-2">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        </div>
      )}

      <CardFooter className="flex justify-between">
        <Button
          variant="outline"
          onClick={handlePrev}
          disabled={currentIndex === 0}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          {t("learning.previous")}
        </Button>

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("learning.cancel")}
          </Button>

          {currentIndex === questions.length - 1 ? (
            <Button
              onClick={handleSubmit}
              disabled={!allAnswered || isSubmitting}
              className={subjectTheme.buttonColor}
            >
              {isSubmitting ? t("learning.submitting") : t("learning.submit")}
            </Button>
          ) : (
            <Button onClick={handleNext} className={subjectTheme.buttonColor}>
              {t("learning.next")}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}
