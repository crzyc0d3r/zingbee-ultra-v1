"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Play, Clock, DollarSign } from "lucide-react"

const models = [
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "OpenAI" },
  { id: "claude-3-opus", name: "Claude 3 Opus", provider: "Anthropic" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", provider: "OpenAI" },
  { id: "gemini-pro", name: "Gemini Pro", provider: "Google" },
]

export function ModelTestingInterface() {
  const [prompt, setPrompt] = useState("")
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [results, setResults] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const handleTest = () => {
    setIsLoading(true)
    // Simulate API call
    setTimeout(() => {
      setResults([
        {
          modelId: "gpt-4-turbo",
          response:
            "To solve this algebra problem, let's break it down step by step. First, we need to isolate the variable x. We can start by adding 5 to both sides of the equation...",
          responseTime: "1.2s",
          cost: "$0.03",
          quality: 95,
        },
        {
          modelId: "claude-3-opus",
          response:
            "Great question! Let's work through this algebra problem together. I'll guide you through the process so you can understand each step. First, what do you think we should do to get x by itself?",
          responseTime: "1.5s",
          cost: "$0.04",
          quality: 92,
        },
        {
          modelId: "gpt-3.5-turbo",
          response:
            "To solve for x, add 5 to both sides: 2x - 5 + 5 = 15 + 5, which gives us 2x = 20. Then divide both sides by 2: x = 10.",
          responseTime: "0.8s",
          cost: "$0.002",
          quality: 88,
        },
      ])
      setIsLoading(false)
    }, 2000)
  }

  return (
    <div className="mb-6 space-y-4">
      <Card className="border-card-border bg-card p-6">
        <h2 className="mb-4 text-xl font-semibold text-card-foreground">Side-by-Side Model Comparison</h2>

        <div className="mb-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-card-foreground">Test Prompt</label>
            <Textarea
              placeholder="Enter a student question or scenario to test..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-card-foreground">Select Models to Test</label>
            <div className="flex flex-wrap gap-2">
              {models.map((model) => (
                <Button
                  key={model.id}
                  variant={selectedModels.includes(model.id) ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectedModels((prev) =>
                      prev.includes(model.id) ? prev.filter((id) => id !== model.id) : [...prev, model.id],
                    )
                  }}
                >
                  {model.name}
                </Button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleTest}
            disabled={!prompt || selectedModels.length === 0 || isLoading}
            className="w-full"
          >
            <Play className="mr-2 h-4 w-4" />
            {isLoading ? "Testing Models..." : "Run Test"}
          </Button>
        </div>

        {results.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {results.map((result) => {
              const model = models.find((m) => m.id === result.modelId)
              return (
                <Card key={result.modelId} className="border-card-border bg-background p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{model?.name}</h3>
                      <p className="text-xs text-muted-foreground">{model?.provider}</p>
                    </div>
                    <Badge variant="secondary">{result.quality}% quality</Badge>
                  </div>

                  <div className="mb-3 space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>{result.responseTime}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="h-4 w-4" />
                      <span>{result.cost}</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-card-border bg-card p-3">
                    <p className="text-sm text-card-foreground">{result.response}</p>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
