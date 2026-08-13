"use client"

import type React from "react"

import { useCallback, useRef, useState, useEffect } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Node {
  id: string
  type: string
  label: string
  position: { x: number; y: number }
  data: any
}

interface Connection {
  id: string
  source: string
  target: string
}

interface PipelineCanvasProps {
  onNodeSelect: (nodeId: string | null) => void
}

export function PipelineCanvas({ onNodeSelect }: PipelineCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<Node[]>([
    {
      id: "1",
      type: "prompt",
      label: "Prompt Template",
      position: { x: 250, y: 100 },
      data: {},
    },
  ])
  const [connections, setConnections] = useState<Connection[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [connecting, setConnecting] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // Handle drop from toolbar
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData("nodeType")
      const label = event.dataTransfer.getData("label")

      if (!type || !canvasRef.current) return

      const rect = canvasRef.current.getBoundingClientRect()
      const x = (event.clientX - rect.left - pan.x) / scale
      const y = (event.clientY - rect.top - pan.y) / scale

      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        label,
        position: { x, y },
        data: {},
      }

      setNodes((prev) => [...prev, newNode])
    },
    [scale, pan],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  // Handle node dragging
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if ((e.target as HTMLElement).closest(".node-connector")) return

      e.stopPropagation()
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return

      setDraggingNode(nodeId)
      setSelectedNodeId(nodeId)
      onNodeSelect(nodeId)

      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        setDragOffset({
          x: (e.clientX - rect.left - pan.x) / scale - node.position.x,
          y: (e.clientY - rect.top - pan.y) / scale - node.position.y,
        })
      }
    },
    [nodes, onNodeSelect, scale, pan],
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (draggingNode && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        const x = (e.clientX - rect.left - pan.x) / scale - dragOffset.x
        const y = (e.clientY - rect.top - pan.y) / scale - dragOffset.y

        setNodes((prev) => prev.map((node) => (node.id === draggingNode ? { ...node, position: { x, y } } : node)))
      } else if (connecting && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        setConnecting({
          ...connecting,
          x: (e.clientX - rect.left - pan.x) / scale,
          y: (e.clientY - rect.top - pan.y) / scale,
        })
      } else if (isPanning) {
        setPan({
          x: pan.x + (e.clientX - panStart.x),
          y: pan.y + (e.clientY - panStart.y),
        })
        setPanStart({ x: e.clientX, y: e.clientY })
      }
    },
    [draggingNode, dragOffset, connecting, isPanning, pan, panStart, scale],
  )

  const handleMouseUp = useCallback(() => {
    setDraggingNode(null)
    setIsPanning(false)

    if (connecting) {
      // Check if we're over a node
      const targetNode = nodes.find((node) => {
        const dx = node.position.x - connecting.x
        const dy = node.position.y - connecting.y
        return Math.sqrt(dx * dx + dy * dy) < 100
      })

      if (targetNode && targetNode.id !== connecting.nodeId) {
        const newConnection: Connection = {
          id: `${connecting.nodeId}-${targetNode.id}`,
          source: connecting.nodeId,
          target: targetNode.id,
        }
        setConnections((prev) => [...prev, newConnection])
      }
      setConnecting(null)
    }
  }, [connecting, nodes])

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const handleConnectorMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation()
      const node = nodes.find((n) => n.id === nodeId)
      if (!node || !canvasRef.current) return

      const rect = canvasRef.current.getBoundingClientRect()
      setConnecting({
        nodeId,
        x: (e.clientX - rect.left - pan.x) / scale,
        y: (e.clientY - rect.top - pan.y) / scale,
      })
    },
    [nodes, scale, pan],
  )

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === canvasRef.current || (e.target as HTMLElement).closest(".canvas-background")) {
        setSelectedNodeId(null)
        onNodeSelect(null)
        setIsPanning(true)
        setPanStart({ x: e.clientX, y: e.clientY })
      }
    },
    [onNodeSelect],
  )

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setScale((prev) => Math.max(0.1, Math.min(2, prev * delta)))
  }, [])

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId))
      setConnections((prev) => prev.filter((c) => c.source !== nodeId && c.target !== nodeId))
      setSelectedNodeId(null)
      onNodeSelect(null)
    },
    [onNodeSelect],
  )

  const getNodeColor = (type: string) => {
    const colors: Record<string, string> = {
      llm: "bg-purple-500/20 border-purple-500",
      prompt: "bg-blue-500/20 border-blue-500",
      condition: "bg-yellow-500/20 border-yellow-500",
      code: "bg-green-500/20 border-green-500",
      database: "bg-cyan-500/20 border-cyan-500",
      api: "bg-orange-500/20 border-orange-500",
      response: "bg-pink-500/20 border-pink-500",
      action: "bg-red-500/20 border-red-500",
    }
    return colors[type] || "bg-gray-500/20 border-gray-500"
  }

  return (
    <div
      ref={canvasRef}
      className="relative h-full w-full overflow-hidden bg-background"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onMouseDown={handleCanvasMouseDown}
      onWheel={handleWheel}
    >
      {/* Grid background */}
      <div
        className="canvas-background absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)
          `,
          backgroundSize: `${20 * scale}px ${20 * scale}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      {/* Canvas content */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {/* Connections */}
        <svg className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }}>
          {connections.map((conn) => {
            const sourceNode = nodes.find((n) => n.id === conn.source)
            const targetNode = nodes.find((n) => n.id === conn.target)
            if (!sourceNode || !targetNode) return null

            const x1 = sourceNode.position.x + 100
            const y1 = sourceNode.position.y + 40
            const x2 = targetNode.position.x
            const y2 = targetNode.position.y + 40

            return (
              <g key={conn.id}>
                <path
                  d={`M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`}
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  fill="none"
                  opacity="0.6"
                />
              </g>
            )
          })}
          {connecting && (
            <path
              d={`M ${nodes.find((n) => n.id === connecting.nodeId)?.position.x! + 100} ${
                nodes.find((n) => n.id === connecting.nodeId)?.position.y! + 40
              } L ${connecting.x} ${connecting.y}`}
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeDasharray="5,5"
              fill="none"
              opacity="0.6"
            />
          )}
        </svg>

        {/* Nodes */}
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`absolute cursor-move rounded-lg border-2 bg-card p-4 shadow-lg transition-all ${getNodeColor(
              node.type,
            )} ${selectedNodeId === node.id ? "ring-2 ring-primary" : ""}`}
            style={{
              left: node.position.x,
              top: node.position.y,
              width: 200,
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="text-xs font-medium text-muted-foreground uppercase">{node.type}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{node.label}</div>
              </div>
              {selectedNodeId === node.id && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteNode(node.id)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>

            {/* Input connector */}
            <div
              className="node-connector absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-primary bg-background cursor-crosshair hover:scale-125 transition-transform"
              title="Input"
            />

            {/* Output connector */}
            <div
              className="node-connector absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-primary bg-background cursor-crosshair hover:scale-125 transition-transform"
              onMouseDown={(e) => handleConnectorMouseDown(e, node.id)}
              title="Output"
            />
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 bg-card border border-border rounded-lg p-2">
        <Button variant="ghost" size="sm" onClick={() => setScale((prev) => Math.min(2, prev * 1.2))} title="Zoom In">
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setScale((prev) => Math.max(0.1, prev * 0.8))}
          title="Zoom Out"
        >
          <span className="text-lg">−</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setScale(1)
            setPan({ x: 0, y: 0 })
          }}
          title="Reset View"
        >
          <span className="text-xs">1:1</span>
        </Button>
      </div>

      {/* Zoom indicator */}
      <div className="absolute bottom-4 left-4 bg-card border border-border rounded px-3 py-1 text-xs text-muted-foreground">
        {Math.round(scale * 100)}%
      </div>
    </div>
  )
}
