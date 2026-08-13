"use client"

import React, { useEffect, useRef, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ZoomIn, ZoomOut, Maximize2, Filter, Play, Pause, RotateCcw, MousePointer2, Move, Info, X } from "lucide-react"

// Types
interface Node {
  id: string
  label: string
  group: string
  size: number
  x: number
  y: number
  vx: number
  vy: number
  mentions: number
  trend: number
  recentChats: number
}

interface Edge {
  source: string
  target: string
  strength: number
}

// Initial knowledge graph data representing common topics from student chats
const initialTopicsData: { nodes: Node[]; edges: Edge[] } = {
  nodes: [
    // Core subjects (larger nodes)
    { id: "biology", label: "Biology", group: "subject", size: 50, x: 500, y: 400, vx: 0, vy: 0, mentions: 2847, trend: 12.5, recentChats: 342 },
    { id: "math", label: "Mathematics", group: "subject", size: 48, x: 700, y: 350, vx: 0, vy: 0, mentions: 2654, trend: 8.3, recentChats: 298 },
    { id: "islamic", label: "Islamic Studies", group: "subject", size: 46, x: 600, y: 550, vx: 0, vy: 0, mentions: 2234, trend: 15.2, recentChats: 267 },
    { id: "language", label: "Language", group: "subject", size: 44, x: 400, y: 500, vx: 0, vy: 0, mentions: 1987, trend: 6.8, recentChats: 234 },
    
    // Biology topics
    { id: "cells", label: "Cell Structure", group: "biology", size: 32, x: 350, y: 280, vx: 0, vy: 0, mentions: 892, trend: 18.2, recentChats: 89 },
    { id: "genetics", label: "Genetics", group: "biology", size: 35, x: 400, y: 200, vx: 0, vy: 0, mentions: 956, trend: 22.1, recentChats: 112 },
    { id: "dna", label: "DNA", group: "biology", size: 30, x: 520, y: 230, vx: 0, vy: 0, mentions: 734, trend: 14.5, recentChats: 67 },
    { id: "evolution", label: "Evolution", group: "biology", size: 28, x: 320, y: 380, vx: 0, vy: 0, mentions: 567, trend: 9.3, recentChats: 45 },
    { id: "ecosystems", label: "Ecosystems", group: "biology", size: 30, x: 250, y: 320, vx: 0, vy: 0, mentions: 645, trend: 11.7, recentChats: 58 },
    { id: "photosynthesis", label: "Photosynthesis", group: "biology", size: 26, x: 420, y: 300, vx: 0, vy: 0, mentions: 423, trend: 7.8, recentChats: 34 },
    
    // Math topics
    { id: "algebra", label: "Algebra", group: "math", size: 36, x: 800, y: 250, vx: 0, vy: 0, mentions: 1124, trend: 19.4, recentChats: 134 },
    { id: "equations", label: "Equations", group: "math", size: 30, x: 850, y: 380, vx: 0, vy: 0, mentions: 789, trend: 12.1, recentChats: 78 },
    { id: "fractions", label: "Fractions", group: "math", size: 28, x: 780, y: 180, vx: 0, vy: 0, mentions: 654, trend: 8.9, recentChats: 56 },
    { id: "geometry", label: "Geometry", group: "math", size: 32, x: 900, y: 280, vx: 0, vy: 0, mentions: 876, trend: 14.2, recentChats: 89 },
    { id: "calculus", label: "Calculus", group: "math", size: 26, x: 820, y: 450, vx: 0, vy: 0, mentions: 432, trend: 5.6, recentChats: 32 },
    { id: "statistics", label: "Statistics", group: "math", size: 28, x: 950, y: 380, vx: 0, vy: 0, mentions: 523, trend: 10.3, recentChats: 45 },
    
    // Islamic Studies topics
    { id: "quran", label: "Quran", group: "islamic", size: 34, x: 550, y: 650, vx: 0, vy: 0, mentions: 1045, trend: 21.3, recentChats: 145 },
    { id: "prayer", label: "Prayer", group: "islamic", size: 30, x: 650, y: 620, vx: 0, vy: 0, mentions: 756, trend: 16.8, recentChats: 98 },
    { id: "prophets", label: "Prophets", group: "islamic", size: 32, x: 720, y: 580, vx: 0, vy: 0, mentions: 834, trend: 13.5, recentChats: 87 },
    { id: "hadith", label: "Hadith", group: "islamic", size: 28, x: 480, y: 620, vx: 0, vy: 0, mentions: 612, trend: 11.2, recentChats: 65 },
    { id: "fiqh", label: "Fiqh", group: "islamic", size: 26, x: 620, y: 700, vx: 0, vy: 0, mentions: 534, trend: 9.7, recentChats: 52 },
    { id: "history", label: "Islamic History", group: "islamic", size: 24, x: 750, y: 650, vx: 0, vy: 0, mentions: 423, trend: 7.4, recentChats: 38 },
    
    // Language topics
    { id: "arabic", label: "Arabic", group: "language", size: 32, x: 280, y: 480, vx: 0, vy: 0, mentions: 867, trend: 15.6, recentChats: 92 },
    { id: "vocabulary", label: "Vocabulary", group: "language", size: 28, x: 200, y: 420, vx: 0, vy: 0, mentions: 623, trend: 10.8, recentChats: 67 },
    { id: "grammar", label: "Grammar", group: "language", size: 30, x: 300, y: 580, vx: 0, vy: 0, mentions: 712, trend: 12.4, recentChats: 74 },
    { id: "reading", label: "Reading", group: "language", size: 26, x: 150, y: 500, vx: 0, vy: 0, mentions: 534, trend: 8.9, recentChats: 52 },
    { id: "writing", label: "Writing", group: "language", size: 24, x: 350, y: 560, vx: 0, vy: 0, mentions: 456, trend: 7.2, recentChats: 43 },
    { id: "pronunciation", label: "Pronunciation", group: "language", size: 22, x: 230, y: 620, vx: 0, vy: 0, mentions: 345, trend: 5.8, recentChats: 31 },
    
    // Cross-subject topics
    { id: "homework", label: "Homework Help", group: "general", size: 40, x: 600, y: 420, vx: 0, vy: 0, mentions: 1567, trend: 24.5, recentChats: 187 },
    { id: "exams", label: "Exam Prep", group: "general", size: 36, x: 500, y: 480, vx: 0, vy: 0, mentions: 1234, trend: 31.2, recentChats: 156 },
    { id: "concepts", label: "Concept Clarity", group: "general", size: 32, x: 650, y: 480, vx: 0, vy: 0, mentions: 987, trend: 17.8, recentChats: 112 },
  ],
  edges: [
    // Biology connections
    { source: "biology", target: "cells", strength: 0.9 },
    { source: "biology", target: "genetics", strength: 0.95 },
    { source: "biology", target: "evolution", strength: 0.7 },
    { source: "biology", target: "ecosystems", strength: 0.75 },
    { source: "genetics", target: "dna", strength: 0.9 },
    { source: "cells", target: "photosynthesis", strength: 0.6 },
    { source: "cells", target: "dna", strength: 0.7 },
    
    // Math connections
    { source: "math", target: "algebra", strength: 0.95 },
    { source: "math", target: "geometry", strength: 0.85 },
    { source: "algebra", target: "equations", strength: 0.9 },
    { source: "algebra", target: "fractions", strength: 0.7 },
    { source: "math", target: "calculus", strength: 0.6 },
    { source: "math", target: "statistics", strength: 0.65 },
    { source: "equations", target: "calculus", strength: 0.5 },
    
    // Islamic Studies connections
    { source: "islamic", target: "quran", strength: 0.95 },
    { source: "islamic", target: "prayer", strength: 0.85 },
    { source: "islamic", target: "prophets", strength: 0.8 },
    { source: "quran", target: "hadith", strength: 0.75 },
    { source: "islamic", target: "fiqh", strength: 0.7 },
    { source: "prophets", target: "history", strength: 0.6 },
    { source: "prayer", target: "fiqh", strength: 0.65 },
    
    // Language connections
    { source: "language", target: "arabic", strength: 0.9 },
    { source: "language", target: "grammar", strength: 0.85 },
    { source: "arabic", target: "vocabulary", strength: 0.8 },
    { source: "language", target: "reading", strength: 0.75 },
    { source: "arabic", target: "pronunciation", strength: 0.7 },
    { source: "grammar", target: "writing", strength: 0.65 },
    { source: "reading", target: "vocabulary", strength: 0.6 },
    
    // Cross-subject connections
    { source: "biology", target: "homework", strength: 0.7 },
    { source: "math", target: "homework", strength: 0.8 },
    { source: "islamic", target: "homework", strength: 0.6 },
    { source: "language", target: "homework", strength: 0.65 },
    { source: "homework", target: "exams", strength: 0.75 },
    { source: "homework", target: "concepts", strength: 0.7 },
    { source: "exams", target: "concepts", strength: 0.6 },
    
    // Interesting cross-connections
    { source: "arabic", target: "quran", strength: 0.85 },
    { source: "history", target: "evolution", strength: 0.3 },
    { source: "statistics", target: "ecosystems", strength: 0.25 },
  ],
}

