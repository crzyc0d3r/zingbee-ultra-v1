"use client"

import type React from "react"

import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageSquare, Cpu, GitBranch, Code, Database, Webhook, FileText, Zap } from "lucide-react"

const nodeTypes = [
  {
    category: "AI Models",
    nodes: [
      { id: "llm", label: "LLM Node", icon: Cpu, color: "bg-purple-500/10 text-purple-500" },
      {
        id: "prompt",
        label: "Prompt Template",
        icon: MessageSquare,
        color: "bg-blue-500/10 text-blue-500",
      },
    ],
  },
  {
    category: "Logic",
    nodes: [
      {
        id: "condition",
        label: "Conditional",
        icon: GitBranch,
        color: "bg-green-500/10 text-green-500",
      },
      { id: "code", label: "Code Block", icon: Code, color: "bg-orange-500/10 text-orange-500" },
    ],
  },
  {
    category: "Data",
    nodes: [
      {
        id: "database",
        label: "Database Query",
        icon: Database,
        color: "bg-cyan-500/10 text-cyan-500",
      },
      { id: "api", label: "API Call", icon: Webhook, color: "bg-pink-500/10 text-pink-500" },
    ],
  },
  {
    category: "Output",
    nodes: [
      {
        id: "response",
        label: "Response",
        icon: FileText,
        color: "bg-yellow-500/10 text-yellow-500",
      },
      { id: "action", label: "Action", icon: Zap, color: "bg-red-500/10 text-red-500" },
    ],
  },
]

export function PipelineToolbar() {
  const onDragStart = (event: React.DragEvent, nodeType: string, label: string) => {
    event.dataTransfer.setData("nodeType", nodeType)
    event.dataTransfer.setData("label", label)
    event.dataTransfer.effectAllowed = "move"
  }

  return (
    <Card className="w-64 rounded-none border-b-0 border-l-0 border-t-0 border-card-border bg-card">
      <div className="border-b border-card-border p-4">
        <h2 className="font-semibold text-card-foreground">Node Library</h2>
        <p className="text-xs text-muted-foreground">Drag nodes to canvas</p>
      </div>
      <ScrollArea className="h-[calc(100vh-12rem)]">
        <div className="space-y-4 p-4">
          {nodeTypes.map((category) => (
            <div key={category.category}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category.category}
              </h3>
              <div className="space-y-2">
                {category.nodes.map((node) => (
                  <div
                    key={node.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, node.id, node.label)}
                    className="flex cursor-move items-center gap-3 rounded-lg border border-card-border bg-background p-3 transition-colors hover:border-primary hover:bg-accent"
                  >
                    <div className={`rounded p-1.5 ${node.color}`}>
                      <node.icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium text-foreground">{node.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  )
}
