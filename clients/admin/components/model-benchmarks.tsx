"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Play } from "lucide-react"

const benchmarks = [
  {
    id: "1",
    name: "Algebra Problem Solving",
    description: "20 algebra questions from basic to advanced",
    models: [
      { name: "GPT-4 Turbo", score: 95, avgTime: "1.2s", cost: "$0.60" },
      { name: "Claude 3 Opus", score: 92, avgTime: "1.5s", cost: "$0.80" },
      { name: "GPT-3.5 Turbo", score: 88, avgTime: "0.8s", cost: "$0.04" },
      { name: "Gemini Pro", score: 85, avgTime: "1.1s", cost: "$0.02" },
    ],
  },
  {
    id: "2",
    name: "Reading Comprehension",
    description: "15 passages with comprehension questions",
    models: [
      { name: "GPT-4 Turbo", score: 93, avgTime: "1.5s", cost: "$0.45" },
      { name: "Claude 3 Opus", score: 96, avgTime: "1.8s", cost: "$0.60" },
      { name: "GPT-3.5 Turbo", score: 87, avgTime: "1.0s", cost: "$0.03" },
      { name: "Gemini Pro", score: 89, avgTime: "1.3s", cost: "$0.015" },
    ],
  },
  {
    id: "3",
    name: "Pedagogical Approach",
    description: "Evaluation of teaching style and student engagement",
    models: [
      { name: "GPT-4 Turbo", score: 91, avgTime: "1.4s", cost: "$0.70" },
      { name: "Claude 3 Opus", score: 94, avgTime: "1.6s", cost: "$0.90" },
      { name: "GPT-3.5 Turbo", score: 82, avgTime: "0.9s", cost: "$0.05" },
      { name: "Gemini Pro", score: 86, avgTime: "1.2s", cost: "$0.025" },
    ],
  },
]

export function ModelBenchmarks() {
  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Benchmark Tests</h2>
        <Button variant="outline" size="sm">
          <Play className="mr-2 h-4 w-4" />
          Run All Benchmarks
        </Button>
      </div>

      <div className="space-y-4">
        {benchmarks.map((benchmark) => (
          <Card key={benchmark.id} className="border-card-border bg-card p-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-card-foreground">{benchmark.name}</h3>
              <p className="text-sm text-muted-foreground">{benchmark.description}</p>
            </div>

            <div className="space-y-3">
              {benchmark.models.map((model, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-card-foreground">{model.name}</span>
                      <Badge variant="secondary">{model.score}%</Badge>
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span>{model.avgTime}</span>
                      <span>{model.cost}</span>
                    </div>
                  </div>
                  <Progress value={model.score} className="h-2" />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
