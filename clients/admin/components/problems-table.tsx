"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, MoreVertical, Eye, Edit, CheckCircle2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

type ProblemStatus = "open" | "in-progress" | "resolved" | "closed"
type ProblemPriority = "critical" | "high" | "medium" | "low"
type ProblemCategory = "technical" | "content" | "user-account" | "performance"

interface Problem {
  id: string
  title: string
  description: string
  status: ProblemStatus
  priority: ProblemPriority
  category: ProblemCategory
  reportedBy: string
  reportedAt: string
  assignedTo?: string
  lastUpdated: string
}

const mockProblems: Problem[] = [
  {
    id: "PROB-001",
    title: "Chat session not loading for user",
    description: "User reports that chat interface freezes when trying to start a new session",
    status: "open",
    priority: "critical",
    category: "technical",
    reportedBy: "john.doe@example.com",
    reportedAt: "2025-01-17 14:30",
    lastUpdated: "2025-01-17 14:30",
  },
  {
    id: "PROB-002",
    title: "Incorrect lesson progress calculation",
    description: "Progress bar shows 100% but user has not completed all lessons",
    status: "in-progress",
    priority: "high",
    category: "technical",
    reportedBy: "jane.smith@example.com",
    reportedAt: "2025-01-17 10:15",
    assignedTo: "Admin Team",
    lastUpdated: "2025-01-17 13:20",
  },
  {
    id: "PROB-003",
    title: "Math module content error",
    description: "Algebra lesson 5 contains incorrect formula in example 3",
    status: "in-progress",
    priority: "medium",
    category: "content",
    reportedBy: "bob.johnson@example.com",
    reportedAt: "2025-01-16 16:45",
    assignedTo: "Content Team",
    lastUpdated: "2025-01-17 09:00",
  },
  {
    id: "PROB-004",
    title: "Unable to reset password",
    description: "Password reset email not being received by users",
    status: "resolved",
    priority: "high",
    category: "user-account",
    reportedBy: "alice.williams@example.com",
    reportedAt: "2025-01-15 11:20",
    assignedTo: "Tech Team",
    lastUpdated: "2025-01-16 14:30",
  },
  {
    id: "PROB-005",
    title: "Slow page load times",
    description: "Dashboard takes 10+ seconds to load during peak hours",
    status: "open",
    priority: "medium",
    category: "performance",
    reportedBy: "charlie.brown@example.com",
    reportedAt: "2025-01-17 08:00",
    lastUpdated: "2025-01-17 08:00",
  },
]

const statusColors: Record<ProblemStatus, string> = {
  open: "bg-red-500/10 text-red-500 border-red-500/20",
  "in-progress": "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  resolved: "bg-green-500/10 text-green-500 border-green-500/20",
  closed: "bg-gray-500/10 text-gray-500 border-gray-500/20",
}

const priorityColors: Record<ProblemPriority, string> = {
  critical: "bg-red-500/10 text-red-500 border-red-500/20",
  high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
}

export function ProblemsTable() {
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const totalPages = Math.ceil(mockProblems.length / itemsPerPage)

  const paginatedProblems = mockProblems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  return (
    <Card>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">ID</TableHead>
              <TableHead className="w-[300px]">Title</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[100px]">Priority</TableHead>
              <TableHead className="w-[120px]">Category</TableHead>
              <TableHead className="w-[180px]">Reported At</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedProblems.map((problem) => (
              <TableRow key={problem.id}>
                <TableCell className="font-mono text-xs">{problem.id}</TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{problem.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{problem.description}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusColors[problem.status]}>
                    {problem.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={priorityColors[problem.priority]}>
                    {problem.priority}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm capitalize">{problem.category.replace("-", " ")}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{problem.reportedAt}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <Dialog>
                        <DialogTrigger asChild>
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>Problem Details</DialogTitle>
                            <DialogDescription>{problem.id}</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <h3 className="text-lg font-semibold">{problem.title}</h3>
                              <p className="text-sm text-muted-foreground mt-1">{problem.description}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Status</p>
                                <Badge variant="outline" className={statusColors[problem.status]}>
                                  {problem.status}
                                </Badge>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Priority</p>
                                <Badge variant="outline" className={priorityColors[problem.priority]}>
                                  {problem.priority}
                                </Badge>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Category</p>
                                <p className="text-sm capitalize">{problem.category.replace("-", " ")}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Reported By</p>
                                <p className="text-sm">{problem.reportedBy}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Reported At</p>
                                <p className="text-sm">{problem.reportedAt}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
                                <p className="text-sm">{problem.lastUpdated}</p>
                              </div>
                            </div>

                            {problem.assignedTo && (
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Assigned To</p>
                                <p className="text-sm">{problem.assignedTo}</p>
                              </div>
                            )}

                            <div className="space-y-2">
                              <Label>Add Note</Label>
                              <Textarea placeholder="Add investigation notes or updates..." rows={3} />
                              <Button size="sm">Add Note</Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <DropdownMenuItem>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Problem
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Mark as Resolved
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-6 py-4">
        <p className="text-sm text-muted-foreground">
          Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, mockProblems.length)}{" "}
          of {mockProblems.length} problems
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
