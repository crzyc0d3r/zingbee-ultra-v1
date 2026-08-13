"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Activity, XCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"

type SessionType = "learning" | "chat" | "assessment"

interface Session {
  id: string
  userId: string
  userName: string
  type: SessionType
  startTime: string
  duration: string
  activity: number
  currentModule: string
  ipAddress: string
  device: string
  location: string
}

const mockSessions: Session[] = [
  {
    id: "sess_001",
    userId: "user_123",
    userName: "John Doe",
    type: "learning",
    startTime: "2025-01-17 14:30:00",
    duration: "15m 23s",
    activity: 85,
    currentModule: "Introduction to Machine Learning",
    ipAddress: "192.168.1.1",
    device: "Chrome on Windows",
    location: "New York, USA",
  },
  {
    id: "sess_002",
    userId: "user_456",
    userName: "Jane Smith",
    type: "chat",
    startTime: "2025-01-17 14:25:00",
    duration: "20m 45s",
    activity: 92,
    currentModule: "Python Basics - Variables",
    ipAddress: "192.168.1.2",
    device: "Safari on macOS",
    location: "San Francisco, USA",
  },
  {
    id: "sess_003",
    userId: "user_789",
    userName: "Bob Johnson",
    type: "assessment",
    startTime: "2025-01-17 14:20:00",
    duration: "25m 12s",
    activity: 78,
    currentModule: "Neural Networks Quiz",
    ipAddress: "192.168.1.3",
    device: "Firefox on Linux",
    location: "London, UK",
  },
  {
    id: "sess_004",
    userId: "user_234",
    userName: "Alice Williams",
    type: "learning",
    startTime: "2025-01-17 14:15:00",
    duration: "30m 08s",
    activity: 95,
    currentModule: "Data Structures - Arrays",
    ipAddress: "192.168.1.4",
    device: "Chrome on Android",
    location: "Toronto, Canada",
  },
  {
    id: "sess_005",
    userId: "user_567",
    userName: "Charlie Brown",
    type: "chat",
    startTime: "2025-01-17 14:10:00",
    duration: "35m 42s",
    activity: 88,
    currentModule: "Algorithms - Sorting",
    ipAddress: "192.168.1.5",
    device: "Edge on Windows",
    location: "Sydney, Australia",
  },
]

const typeColors: Record<SessionType, string> = {
  learning: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  chat: "bg-green-500/10 text-green-500 border-green-500/20",
  assessment: "bg-purple-500/10 text-purple-500 border-purple-500/20",
}

export function SessionsTable() {
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const totalPages = Math.ceil(mockSessions.length / itemsPerPage)

  const paginatedSessions = mockSessions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <Card>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Session ID</TableHead>
              <TableHead className="w-[180px]">User</TableHead>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead>Current Module</TableHead>
              <TableHead className="w-[120px]">Duration</TableHead>
              <TableHead className="w-[120px]">Activity</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedSessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{session.id}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {session.userName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{session.userName}</p>
                      <p className="text-xs text-muted-foreground">{session.userId}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={typeColors[session.type]}>
                    {session.type}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm">{session.currentModule}</TableCell>
                <TableCell className="font-mono text-sm">{session.duration}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Activity</span>
                      <span className="font-medium">{session.activity}%</span>
                    </div>
                    <Progress value={session.activity} className="h-2" />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <Activity className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Session Details</DialogTitle>
                          <DialogDescription>Real-time session information for {session.userName}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-6">
                          <div className="flex items-center gap-4">
                            <Avatar className="h-12 w-12">
                              <AvatarFallback>
                                {session.userName
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h3 className="text-lg font-semibold">{session.userName}</h3>
                              <p className="text-sm text-muted-foreground">{session.userId}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-muted-foreground">Session ID</p>
                              <p className="text-sm font-mono">{session.id}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-muted-foreground">Type</p>
                              <Badge variant="outline" className={typeColors[session.type]}>
                                {session.type}
                              </Badge>
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-muted-foreground">Start Time</p>
                              <p className="text-sm">{session.startTime}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-muted-foreground">Duration</p>
                              <p className="text-sm font-mono">{session.duration}</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">Current Module</p>
                            <p className="text-sm">{session.currentModule}</p>
                          </div>

                          <div className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">Activity Level</p>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <span>User engagement and interaction</span>
                                <span className="font-semibold">{session.activity}%</span>
                              </div>
                              <Progress value={session.activity} className="h-3" />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">Connection Details</p>
                            <div className="rounded-lg border border-border p-4 space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">IP Address</span>
                                <span className="font-mono">{session.ipAddress}</span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Device</span>
                                <span>{session.device}</span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Location</span>
                                <span>{session.location}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-6 py-4">
        <p className="text-sm text-muted-foreground">
          Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, mockSessions.length)}{" "}
          of {mockSessions.length} sessions
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