const groupColors: Record<string, string> = {
  subject: "#8b5cf6",
  biology: "#10b981",
  math: "#3b82f6",
  islamic: "#f59e0b",
  language: "#ec4899",
  general: "#6b7280",
}

export function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  const [nodes, setNodes] = useState<Node[]>(() => JSON.parse(JSON.stringify(initialTopicsData.nodes)))
  const [zoom, setZoom] = useState(0.85)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [filter, setFilter] = useState<string>("all")
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggingNode, setIsDraggingNode] = useState(false)
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 })
  const [isSimulating, setIsSimulating] = useState(false)
  const [interactionMode, setInteractionMode] = useState<"select" | "pan">("select")
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [tooltipNode, setTooltipNode] = useState<Node | null>(null)
  const [animationTime, setAnimationTime] = useState(0)

  const edges = initialTopicsData.edges

  const filteredNodes = filter === "all"
    ? nodes
    : nodes.filter(n => n.group === filter || n.group === "subject" || n.group === "general")

  const filteredEdges = edges.filter(e => {
    const sourceNode = nodes.find(n => n.id === e.source)
    const targetNode = nodes.find(n => n.id === e.target)
    if (!sourceNode || !targetNode) return false
    if (filter === "all") return true
    return (
      sourceNode.group === filter ||
      targetNode.group === filter ||
      sourceNode.group === "subject" ||
      targetNode.group === "subject" ||
      sourceNode.group === "general" ||
      targetNode.group === "general"
    )
  })

  // Force simulation
  const simulateForces = useCallback(() => {
    if (!isSimulating) return

    setNodes(prevNodes => {
      const newNodes = prevNodes.map(node => ({ ...node }))
      
      // Apply forces
      for (const node of newNodes) {
        node.vx = node.vx * 0.9 // Damping
        node.vy = node.vy * 0.9

        // Repulsion from other nodes
        for (const other of newNodes) {
          if (node.id === other.id) continue
          const dx = node.x - other.x
          const dy = node.y - other.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const minDist = (node.size + other.size) * 2
          if (dist < minDist) {
            const force = (minDist - dist) / dist * 0.5
            node.vx += dx * force
            node.vy += dy * force
          }
        }

        // Attraction along edges
        for (const edge of edges) {
          let other: Node | undefined
          if (edge.source === node.id) {
            other = newNodes.find(n => n.id === edge.target)
          } else if (edge.target === node.id) {
            other = newNodes.find(n => n.id === edge.source)
          }
          if (other) {
            const dx = other.x - node.x
            const dy = other.y - node.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const force = (dist - 150) * 0.01 * edge.strength
            node.vx += dx / dist * force
            node.vy += dy / dist * force
          }
        }

        // Center gravity
        const cx = 600, cy = 450
        node.vx += (cx - node.x) * 0.001
        node.vy += (cy - node.y) * 0.001

        // Apply velocity
        node.x += node.vx
        node.y += node.vy

        // Boundary constraints
        node.x = Math.max(50, Math.min(1150, node.x))
        node.y = Math.max(50, Math.min(850, node.y))
      }

      return newNodes
    })
  }, [isSimulating, edges])

  // Animation loop
  useEffect(() => {
    let lastTime = 0
    const animate = (time: number) => {
      if (time - lastTime > 16) {
        setAnimationTime(t => t + 1)
        if (isSimulating) {
          simulateForces()
        }
        lastTime = time
      }
      animationRef.current = requestAnimationFrame(animate)
    }
    animationRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isSimulating, simulateForces])

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Apply transformations
    ctx.save()
    ctx.translate(pan.x + rect.width / 2, pan.y + rect.height / 2)
    ctx.scale(zoom, zoom)
    ctx.translate(-rect.width / 2, -rect.height / 2)

    // Draw edges with animation
    filteredEdges.forEach(edge => {
      const source = filteredNodes.find(n => n.id === edge.source)
      const target = filteredNodes.find(n => n.id === edge.target)
      if (!source || !target) return

      const isConnectedToSelected = selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id)
      const isConnectedToHovered = hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode)

      // Animated dash pattern
      const dashOffset = (animationTime * 0.5) % 20

      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)

      if (isConnectedToSelected || isConnectedToHovered) {
        ctx.strokeStyle = groupColors[source.group] || "#6b7280"
        ctx.lineWidth = edge.strength * 4
        ctx.setLineDash([10, 5])
        ctx.lineDashOffset = -dashOffset
      } else {
        ctx.strokeStyle = `rgba(156, 163, 175, ${edge.strength * 0.3})`
        ctx.lineWidth = edge.strength * 2
        ctx.setLineDash([])
      }
      ctx.stroke()
      ctx.setLineDash([])
    })

    // Draw nodes
    filteredNodes.forEach(node => {
      const isHovered = hoveredNode === node.id
      const isSelected = selectedNode?.id === node.id
      const isDragged = draggedNodeId === node.id
      const color = groupColors[node.group] || groupColors.general

      // Pulsing animation for selected/hovered nodes
      const pulseScale = isSelected || isHovered ? 1 + Math.sin(animationTime * 0.1) * 0.05 : 1
      const nodeSize = node.size * pulseScale

      // Outer glow
      if (isHovered || isSelected || isDragged) {
        const gradient = ctx.createRadialGradient(node.x, node.y, nodeSize, node.x, node.y, nodeSize + 20)
        gradient.addColorStop(0, `${color}66`)
        gradient.addColorStop(1, `${color}00`)
        ctx.beginPath()
        ctx.arc(node.x, node.y, nodeSize + 20, 0, Math.PI * 2)
        ctx.fillStyle = gradient
        ctx.fill()
      }

      // Node shadow
      ctx.beginPath()
      ctx.arc(node.x + 2, node.y + 2, nodeSize, 0, Math.PI * 2)
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)"
      ctx.fill()

      // Node gradient fill
      const nodeGradient = ctx.createRadialGradient(node.x - nodeSize * 0.3, node.y - nodeSize * 0.3, 0, node.x, node.y, nodeSize)
      nodeGradient.addColorStop(0, `${color}`)
      nodeGradient.addColorStop(1, `${color}cc`)

      ctx.beginPath()
      ctx.arc(node.x, node.y, nodeSize, 0, Math.PI * 2)
      ctx.fillStyle = nodeGradient
      ctx.fill()

      // Node border
      ctx.strokeStyle = isSelected ? "#ffffff" : `${color}`
      ctx.lineWidth = isSelected ? 3 : 2
      ctx.stroke()

      // Node label
      ctx.fillStyle = "#ffffff"
      ctx.font = `${node.group === "subject" ? "bold " : ""}${Math.max(11, nodeSize / 2.2)}px system-ui`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      
      // Text shadow
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
      ctx.shadowBlur = 3
      ctx.fillText(node.label, node.x, node.y)
      ctx.shadowBlur = 0

      // Trend indicator
      if (node.trend > 15 && !isSelected && !isHovered) {
        ctx.fillStyle = "#22c55e"
        ctx.font = "bold 10px system-ui"
        ctx.fillText(`+${node.trend.toFixed(0)}%`, node.x, node.y + nodeSize + 12)
      }
    })

    ctx.restore()
  }, [zoom, pan, filteredNodes, filteredEdges, hoveredNode, selectedNode, draggedNodeId, animationTime])

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left - pan.x - rect.width / 2) / zoom + rect.width / 2
    const y = (e.clientY - rect.top - pan.y - rect.height / 2) / zoom + rect.height / 2
    return { x, y }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const { x, y } = getMousePos(e)

    if (isDraggingNode && draggedNodeId) {
      setNodes(prevNodes =>
        prevNodes.map(node =>
          node.id === draggedNodeId ? { ...node, x, y, vx: 0, vy: 0 } : node
        )
      )
      return
    }

    if (isDragging) {
      setPan({
        x: pan.x + (e.clientX - lastMouse.x),
        y: pan.y + (e.clientY - lastMouse.y),
      })
      setLastMouse({ x: e.clientX, y: e.clientY })
      return
    }

    // Check for node hover
    let found = false
    for (const node of filteredNodes) {
      const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2)
      if (dist <= node.size) {
        setHoveredNode(node.id)
        setTooltipNode(node)
        setTooltipPos({ x: e.clientX, y: e.clientY })
        setShowTooltip(true)
        canvas.style.cursor = interactionMode === "select" ? "pointer" : "grab"
        found = true
        break
      }
    }
    if (!found) {
      setHoveredNode(null)
      setShowTooltip(false)
      canvas.style.cursor = isDragging ? "grabbing" : (interactionMode === "pan" ? "grab" : "default")
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const { x, y } = getMousePos(e)

    // Check for node click
    for (const node of filteredNodes) {
      const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2)
      if (dist <= node.size) {
        if (interactionMode === "select") {
          setSelectedNode(node)
          setIsDraggingNode(true)
          setDraggedNodeId(node.id)
        }
        return
      }
    }

    if (interactionMode === "pan" || e.button === 1) {
      setIsDragging(true)
      setLastMouse({ x: e.clientX, y: e.clientY })
      canvas.style.cursor = "grabbing"
    } else {
      setSelectedNode(null)
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    setIsDraggingNode(false)
    setDraggedNodeId(null)
    if (canvasRef.current) {
      canvasRef.current.style.cursor = interactionMode === "pan" ? "grab" : "default"
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom(z => Math.max(0.3, Math.min(2, z + delta)))
  }

  const resetView = () => {
    setZoom(0.85)
    setPan({ x: 0, y: 0 })
    setNodes(JSON.parse(JSON.stringify(initialTopicsData.nodes)))
    setSelectedNode(null)
  }

  // Get related topics for selected node
  const relatedTopics = selectedNode
    ? edges
        .filter(e => e.source === selectedNode.id || e.target === selectedNode.id)
        .map(e => {
          const otherId = e.source === selectedNode.id ? e.target : e.source
          const otherNode = nodes.find(n => n.id === otherId)
          const edge = e
          return otherNode ? { node: otherNode, strength: edge.strength } : null
        })
        .filter(Boolean)
        .sort((a, b) => (b?.strength || 0) - (a?.strength || 0))
        .slice(0, 8)
    : []

  return (
    <Card className="col-span-full">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xl">Student Chat Topics - Knowledge Graph</CardTitle>
            <CardDescription>
              Interactive visualization of common topics and relationships across student conversations. Drag nodes to reposition.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={interactionMode} onValueChange={(v) => setInteractionMode(v as "select" | "pan")}>
              <TabsList className="h-9">
                <TabsTrigger value="select" className="gap-1.5 px-3">
                  <MousePointer2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Select</span>
                </TabsTrigger>
                <TabsTrigger value="pan" className="gap-1.5 px-3">
                  <Move className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Pan</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-9 w-[130px]">
                <Filter className="mr-2 h-3.5 w-3.5" />
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Topics</SelectItem>
                <SelectItem value="biology">Biology</SelectItem>
                <SelectItem value="math">Mathematics</SelectItem>
                <SelectItem value="islamic">Islamic Studies</SelectItem>
                <SelectItem value="language">Language</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="relative flex-1">
            <canvas
              ref={canvasRef}
              className="h-[700px] w-full rounded-lg border border-border bg-gradient-to-br from-muted/30 to-muted/50"
              style={{ cursor: interactionMode === "pan" ? "grab" : "default" }}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            />
            
            {/* Tooltip */}
            {showTooltip && tooltipNode && !isDraggingNode && (
              <div
                className="pointer-events-none fixed z-50 rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-lg"
                style={{ left: tooltipPos.x + 15, top: tooltipPos.y + 15 }}
              >
                <p className="font-semibold">{tooltipNode.label}</p>
                <p className="text-muted-foreground">{tooltipNode.mentions.toLocaleString()} mentions</p>
                <p className="text-green-500">+{tooltipNode.trend}% this week</p>
              </div>
            )}

            {/* Controls */}
            <div className="absolute bottom-4 left-4 flex gap-1.5">
              <Button
                variant="secondary"
                size="icon"
                className="h-9 w-9 shadow-md"
                onClick={() => setZoom(z => Math.min(z + 0.15, 2))}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="h-9 w-9 shadow-md"
                onClick={() => setZoom(z => Math.max(z - 0.15, 0.3))}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="icon" className="h-9 w-9 shadow-md" onClick={resetView}>
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant={isSimulating ? "default" : "secondary"}
                size="icon"
                className="h-9 w-9 shadow-md"
                onClick={() => setIsSimulating(!isSimulating)}
              >
                {isSimulating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
            </div>

            {/* Legend */}
            <div className="absolute bottom-4 right-4 flex flex-wrap justify-end gap-2">
              {Object.entries(groupColors).map(([group, color]) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setFilter(filter === group ? "all" : group)}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs shadow-md backdrop-blur transition-all ${
                    filter === group ? "bg-primary text-primary-foreground" : "bg-background/90 hover:bg-background"
                  }`}
                >
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="capitalize">{group === "general" ? "General" : group}</span>
                </button>
              ))}
            </div>

            {/* Info hint */}
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg bg-background/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
              <Info className="h-3.5 w-3.5" />
              <span>Click nodes to view details. Drag to reposition. Scroll to zoom.</span>
            </div>
          </div>

          {/* Details Panel */}
          {selectedNode && (
            <div className="w-full shrink-0 rounded-lg border border-border bg-card lg:w-80">
              <div className="flex items-center justify-between border-b border-border p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: groupColors[selectedNode.group] }}
                  />
                  <h3 className="font-semibold">{selectedNode.label}</h3>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedNode(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Total Mentions</p>
                    <p className="text-2xl font-bold">{selectedNode.mentions.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Recent Chats</p>
                    <p className="text-2xl font-bold">{selectedNode.recentChats}</p>
                  </div>
                </div>

                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Weekly Trend</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-bold text-green-500">+{selectedNode.trend}%</p>
                    <div className="flex-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all"
                          style={{ width: `${Math.min(selectedNode.trend * 2, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">Category</p>
                  <Badge
                    variant="outline"
                    className="capitalize"
                    style={{ borderColor: groupColors[selectedNode.group], color: groupColors[selectedNode.group] }}
                  >
                    {selectedNode.group}
                  </Badge>
                </div>

                {relatedTopics.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium">Connected Topics</p>
                    <div className="space-y-2">
                      {relatedTopics.map(item => item && (
                        <button
                          key={item.node.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg border border-border bg-background p-2 text-left transition-colors hover:bg-muted"
                          onClick={() => setSelectedNode(item.node)}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: groupColors[item.node.group] }}
                            />
                            <span className="text-sm">{item.node.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${item.strength * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{Math.round(item.strength * 100)}%</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
