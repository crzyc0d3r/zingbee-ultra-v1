"use client"

import { Handle, Position, type NodeProps } from "reactflow"
import { Card } from "@/components/ui/card"
import { Database } from "lucide-react"

export function DatabaseNode({ data, selected }: NodeProps) {
  return (
    <Card
      className={`min-w-[200px] border-2 bg-card transition-colors ${
        selected ? "border-primary" : "border-card-border"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary" />
      <div className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded bg-cyan-500/10 p-1.5">
            <Database className="h-4 w-4 text-cyan-500" />
          </div>
          <span className="font-semibold text-card-foreground">{data.label}</span>
        </div>
        <p className="text-xs text-muted-foreground">Query database</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary" />
    </Card>
  )
}
