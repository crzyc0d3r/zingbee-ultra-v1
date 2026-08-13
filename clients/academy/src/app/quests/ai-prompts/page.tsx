"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { DashboardHeader } from "@/components/quests/dashboard-header"
import { Lightbulb, Target, Brain, BookOpen, MessageSquare, Zap, Send, Sparkles } from "lucide-react"

const promptTips = [
  {
    title: "Be Specific",
    description: "Instead of asking vague questions, be clear about what you want to know",
    icon: Target,
    example: "Good: 'How do plants make food through photosynthesis?' vs Bad: 'Tell me about plants'",
    color: "blue",
  },
  {
    title: "Ask for Examples",
    description: "Request real-world examples to understand concepts better",
    icon: Lightbulb,
    example: "Can you give me 3 examples of renewable energy sources and explain how each works?",
    color: "yellow",
  },
  {
    title: "Break It Down",
    description: "Ask complex topics to be explained step-by-step",
    icon: Brain,
    example: "Can you break down the water cycle into simple steps?",
    color: "purple",
  },
  {
    title: "Request Different Formats",
    description: "Ask for information in lists, stories, or comparisons",
    icon: BookOpen,
    example: "Can you explain the solar system as a story? or Make a list of the planets with their key features",
    color: "slate",
  },
  {
    title: "Use Context",
    description: "Mention your grade level or what you already know",
    icon: MessageSquare,
    example: "I'm in Year 6 and learning about fractions. Can you explain equivalent fractions?",
    color: "slate",
  },
  {
    title: "Ask Follow-ups",
    description: "Don't hesitate to ask 'why' or 'how' for deeper understanding",
    icon: Zap,
    example: "Why does that happen? or Can you explain that part again in a different way?",
    color: "orange",
  },
]

export default function AIPromptsPage() {
  const [practicePrompt, setPracticePrompt] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)

  const handlePractice = () => {
    if (!practicePrompt.trim()) return

    // Simple feedback logic
    const isSpecific = practicePrompt.length > 20
    const hasQuestion = practicePrompt.includes("?")
    const hasContext = practicePrompt.toLowerCase().includes("explain") || practicePrompt.toLowerCase().includes("how")

    if (isSpecific && hasQuestion && hasContext) {
      setFeedback("Great prompt! It's specific, asks a clear question, and provides context. Well done!")
    } else if (isSpecific && hasQuestion) {
      setFeedback("Good start! Try adding more context about what you already know or your grade level.")
    } else if (hasQuestion) {
      setFeedback("You're asking a question, which is good! Try being more specific about what you want to learn.")
    } else {
      setFeedback("Try turning this into a clear question. What exactly do you want to know?")
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-slate-50 to-purple-50">
      <DashboardHeader />

      <div className="container mx-auto p-6 max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <div className="bg-gradient-to-r from-blue-500 to-purple-500 rounded-2xl p-8 text-white">
            <div className="flex items-center gap-3 mb-3">
              <Lightbulb className="w-10 h-10" />
              <h1 className="text-3xl font-medium">AI Prompt Writing Guide</h1>
            </div>
            <p className="text-lg opacity-90">
              Learn how to write effective prompts to get the best answers from AI assistants
            </p>
          </div>
        </div>

        {/* Tips Grid */}
        <div className="mb-8">
          <h2 className="text-2xl font-medium text-slate-900 mb-4">6 Tips for Better Prompts</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {promptTips.map((tip, index) => {
              const Icon = tip.icon
              return (
                <Card key={index} className="border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-full bg-${tip.color}-100 flex items-center justify-center`}>
                        <Icon className={`w-5 h-5 text-${tip.color}-600`} />
                      </div>
                      <h3 className="text-lg font-medium text-slate-900 flex-1">{tip.title}</h3>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">{tip.description}</p>
                    <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-900 italic border border-blue-200">
                      {tip.example}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>

        {/* Practice Section */}
        <Card className="border border-slate-200 bg-white">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="w-6 h-6 text-purple-600" />
              <h2 className="text-2xl font-medium text-slate-900">Practice Writing Prompts</h2>
            </div>
            <p className="text-slate-600 mb-4">
              Try writing a prompt below and get instant feedback on how to improve it!
            </p>

            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={practicePrompt}
                  onChange={(e) => setPracticePrompt(e.target.value)}
                  placeholder="Write your practice prompt here..."
                  className="flex-1"
                />
                <Button
                  onClick={handlePractice}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Get Feedback
                </Button>
              </div>

              {feedback && (
                <Card className="border border-slate-200 bg-white">
                  <CardContent className="p-4">
                    <p className="text-sm text-slate-900">{feedback}</p>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="mt-6 pt-6 border-t border-purple-200">
              <h3 className="font-medium text-slate-900 mb-3">Example Prompts to Try:</h3>
              <div className="space-y-2">
                {[
                  "Can you explain how volcanoes form in simple terms for a Year 5 student?",
                  "I'm learning about World War 2. Can you give me 5 key events with dates?",
                  "Help me understand fractions by using pizza slices as an example",
                ].map((example, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    className="w-full justify-start text-left h-auto py-3 px-4 bg-transparent"
                    onClick={() => setPracticePrompt(example)}
                  >
                    <span className="text-sm text-slate-700">{example}</span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
