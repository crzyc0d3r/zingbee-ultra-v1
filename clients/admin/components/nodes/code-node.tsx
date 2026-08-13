"use client"

import { Handle, Position, type NodeProps } from "reactflow"
import { Card } from "@/components/ui/card"
import { Code } from "lucide-react"

export function CodeNode({ data, selected }: NodeProps) {
  return (
    <Card
      className={`min-w-[200px] border-2 bg-card transition-colors ${
        selected ? "border-primary" : "border-card-border"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary" />
      <div className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded bg-orange-500/10 p-1.5">
            <Code className="h-4 w-4 text-orange-500" />
          </div>
          <span className="font-semibold text-card-foreground">{data.label}</span>
        </div>
        <p className="text-xs text-muted-foreground">Custom code execution</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary" />
    </Card>
  )
}
