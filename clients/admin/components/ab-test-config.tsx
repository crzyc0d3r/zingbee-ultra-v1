"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Play, Pause } from "lucide-react"

const abTests = [
  {
    id: "1",
    name: "GPT-4 vs Claude 3 Opus",
    status: "active",
    modelA: "GPT-4 Turbo",
    modelB: "Claude 3 Opus",
    split: "50/50",
    students: 245,
    duration: "14 days",
    metrics: {
      avgEngagement: { a: "8.5 min", b: "9.2 min" },
      completionRate: { a: "87%", b: "91%" },
      satisfaction: { a: "4.2/5", b: "4.5/5" },
    },
  },
  {
    id: "2",
    name: "Cost Optimization Test",
    status: "scheduled",
    modelA: "GPT-4 Turbo",
    modelB: "GPT-3.5 Turbo",
    split: "30/70",
    students: 0,
    duration: "7 days",
    metrics: null,
  },
]

export function ABTestConfig() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">A/B Tests</h2>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Create A/B Test
        </Button>
      </div>

      <div className="space-y-4">
        {abTests.map((test) => (
          <Card key={test.id} className="border-card-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-card-foreground">{test.name}</h3>
                  <Badge variant={test.status === "active" ? "default" : "secondary"}>{test.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {test.students} students • {test.duration} • {test.split} split
                </p>
              </div>
              <div className="flex gap-2">
                {test.status === "active" ? (
                  <Button variant="outline" size="sm">
                    <Pause className="mr-2 h-4 w-4" />
                    Pause
                  </Button>
                ) : (
                  <Button size="sm">
                    <Play className="mr-2 h-4 w-4" />
                    Start
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-card-border bg-background p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-medium text-foreground">Model A: {test.modelA}</h4>
                  <Badge variant="outline">{test.split.split("/")[0]}%</Badge>
                </div>
                {test.metrics && (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Engagement:</span>
                      <span className="text-foreground">{test.metrics.avgEngagement.a}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Completion Rate:</span>
                      <span className="text-foreground">{test.metrics.completionRate.a}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Satisfaction:</span>
                      <span className="text-foreground">{test.metrics.satisfaction.a}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-card-border bg-background p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-medium text-foreground">Model B: {test.modelB}</h4>
                  <Badge variant="outline">{test.split.split("/")[1]}%</Badge>
                </div>
                {test.metrics && (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Engagement:</span>
                      <span className="text-foreground">{test.metrics.avgEngagement.b}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Completion Rate:</span>
                      <span className="text-foreground">{test.metrics.completionRate.b}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Satisfaction:</span>
                      <span className="text-foreground">{test.metrics.satisfaction.b}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
