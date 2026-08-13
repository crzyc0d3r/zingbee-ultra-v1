"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { Progress } from "@/components/shared/ui/progress"

interface Question {
  id: string
  question: string
  type: "multiple-choice" | "text-input"
  options?: string[]
  correctAnswer: string
}

export function PracticeInterface() {
  const router = useRouter()
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<string>("")
  const [textAnswer, setTextAnswer] = useState<string>("")
  const [showFeedback, setShowFeedback] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const [score, setScore] = useState(0)
  const [tutorName, setTutorName] = useState("Your Tutor")

  const questions: Question[] = [
    {
      id: "q1",
      question: "What is 5 + 3?",
      type: "multiple-choice",
      options: ["6", "7", "8", "9"],
      correctAnswer: "8",
    },
    {
      id: "q2",
      question: "What is 10 - 4?",
      type: "multiple-choice",
      options: ["4", "5", "6", "7"],
      correctAnswer: "6",
    },
    {
      id: "q3",
      question: "What is 2 + 2?",
      type: "text-input",
      correctAnswer: "4",
    },
  ]

  useEffect(() => {
    const selectedTutor = localStorage.getItem("selectedTutor")
    if (selectedTutor) {
      const tutorNames: Record<string, string> = {
        "professor-spark": "Professor Spark",
        "captain-word": "Captain Word",
        "explorer-nova": "Explorer Nova",
        "maestro-melody": "Maestro Melody",
      }
      setTutorName(tutorNames[selectedTutor] || "Your Tutor")
    }
  }, [])

  const handleSubmit = () => {
    const question = questions[currentQuestion]
    const answer = question.type === "multiple-choice" ? selectedAnswer : textAnswer
    const correct = answer === question.correctAnswer

    setIsCorrect(correct)
    setShowFeedback(true)

    if (correct) {
      setScore(score + 10)
    }
  }

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1)
      setSelectedAnswer("")
      setTextAnswer("")
      setShowFeedback(false)
    } else {
      // Update user stats
      const userData = localStorage.getItem("user")
      if (userData) {
        const user = JSON.parse(userData)
        user.credits += score
        localStorage.setItem("user", JSON.stringify(user))
      }

      const stats = JSON.parse(
        localStorage.getItem("stats") || '{"lessonsCompleted":0,"currentStreak":0,"totalTime":0}',
      )
      stats.lessonsCompleted += 1
      stats.totalTime += 15
      localStorage.setItem("stats", JSON.stringify(stats))

      router.push("/tutors/achievements")
    }
  }

  const progress = ((currentQuestion + 1) / questions.length) * 100
  const question = questions[currentQuestion]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between mb-2">
          <CardTitle className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            {tutorName}
          </CardTitle>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="font-semibold">{score}</span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Question {currentQuestion + 1} of {questions.length}
            </span>
            <span>{Math.round(progress)}% Complete</span>
          </div>
          <Progress value={progress} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-primary/5 p-6 rounded-lg border-2 border-primary/20">
          <p className="text-lg font-medium text-balance">{question.question}</p>
        </div>

        {!showFeedback ? (
          <div className="space-y-4">
            {question.type === "multiple-choice" && question.options ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {question.options.map((option) => (
                  <Button
                    key={option}
                    variant={selectedAnswer === option ? "default" : "outline"}
                    className="h-auto py-4 text-lg"
                    onClick={() => setSelectedAnswer(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            ) : (
              <Input
                type="text"
                placeholder="Type your answer here"
                value={textAnswer}
                onChange={(e) => setTextAnswer(e.target.value)}
                className="text-lg py-6"
              />
            )}
            <Button
              onClick={handleSubmit}
              className="w-full"
              size="lg"
              disabled={question.type === "multiple-choice" ? !selectedAnswer : !textAnswer}
            >
              Submit Answer
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className={`p-6 rounded-lg border-2 ${
                isCorrect
                  ? "bg-slate-50 border-slate-300 text-slate-800"
                  : "bg-destructive/10 border-destructive/50 text-destructive"
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                {isCorrect ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 001.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <p className="font-semibold text-lg">{isCorrect ? "Correct! Great job!" : "Not quite right"}</p>
              </div>
              <p className="text-sm">
                {isCorrect
                  ? "You earned 10 credits! Keep up the excellent work!"
                  : `The correct answer is ${question.correctAnswer}. Let's try the next one!`}
              </p>
            </div>
            <Button onClick={handleNext} className="w-full" size="lg">
              {currentQuestion < questions.length - 1 ? "Next Question" : "See Results"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
