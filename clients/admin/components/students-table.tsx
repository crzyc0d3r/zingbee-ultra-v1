"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MoreVertical, Eye, MessageSquare, TrendingUp, BookOpenCheck } from "lucide-react"
import { StudentProgressPortal } from "@/components/student-progress-portal"

const mockStudents = [
  {
    id: 1,
    name: "Emma Johnson",
    email: "emma.j@lincolnhs.edu",
    school: "Lincoln High School",
    grade: 10,
    progress: 87,
    lastActive: "2 hours ago",
    totalSessions: 45,
    avgScore: 92,
    status: "active",
  },
  {
    id: 2,
    name: "Liam Smith",
    email: "liam.s@washingtonelem.edu",
    school: "Washington Elementary",
    grade: 6,
    progress: 64,
    lastActive: "1 day ago",
    totalSessions: 32,
    avgScore: 78,
    status: "active",
  },
  {
    id: 3,
    name: "Olivia Brown",
    email: "olivia.b@rooseveltms.edu",
    school: "Roosevelt Middle School",
    grade: 8,
    progress: 92,
    lastActive: "30 minutes ago",
    totalSessions: 67,
    avgScore: 95,
    status: "active",
  },
  {
    id: 4,
    name: "Noah Davis",
    email: "noah.d@jeffersonacademy.edu",
    school: "Jefferson Academy",
    grade: 11,
    progress: 45,
    lastActive: "5 days ago",
    totalSessions: 18,
    avgScore: 68,
    status: "inactive",
  },
  {
    id: 5,
    name: "Ava Wilson",
    email: "ava.w@lincolnhs.edu",
    school: "Lincoln High School",
    grade: 9,
    progress: 78,
    lastActive: "4 hours ago",
    totalSessions: 52,
    avgScore: 88,
    status: "active",
  },
]

export function StudentsTable() {
  const [selectedStudent, setSelectedStudent] = useState<any>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showProgressPortal, setShowProgressPortal] = useState(false)

  return (
    <>
      <div className="rounded-lg border border-card bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-muted/50">
              <TableHead className="text-muted-foreground">Student Name</TableHead>
              <TableHead className="text-muted-foreground">School</TableHead>
              <TableHead className="text-muted-foreground">Grade</TableHead>
              <TableHead className="text-muted-foreground">Progress</TableHead>
              <TableHead className="text-muted-foreground">Avg Score</TableHead>
              <TableHead className="text-muted-foreground">Sessions</TableHead>
              <TableHead className="text-muted-foreground">Last Active</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-right text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockStudents.map((student) => (
              <TableRow key={student.id} className="border-border hover:bg-muted/50">
                <TableCell>
                  <div>
                    <p className="font-medium text-foreground">{student.name}</p>
                    <p className="text-sm text-muted-foreground">{student.email}</p>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{student.school}</TableCell>
                <TableCell className="text-foreground">{student.grade}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${student.progress}%` }} />
                    </div>
                    <span className="text-sm text-muted-foreground">{student.progress}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-foreground">{student.avgScore}%</TableCell>
                <TableCell className="text-foreground">{student.totalSessions}</TableCell>
                <TableCell className="text-muted-foreground">{student.lastActive}</TableCell>
                <TableCell>
                  <Badge variant={student.status === "active" ? "default" : "outline"}>{student.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedStudent(student)
                          setShowDetails(true)
                        }}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View Profile
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <MessageSquare className="mr-2 h-4 w-4" />
                        View Chats
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedStudent(student)
                          setShowProgressPortal(true)
                        }}
                      >
                        <BookOpenCheck className="mr-2 h-4 w-4" />
                        Progress Portal
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <TrendingUp className="mr-2 h-4 w-4" />
                        View Progress
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedStudent?.name}</DialogTitle>
            <DialogDescription>Student profile and learning statistics</DialogDescription>
          </DialogHeader>
          {selectedStudent && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Email</p>
                  <p className="text-foreground">{selectedStudent.email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">School</p>
                  <p className="text-foreground">{selectedStudent.school}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Grade</p>
                  <p className="text-foreground">{selectedStudent.grade}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <Badge variant={selectedStudent.status === "active" ? "default" : "outline"}>
                    {selectedStudent.status}
                  </Badge>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">Overall Progress</p>
                  <div className="flex items-center gap-2">
                    <div className="h-3 flex-1 rounded-full bg-muted">
                      <div className="h-3 rounded-full bg-primary" style={{ width: `${selectedStudent.progress}%` }} />
                    </div>
                    <span className="text-sm font-medium text-foreground">{selectedStudent.progress}%</span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-lg border border-card bg-card p-4">
                    <p className="text-sm text-muted-foreground">Total Sessions</p>
                    <p className="text-2xl font-bold text-foreground">{selectedStudent.totalSessions}</p>
                  </div>
                  <div className="rounded-lg border border-card bg-card p-4">
                    <p className="text-sm text-muted-foreground">Average Score</p>
                    <p className="text-2xl font-bold text-foreground">{selectedStudent.avgScore}%</p>
                  </div>
                  <div className="rounded-lg border border-card bg-card p-4">
                    <p className="text-sm text-muted-foreground">Last Active</p>
                    <p className="text-lg font-bold text-foreground">{selectedStudent.lastActive}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Progress Portal Dialog */}
      <Dialog open={showProgressPortal} onOpenChange={setShowProgressPortal}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Student Progress Portal</DialogTitle>
            <DialogDescription>Detailed curriculum progress across all subjects</DialogDescription>
          </DialogHeader>
          {selectedStudent && (
            <StudentProgressPortal
              student={selectedStudent}
              onClose={() => setShowProgressPortal(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
