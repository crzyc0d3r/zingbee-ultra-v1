"use client"

import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"

interface PipelineNodePanelProps {
  selectedNodeId: string | null
}

export function PipelineNodePanel({ selectedNodeId }: PipelineNodePanelProps) {
  if (!selectedNodeId) {
    return (
      <Card className="w-80 rounded-none border-b-0 border-r-0 border-t-0 border-card-border bg-card">
        <div className="flex h-full items-center justify-center p-6 text-center">
          <p className="text-sm text-muted-foreground">Select a node to configure its properties</p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="w-80 rounded-none border-b-0 border-r-0 border-t-0 border-card-border bg-card">
      <div className="flex items-center justify-between border-b border-card-border p-4">
        <h2 className="font-semibold text-card-foreground">Node Configuration</h2>
        <Button variant="ghost" size="icon">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="h-[calc(100vh-12rem)]">
        <div className="space-y-6 p-4">
          {/* Model Selection */}
          <div className="space-y-2">
            <Label>AI Model</Label>
            <Select defaultValue="gpt-4">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4">GPT-4</SelectItem>
                <SelectItem value="gpt-3.5">GPT-3.5 Turbo</SelectItem>
                <SelectItem value="claude-3">Claude 3 Opus</SelectItem>
                <SelectItem value="gemini">Gemini Pro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Prompt Template */}
          <div className="space-y-2">
            <Label>Prompt Template</Label>
            <Textarea
              placeholder="Enter your prompt template..."
              className="min-h-[120px] font-mono text-sm"
              defaultValue="You are a helpful AI tutor. Help the student understand {{topic}}."
            />
            <p className="text-xs text-muted-foreground">Use {"{{variable}}"} for dynamic values</p>
          </div>

          {/* Temperature */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="text-sm text-muted-foreground">0.7</span>
            </div>
            <Slider defaultValue={[0.7]} max={2} step={0.1} />
            <p className="text-xs text-muted-foreground">Controls randomness in responses</p>
          </div>

          {/* Max Tokens */}
          <div className="space-y-2">
            <Label>Max Tokens</Label>
            <Input type="number" defaultValue="2048" />
          </div>

          {/* Top P */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Top P</Label>
              <span className="text-sm text-muted-foreground">0.9</span>
            </div>
            <Slider defaultValue={[0.9]} max={1} step={0.05} />
          </div>

          {/* Frequency Penalty */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Frequency Penalty</Label>
              <span className="text-sm text-muted-foreground">0.0</span>
            </div>
            <Slider defaultValue={[0]} min={-2} max={2} step={0.1} />
          </div>

          {/* Presence Penalty */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Presence Penalty</Label>
              <span className="text-sm text-muted-foreground">0.0</span>
            </div>
            <Slider defaultValue={[0]} min={-2} max={2} step={0.1} />
          </div>

          {/* System Message */}
          <div className="space-y-2">
            <Label>System Message</Label>
            <Textarea placeholder="Optional system message..." className="min-h-[80px] font-mono text-sm" />
          </div>

          {/* Enable Streaming */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Streaming</Label>
              <p className="text-xs text-muted-foreground">Stream responses in real-time</p>
            </div>
            <Switch defaultChecked />
          </div>

          {/* Enable Caching */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Caching</Label>
              <p className="text-xs text-muted-foreground">Cache responses for efficiency</p>
            </div>
            <Switch />
          </div>

          {/* Retry Logic */}
          <div className="space-y-2">
            <Label>Max Retries</Label>
            <Input type="number" defaultValue="3" />
          </div>

          {/* Timeout */}
          <div className="space-y-2">
            <Label>Timeout (seconds)</Label>
            <Input type="number" defaultValue="30" />
          </div>

          <Button className="w-full">Apply Changes</Button>
        </div>
      </ScrollArea>
    </Card>
  )
}
