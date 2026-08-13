"use client"

import { useSearchParams } from "next/navigation"

import { useState } from "react"
import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminHeader } from "@/components/admin-header"

import { StudentProgressPortal } from "@/components/student-progress-portal"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  GraduationCap,
  TrendingUp,
  Search,
  ChevronRight,
  User,
} from "lucide-react"

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
  {
    id: 6,
    name: "Sophia Martinez",
    email: "sophia.m@rooseveltms.edu",
    school: "Roosevelt Middle School",
    grade: 7,
    progress: 81,
    lastActive: "1 hour ago",
    totalSessions: 58,
    avgScore: 86,
    status: "active",
  },
  {
    id: 7,
    name: "James Anderson",
    email: "james.a@lincolnhs.edu",
    school: "Lincoln High School",
    grade: 12,
    progress: 94,
    lastActive: "3 hours ago",
    totalSessions: 89,
    avgScore: 97,
    status: "active",
  },
  {
    id: 8,
    name: "Mia Thompson",
    email: "mia.t@washingtonelem.edu",
    school: "Washington Elementary",
    grade: 5,
    progress: 56,
    lastActive: "2 days ago",
    totalSessions: 24,
    avgScore: 72,
    status: "active",
  },
]

export default function StudentsPage() {
  const [selectedStudent, setSelectedStudent] = useState<typeof mockStudents[0] | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const filteredStudents = mockStudents.filter(
    (student) =>
      student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      student.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      student.school.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-hidden bg-background">
          <div className="flex h-full">
            {/* Students List Panel */}
            <div className="flex w-80 flex-col border-r border-border">
              <div className="border-b border-border p-4">
                <h1 className="text-xl font-bold text-foreground">Students</h1>
                <p className="text-sm text-muted-foreground">Select a student to view progress</p>
              </div>

              {/* Stats Summary */}
              <div className="grid grid-cols-2 gap-2 border-b border-border p-3">
                <div className="rounded-lg bg-muted/50 p-2">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Total</span>
                  </div>
                  <p className="text-lg font-bold text-foreground">3,847</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-500" />
                    <span className="text-xs text-muted-foreground">Active</span>
                  </div>
                  <p className="text-lg font-bold text-foreground">1,234</p>
                </div>
              </div>

              {/* Search */}
              <div className="border-b border-border p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search students..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Student List */}
              <ScrollArea className="flex-1">
                <div className="p-2">
                  {filteredStudents.map((student) => (
                    <button
                      key={student.id}
                      onClick={() => setSelectedStudent(student)}
                      className={`mb-1 w-full rounded-lg p-3 text-left transition-all ${
                        selectedStudent?.id === student.id
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-muted/50 border border-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                            selectedStudent?.id === student.id ? "bg-primary/20" : "bg-muted"
                          }`}>
                            <User className={`h-5 w-5 ${
                              selectedStudent?.id === student.id ? "text-primary" : "text-muted-foreground"
                            }`} />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{student.name}</p>
                            <p className="text-xs text-muted-foreground">{student.school}</p>
                          </div>
                        </div>
                        <ChevronRight className={`h-4 w-4 ${
                          selectedStudent?.id === student.id ? "text-primary" : "text-muted-foreground"
                        }`} />
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 w-16 rounded-full bg-muted">
                            <div
                              className="h-1.5 rounded-full bg-primary"
                              style={{ width: `${student.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{student.progress}%</span>
                        </div>
                        <Badge
                          variant={student.status === "active" ? "default" : "outline"}
                          className="text-xs h-5"
                        >
                          {student.status}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Progress Portal Panel */}
            <div className="flex-1 overflow-y-auto">
              {selectedStudent ? (
                <div className="p-6">
                  <StudentProgressPortal student={selectedStudent} />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6">
                  <div className="rounded-full bg-muted p-6 mb-4">
                    <GraduationCap className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground mb-2">Select a Student</h2>
                  <p className="text-muted-foreground text-center max-w-md">
                    Choose a student from the list to view their detailed progress across Biology, Math, Islamic Studies, and Language curriculum themes.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
