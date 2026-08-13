"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Plus } from "lucide-react"

export function CreateModelButton() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Model
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add New AI Model</DialogTitle>
          <DialogDescription>Configure a new AI model for Academy</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Model Name</Label>
              <Input placeholder="e.g., GPT-4 Turbo" />
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="meta">Meta</SelectItem>
                  <SelectItem value="mistral">Mistral</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Model Version / ID</Label>
            <Input placeholder="e.g., gpt-4-turbo-preview" />
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <Input type="password" placeholder="Enter API key" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Temperature</Label>
              <Input type="number" step="0.1" defaultValue="0.7" />
              <p className="text-xs text-muted-foreground">Controls randomness (0-2)</p>
            </div>
            <div className="space-y-2">
              <Label>Max Tokens</Label>
              <Input type="number" defaultValue="2048" />
              <p className="text-xs text-muted-foreground">Maximum response length</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4">
            <div>
              <p className="font-medium text-card-foreground">Enable Immediately</p>
              <p className="text-sm text-muted-foreground">Make this model available for use</p>
            </div>
            <Switch defaultChecked />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Add Model</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
