"use client"

import type React from "react"
import { useEffect, useState, useRef } from "react"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { Send, Users, Sparkles } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Avatar, AvatarFallback } from "@/components/shared/ui/avatar"
import { Badge } from "@/components/shared/ui/badge"

interface Message {
  id: string
  sender: string
  senderType: "user" | "student" | "tutor"
  content: string
  timestamp: Date
  avatar?: string
  emoji?: string
}

interface Participant {
  id: string
  name: string
  type: "student" | "tutor"
  emoji?: string
  status: "online" | "learning"
  level?: number
}

export default function StudySessionPage() {
  const { isLoading } = useAuth()
  const [inputValue, setInputValue] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [currentUser, setCurrentUser] = useState({ name: "Alex", level: 3 })
  const [tutor, setTutor] = useState({ name: "Luna", emoji: "🦉", subject: "Reading & Writing" })
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    // Load user data
    const userData = localStorage.getItem("user")
    if (userData) {
      const user = JSON.parse(userData)
      setCurrentUser({ name: user.name || "Alex", level: user.level || 3 })
    }

    // Load tutor from URL params or localStorage
    const params = new URLSearchParams(window.location.search)
    const studentId = params.get("student")

    // Mock participants based on the student we're joining
    const mockParticipants: Participant[] = [
      {
        id: "tutor-1",
        name: "Luna",
        type: "tutor",
        emoji: "🦉",
        status: "online",
      },
      {
        id: "student-1",
        name: "Emma Chen",
        type: "student",
        status: "learning",
        level: 3,
      },
      {
        id: "student-2",
        name: "Leo Martinez",
        type: "student",
        status: "learning",
        level: 2,
      },
    ]

    setParticipants(mockParticipants)

    // Mock initial messages
    const initialMessages: Message[] = [
      {
        id: "1",
        sender: "Luna",
        senderType: "tutor",
        content:
          "Welcome to our study group! I'm so excited to learn with all of you today. What would you like to explore together?",
        timestamp: new Date(Date.now() - 300000),
        emoji: "🦉",
      },
      {
        id: "2",
        sender: "Emma Chen",
        senderType: "student",
        content: "Hi everyone! I'd love to work on creative writing today. Maybe we could write a story together?",
        timestamp: new Date(Date.now() - 240000),
      },
      {
        id: "3",
        sender: "Leo Martinez",
        senderType: "student",
        content: "That sounds fun! I'm working on my reading comprehension. Can we read something together?",
        timestamp: new Date(Date.now() - 180000),
      },
      {
        id: "4",
        sender: "Luna",
        senderType: "tutor",
        content:
          "Great ideas! How about we read a short story together and then each of you can write your own ending? That way we practice both reading and creative writing!",
        timestamp: new Date(Date.now() - 120000),
        emoji: "🦉",
      },
    ]

    setMessages(initialMessages)
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim()) {
      const newMessage: Message = {
        id: Date.now().toString(),
        sender: currentUser.name,
        senderType: "user",
        content: inputValue,
        timestamp: new Date(),
      }
      setMessages([...messages, newMessage])
      setInputValue("")

      // Simulate tutor response after a delay
      setTimeout(() => {
        const tutorResponse: Message = {
          id: (Date.now() + 1).toString(),
          sender: tutor.name,
          senderType: "tutor",
          content: `That's a wonderful contribution, ${currentUser.name}! Let's explore that idea together. What do the rest of you think?`,
          timestamp: new Date(),
          emoji: tutor.emoji,
        }
        setMessages((prev) => [...prev, tutorResponse])
      }, 2000)
    }
  }

  const getMessageAlignment = (senderType: string) => {
    return senderType === "user" ? "flex-row-reverse" : "flex-row"
  }

  const getMessageBg = (senderType: string) => {
    if (senderType === "user") return "bg-blue-600 text-white"
    if (senderType === "tutor") return "bg-slate-50 border border-slate-200 text-slate-900"
    return "bg-slate-50 border border-slate-200 text-slate-900"
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <DashboardHeader />

      {/* Session Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200">
        <div className="container mx-auto px-4 py-3 max-w-6xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-500 flex items-center justify-center">
                <span className="text-2xl">{tutor.emoji}</span>
              </div>
              <div>
                <div className="font-medium text-slate-900">Group Study with {tutor.name}</div>
                <div className="text-xs text-slate-500">{tutor.subject}</div>
              </div>
            </div>
            <Badge variant="secondary" className="gap-2">
              <Users className="w-3 h-3" />
              {participants.length} participants
            </Badge>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Participants Sidebar */}
          <div className="lg:col-span-1">
            <Card className="border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all">
              <CardContent className="p-4">
                <h3 className="font-medium text-sm text-slate-900 mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Participants
                </h3>
                <div className="space-y-3">
                  {participants.map((participant) => (
                    <div key={participant.id} className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar className="w-8 h-8 bg-primary/10">
                          {participant.type === "tutor" ? (
                            <span className="text-lg">{participant.emoji}</span>
                          ) : (
                            <AvatarFallback className="text-xs font-semibold">
                              {participant.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div
                          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${participant.status === "online" ? "bg-slate-500" : "bg-blue-500"}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{participant.name}</p>
                      </div>
                    </div>
                  ))}

                  {/* Current User */}
                  <div className="flex items-center gap-3 pt-2 border-t border-slate-200">
                    <div className="relative">
                      <Avatar className="w-8 h-8 bg-blue-500">
                        <AvatarFallback className="text-xs font-semibold text-white">
                          {currentUser.name[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white bg-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{currentUser.name} (You)</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Chat Area */}
          <div className="lg:col-span-3">
            <Card className="border border-slate-200 shadow-md">
              <CardContent className="p-0">
                {/* Messages */}
                <div className="h-[500px] overflow-y-auto p-6 space-y-4 bg-white/50">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex gap-3 ${getMessageAlignment(message.senderType)}`}>
                      {/* Avatar */}
                      <div className="flex-shrink-0">
                        {message.senderType === "tutor" ? (
                          <div className="w-10 h-10 rounded-full bg-purple-500 flex items-center justify-center">
                            <span className="text-xl">{message.emoji}</span>
                          </div>
                        ) : message.senderType === "user" ? (
                          <Avatar className="w-10 h-10 bg-blue-600">
                            <AvatarFallback className="text-white font-semibold">{currentUser.name[0]}</AvatarFallback>
                          </Avatar>
                        ) : (
                          <Avatar className="w-10 h-10 bg-slate-200">
                            <AvatarFallback className="text-slate-700 font-semibold">
                              {message.sender
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>

                      {/* Message Bubble */}
                      <div className="flex-1 max-w-[80%]">
                        {message.senderType !== "user" && (
                          <div className="text-xs text-slate-500 mb-1 px-1">
                            {message.sender}
                            {message.senderType === "tutor" && (
                              <Badge variant="secondary" className="ml-2 text-xs">
                                Tutor
                              </Badge>
                            )}
                          </div>
                        )}
                        <div className={`rounded-2xl px-4 py-3 ${getMessageBg(message.senderType)}`}>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                        </div>
                        <div className="text-xs text-slate-400 mt-1 px-1">
                          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="border-t-2 border-purple-200 p-4 bg-white">
                  <form onSubmit={handleSubmit} className="flex gap-2">
                    <Input
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder="Share your thoughts with the group..."
                      className="flex-1 bg-white border border-slate-200 focus:border-slate-400"
                    />
                    <Button type="submit" disabled={!inputValue.trim()} className="bg-blue-600 hover:bg-blue-700">
                      <Send className="w-5 h-5" />
                    </Button>
                  </form>
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Sparkles className="w-3 h-3" />
                    <span>Learning together with {tutor.name} and your study buddies</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
