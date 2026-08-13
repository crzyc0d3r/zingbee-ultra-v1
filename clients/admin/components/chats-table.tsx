"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

type ChatStatus = "active" | "completed" | "abandoned"

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: string
}

interface ChatSession {
  id: string
  userId: string
  userName: string
  startTime: string
  lastActivity: string
  messageCount: number
  status: ChatStatus
  topic: string
  messages: Message[]
}

const mockChats: ChatSession[] = [
  {
    id: "chat_001",
    userId: "user_123",
    userName: "John Doe",
    startTime: "2025-01-17 14:30:00",
    lastActivity: "2025-01-17 14:45:00",
    messageCount: 12,
    status: "completed",
    topic: "Introduction to Machine Learning",
    messages: [
      { role: "user", content: "What is machine learning?", timestamp: "14:30:00" },
      {
        role: "assistant",
        content:
          "Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed.",
        timestamp: "14:30:15",
      },
      { role: "user", content: "Can you give me an example?", timestamp: "14:31:00" },
      {
        role: "assistant",
        content:
          "A common example is email spam filtering. The system learns to identify spam by analyzing patterns in emails that users mark as spam.",
        timestamp: "14:31:20",
      },
    ],
  },
  {
    id: "chat_002",
    userId: "user_456",
    userName: "Jane Smith",
    startTime: "2025-01-17 13:15:00",
    lastActivity: "2025-01-17 13:18:00",
    messageCount: 5,
    status: "abandoned",
    topic: "Python Basics",
    messages: [
      { role: "user", content: "How do I start learning Python?", timestamp: "13:15:00" },
      {
        role: "assistant",
        content:
          "Great question! I recommend starting with basic syntax and data types. Would you like to begin with variables?",
        timestamp: "13:15:10",
      },
      { role: "user", content: "Yes please", timestamp: "13:16:00" },
    ],
  },
  {
    id: "chat_003",
    userId: "user_789",
    userName: "Bob Johnson",
    startTime: "2025-01-17 15:00:00",
    lastActivity: "2025-01-17 15:02:00",
    messageCount: 8,
    status: "active",
    topic: "Neural Networks",
    messages: [
      { role: "user", content: "Explain neural networks", timestamp: "15:00:00" },
      {
        role: "assistant",
        content:
          "Neural networks are computing systems inspired by biological neural networks. They consist of interconnected nodes (neurons) organized in layers.",
        timestamp: "15:00:20",
      },
    ],
  },
  {
    id: "chat_004",
    userId: "user_234",
    userName: "Alice Williams",
    startTime: "2025-01-17 12:45:00",
    lastActivity: "2025-01-17 13:10:00",
    messageCount: 18,
    status: "completed",
    topic: "Data Structures",
    messages: [
      { role: "user", content: "What are the main data structures?", timestamp: "12:45:00" },
      {
        role: "assistant",
        content:
          "The main data structures include arrays, linked lists, stacks, queues, trees, and graphs. Each has specific use cases.",
        timestamp: "12:45:15",
      },
    ],
  },
  {
    id: "chat_005",
    userId: "user_567",
    userName: "Charlie Brown",
    startTime: "2025-01-17 11:30:00",
    lastActivity: "2025-01-17 11:55:00",
    messageCount: 15,
    status: "completed",
    topic: "Algorithms Complexity",
    messages: [
      { role: "user", content: "What is Big O notation?", timestamp: "11:30:00" },
      {
        role: "assistant",
        content:
          "Big O notation describes the performance or complexity of an algorithm, specifically how the runtime grows relative to input size.",
        timestamp: "11:30:12",
      },
    ],
  },
]

const statusColors: Record<ChatStatus, string> = {
  active: "bg-green-500/10 text-green-500 border-green-500/20",
  completed: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  abandoned: "bg-gray-500/10 text-gray-500 border-gray-500/20",
}

export function ChatsTable() {
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const totalPages = Math.ceil(mockChats.length / itemsPerPage)

  const paginatedChats = mockChats.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <Card>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Chat ID</TableHead>
              <TableHead className="w-[150px]">User</TableHead>
              <TableHead>Topic</TableHead>
              <TableHead className="w-[100px]">Messages</TableHead>
              <TableHead className="w-[180px]">Last Activity</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedChats.map((chat) => (
              <TableRow key={chat.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{chat.id}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {chat.userName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{chat.userName}</p>
                      <p className="text-xs text-muted-foreground">{chat.userId}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm">{chat.topic}</TableCell>
                <TableCell className="text-center text-sm">{chat.messageCount}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{chat.lastActivity}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusColors[chat.status]}>
                    {chat.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl max-h-[80vh]">
                      <DialogHeader>
                        <DialogTitle>Chat Session Details</DialogTitle>
                        <DialogDescription>
                          {chat.userName} - {chat.topic}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-4 rounded-lg bg-muted p-4">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Started</p>
                            <p className="text-sm font-mono">{chat.startTime}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Messages</p>
                            <p className="text-sm font-semibold">{chat.messageCount}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Status</p>
                            <Badge variant="outline" className={statusColors[chat.status]}>
                              {chat.status}
                            </Badge>
                          </div>
                        </div>

                        <ScrollArea className="h-[400px] rounded-lg border border-border p-4">
                          <div className="space-y-4">
                            {chat.messages.map((message, idx) => (
                              <div
                                key={idx}
                                className={`flex gap-3 ${message.role === "assistant" ? "flex-row" : "flex-row-reverse"}`}
                              >
                                <Avatar className="h-8 w-8 shrink-0">
                                  <AvatarFallback className="text-xs">
                                    {message.role === "user" ? "U" : "AI"}
                                  </AvatarFallback>
                                </Avatar>
                                <div
                                  className={`flex-1 rounded-lg p-3 ${
                                    message.role === "assistant"
                                      ? "bg-muted text-foreground"
                                      : "bg-primary text-primary-foreground"
                                  }`}
                                >
                                  <p className="text-sm">{message.content}</p>
                                  <p className="mt-1 text-xs opacity-70">{message.timestamp}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-6 py-4">
        <p className="text-sm text-muted-foreground">
          Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, mockChats.length)} of{" "}
          {mockChats.length} chats
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={currentPage === page ? "default" : "outline"}
                size="sm"
                onClick={() => setCurrentPage(page)}
                className="w-8"
              >
                {page}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
