"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Badge } from "@/components/shared/ui/badge"
import { Avatar, AvatarFallback } from "@/components/shared/ui/avatar"
import { Users, MessageCircle } from "lucide-react"

interface Student {
  id: string
  name: string
  level: number
  tutor: string
  tutorEmoji: string
  subject: string
  currentTopic: string
  status: "online" | "learning" | "offline"
  credits: number
}

const mockStudents: Student[] = [
  {
    id: "1",
    name: "Emma Chen",
    level: 3,
    tutor: "Luna",
    tutorEmoji: "🦉",
    subject: "English",
    currentTopic: "Creative storytelling",
    status: "learning",
    credits: 450,
  },
  {
    id: "2",
    name: "Marcus Johnson",
    level: 4,
    tutor: "Max",
    tutorEmoji: "🤖",
    subject: "Math",
    currentTopic: "Algebra basics",
    status: "online",
    credits: 680,
  },
  {
    id: "3",
    name: "Sofia Rodriguez",
    level: 2,
    tutor: "Bella",
    tutorEmoji: "🔬",
    subject: "Biology",
    currentTopic: "Cell structure",
    status: "learning",
    credits: 320,
  },
  {
    id: "4",
    name: "Aiden Park",
    level: 3,
    tutor: "Aisha",
    tutorEmoji: "🕌",
    subject: "Islamic Studies",
    currentTopic: "The five pillars",
    status: "offline",
    credits: 510,
  },
  {
    id: "5",
    name: "Zara Ahmed",
    level: 5,
    tutor: "Aisha",
    tutorEmoji: "🕌",
    subject: "Islamic Studies",
    currentTopic: "Stories of the prophets",
    status: "online",
    credits: 890,
  },
  {
    id: "6",
    name: "Leo Martinez",
    level: 2,
    tutor: "Luna",
    tutorEmoji: "🦉",
    subject: "English",
    currentTopic: "Reading comprehension",
    status: "learning",
    credits: 280,
  },
  {
    id: "7",
    name: "Maya Patel",
    level: 4,
    tutor: "Max",
    tutorEmoji: "🤖",
    subject: "Math",
    currentTopic: "Geometry",
    status: "online",
    credits: 720,
  },
  {
    id: "8",
    name: "Oliver Kim",
    level: 3,
    tutor: "Bella",
    tutorEmoji: "🔬",
    subject: "Biology",
    currentTopic: "Ecosystems",
    status: "learning",
    credits: 540,
  },
]

export function StudentList() {
  const [filter, setFilter] = useState<string>("all")

  const tutors = [
    { name: "all", label: "All Tutors", emoji: "👥" },
    { name: "Max", label: "Max", emoji: "🤖" },
    { name: "Luna", label: "Luna", emoji: "🦉" },
    { name: "Bella", label: "Bella", emoji: "🔬" },
    { name: "Aisha", label: "Aisha", emoji: "🕌" },
  ]

  const filteredStudents = filter === "all" ? mockStudents : mockStudents.filter((s) => s.tutor === filter)

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online":
        return "bg-slate-500"
      case "learning":
        return "bg-blue-500"
      case "offline":
        return "bg-gray-400"
      default:
        return "bg-gray-400"
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case "online":
        return "Online"
      case "learning":
        return "Learning now"
      case "offline":
        return "Offline"
      default:
        return "Offline"
    }
  }

  return (
    <div className="space-y-6">
      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2">
        {tutors.map((tutor) => (
          <Button
            key={tutor.name}
            variant={filter === tutor.name ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(tutor.name)}
            className="gap-2"
          >
            <span>{tutor.emoji}</span>
            <span>{tutor.label}</span>
          </Button>
        ))}
      </div>

      {/* Student cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredStudents.map((student) => (
          <Card key={student.id} className="hover:shadow-lg transition-all">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="relative">
                  <Avatar className="w-12 h-12 bg-primary/10">
                    <AvatarFallback className="text-lg font-semibold">
                      {student.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-background ${getStatusColor(student.status)}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg truncate">{student.name}</h3>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-2xl">{student.tutorEmoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{student.subject}</p>
                    <p className="text-xs text-muted-foreground truncate">{student.currentTopic}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs">
                    {getStatusText(student.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{student.credits} credits</span>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={() => {
                      window.location.href = `/study-session?student=${student.id}`
                    }}
                  >
                    <Users className="w-4 h-4" />
                    Study Together
                  </Button>
                  <Button size="sm" variant="outline">
                    <MessageCircle className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredStudents.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No students found learning with this tutor</p>
        </div>
      )}
    </div>
  )
}
