"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { MoreHorizontal, Edit, Trash2, Star, Settings } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const models = [
  {
    id: "1",
    name: "GPT-4 Turbo",
    provider: "OpenAI",
    version: "gpt-4-turbo-preview",
    status: "active",
    isDefault: true,
    temperature: 0.7,
    maxTokens: 2048,
    avgResponseTime: "1.2s",
    successRate: "98.5%",
    costPerRequest: "$0.03",
    totalRequests: 45230,
  },
  {
    id: "2",
    name: "Claude 3 Opus",
    provider: "Anthropic",
    version: "claude-3-opus-20240229",
    status: "active",
    isDefault: false,
    temperature: 0.7,
    maxTokens: 2048,
    avgResponseTime: "1.5s",
    successRate: "97.8%",
    costPerRequest: "$0.04",
    totalRequests: 12450,
  },
  {
    id: "3",
    name: "GPT-3.5 Turbo",
    provider: "OpenAI",
    version: "gpt-3.5-turbo",
    status: "active",
    isDefault: false,
    temperature: 0.7,
    maxTokens: 1024,
    avgResponseTime: "0.8s",
    successRate: "96.2%",
    costPerRequest: "$0.002",
    totalRequests: 89340,
  },
  {
    id: "4",
    name: "Gemini Pro",
    provider: "Google",
    version: "gemini-pro",
    status: "testing",
    isDefault: false,
    temperature: 0.7,
    maxTokens: 2048,
    avgResponseTime: "1.1s",
    successRate: "95.5%",
    costPerRequest: "$0.001",
    totalRequests: 3420,
  },
  {
    id: "5",
    name: "Claude 3 Sonnet",
    provider: "Anthropic",
    version: "claude-3-sonnet-20240229",
    status: "inactive",
    isDefault: false,
    temperature: 0.7,
    maxTokens: 2048,
    avgResponseTime: "1.3s",
    successRate: "97.1%",
    costPerRequest: "$0.015",
    totalRequests: 8920,
  },
]

export function ModelsTable() {
  const [selectedModel, setSelectedModel] = useState<(typeof models)[0] | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)

  return (
    <>
      <Card className="border-card-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-card-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Model</TableHead>
              <TableHead className="text-muted-foreground">Provider</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Performance</TableHead>
              <TableHead className="text-muted-foreground">Cost</TableHead>
              <TableHead className="text-muted-foreground">Requests</TableHead>
              <TableHead className="text-muted-foreground">Config</TableHead>
              <TableHead className="text-right text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow key={model.id} className="border-card-border">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-card-foreground">{model.name}</p>
                        {model.isDefault && <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />}
                      </div>
                      <p className="text-sm text-muted-foreground">{model.version}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-card-foreground">{model.provider}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      model.status === "active" ? "default" : model.status === "testing" ? "secondary" : "outline"
                    }
                  >
                    {model.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <p className="text-sm text-card-foreground">{model.avgResponseTime}</p>
                    <p className="text-xs text-muted-foreground">{model.successRate} success</p>
                  </div>
                </TableCell>
                <TableCell className="text-card-foreground">{model.costPerRequest}</TableCell>
                <TableCell className="text-card-foreground">{model.totalRequests.toLocaleString()}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <p className="text-sm text-card-foreground">Temp: {model.temperature}</p>
                    <p className="text-xs text-muted-foreground">Max: {model.maxTokens}</p>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedModel(model)
                          setIsEditOpen(true)
                        }}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Configuration
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Settings className="mr-2 h-4 w-4" />
                        Set as Default
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove Model
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Model Configuration</DialogTitle>
            <DialogDescription>Adjust the parameters for {selectedModel?.name}</DialogDescription>
          </DialogHeader>
          {selectedModel && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Model Name</Label>
                  <Input defaultValue={selectedModel.name} />
                </div>
                <div className="space-y-2">
                  <Label>Version</Label>
                  <Input defaultValue={selectedModel.version} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Temperature</Label>
                  <Input type="number" step="0.1" defaultValue={selectedModel.temperature} />
                  <p className="text-xs text-muted-foreground">Controls randomness (0-2)</p>
                </div>
                <div className="space-y-2">
                  <Label>Max Tokens</Label>
                  <Input type="number" defaultValue={selectedModel.maxTokens} />
                  <p className="text-xs text-muted-foreground">Maximum response length</p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4">
                <div>
                  <p className="font-medium text-card-foreground">Set as Default Model</p>
                  <p className="text-sm text-muted-foreground">Use this model for all new conversations</p>
                </div>
                <Switch defaultChecked={selectedModel.isDefault} />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-card-border bg-card p-4">
                <div>
                  <p className="font-medium text-card-foreground">Enable Model</p>
                  <p className="text-sm text-muted-foreground">Make this model available for use</p>
                </div>
                <Switch defaultChecked={selectedModel.status === "active"} />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsEditOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setIsEditOpen(false)}>Save Changes</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
