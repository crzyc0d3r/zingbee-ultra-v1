"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Eye } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

type LogLevel = "info" | "warning" | "error" | "debug"

interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  source: string
  userId?: string
  details?: string
}

const mockLogs: LogEntry[] = [
  {
    id: "1",
    timestamp: "2025-01-17 14:32:15",
    level: "info",
    message: "User authentication successful",
    source: "auth-service",
    userId: "user_123",
    details: "User logged in from IP 192.168.1.1",
  },
  {
    id: "2",
    timestamp: "2025-01-17 14:31:42",
    level: "error",
    message: "Database connection timeout",
    source: "db-service",
    details: "Connection to primary database failed after 30s timeout",
  },
  {
    id: "3",
    timestamp: "2025-01-17 14:30:18",
    level: "warning",
    message: "High memory usage detected",
    source: "system-monitor",
    details: "Memory usage at 85%, consider scaling",
  },
  {
    id: "4",
    timestamp: "2025-01-17 14:29:55",
    level: "info",
    message: "Chat session started",
    source: "chat-service",
    userId: "user_456",
    details: "New chat session initiated for curriculum module 3",
  },
  {
    id: "5",
    timestamp: "2025-01-17 14:28:33",
    level: "debug",
    message: "API request processed",
    source: "api-gateway",
    details: "GET /api/users - 200 OK - 45ms",
  },
  {
    id: "6",
    timestamp: "2025-01-17 14:27:12",
    level: "error",
    message: "Failed to send notification",
    source: "notification-service",
    userId: "user_789",
    details: "Email delivery failed: SMTP connection refused",
  },
  {
    id: "7",
    timestamp: "2025-01-17 14:26:48",
    level: "info",
    message: "Lesson completed",
    source: "curriculum-service",
    userId: "user_123",
    details: "User completed lesson 'Introduction to AI' with 95% score",
  },
  {
    id: "8",
    timestamp: "2025-01-17 14:25:21",
    level: "warning",
    message: "Rate limit approaching",
    source: "api-gateway",
    userId: "user_456",
    details: "User has made 450/500 requests in the current hour",
  },
]

const levelColors: Record<LogLevel, string> = {
  info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  error: "bg-red-500/10 text-red-500 border-red-500/20",
  debug: "bg-gray-500/10 text-gray-500 border-gray-500/20",
}

export function LogsTable() {
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const totalPages = Math.ceil(mockLogs.length / itemsPerPage)

  const paginatedLogs = mockLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <Card>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead className="w-[100px]">Level</TableHead>
              <TableHead className="w-[150px]">Source</TableHead>
              <TableHead>Message</TableHead>
              <TableHead className="w-[120px]">User ID</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedLogs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{log.timestamp}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={levelColors[log.level]}>
                    {log.level.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium text-sm">{log.source}</TableCell>
                <TableCell className="max-w-md truncate text-sm">{log.message}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{log.userId || "-"}</TableCell>
                <TableCell className="text-right">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Log Details</DialogTitle>
                        <DialogDescription>Complete information for this log entry</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">Timestamp</p>
                            <p className="font-mono text-sm">{log.timestamp}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">Level</p>
                            <Badge variant="outline" className={levelColors[log.level]}>
                              {log.level.toUpperCase()}
                            </Badge>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">Source</p>
                            <p className="text-sm">{log.source}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">User ID</p>
                            <p className="font-mono text-sm">{log.userId || "N/A"}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground mb-2">Message</p>
                          <p className="text-sm">{log.message}</p>
                        </div>
                        {log.details && (
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-2">Details</p>
                            <p className="text-sm text-muted-foreground">{log.details}</p>
                          </div>
                        )}
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
          Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, mockLogs.length)} of{" "}
          {mockLogs.length} logs
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
