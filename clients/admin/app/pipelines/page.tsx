"use client"

import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"
import { PipelineCanvas } from "@/components/pipeline-canvas"
import { PipelineToolbar } from "@/components/pipeline-toolbar"
import { PipelineNodePanel } from "@/components/pipeline-node-panel"
import { Button } from "@/components/ui/button"
import { Save, Play, Download, Upload } from "lucide-react"
import { useState } from "react"

export default function PipelinesPage() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex flex-1 flex-col overflow-hidden bg-background">
          <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">Agentic Pipeline Builder</h1>
              <p className="text-sm text-muted-foreground">Design and configure AI agent workflows</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
              <Button variant="outline" size="sm">
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
              <Button size="sm">
                <Play className="mr-2 h-4 w-4" />
                Run Pipeline
              </Button>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <PipelineToolbar />
            <div className="flex-1">
              <PipelineCanvas onNodeSelect={setSelectedNode} />
            </div>
            <PipelineNodePanel selectedNodeId={selectedNode} />
          </div>
        </main>
      </div>
    </div>
  )
}
