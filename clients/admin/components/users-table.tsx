"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, MoreVertical, Eye, Edit, Ban, Trash2 } from "lucide-react"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type UserRole = "student" | "instructor" | "admin"
type UserStatus = "active" | "inactive" | "suspended"

interface User {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  joinDate: string
  lastActive: string
  lessonsCompleted: number
  totalLessons: number
  progress: number
}

const mockUsers: User[] = [
  {
    id: "user_123",
    name: "John Doe",
    email: "john.doe@example.com",
    role: "student",
    status: "active",
    joinDate: "2024-12-15",
    lastActive: "2025-01-17 14:30",
    lessonsCompleted: 24,
    totalLessons: 30,
    progress: 80,
  },
  {
    id: "user_456",
    name: "Jane Smith",
    email: "jane.smith@example.com",
    role: "instructor",
    status: "active",
    joinDate: "2024-11-20",
    lastActive: "2025-01-17 13:15",
    lessonsCompleted: 45,
    totalLessons: 50,
    progress: 90,
  },
  {
    id: "user_789",
    name: "Bob Johnson",
    email: "bob.johnson@example.com",
    role: "student",
    status: "active",
    joinDate: "2025-01-10",
    lastActive: "2025-01-17 15:00",
    lessonsCompleted: 5,
    totalLessons: 30,
    progress: 17,
  },
  {
    id: "user_234",
    name: "Alice Williams",
    email: "alice.williams@example.com",
    role: "student",
    status: "inactive",
    joinDate: "2024-10-05",
    lastActive: "2024-12-20 10:30",
    lessonsCompleted: 12,
    totalLessons: 30,
    progress: 40,
  },
  {
    id: "user_567",
    name: "Charlie Brown",
    email: "charlie.brown@example.com",
    role: "admin",
    status: "active",
    joinDate: "2024-09-01",
    lastActive: "2025-01-17 11:30",
    lessonsCompleted: 30,
    totalLessons: 30,
    progress: 100,
  },
  {
    id: "user_890",
    name: "Diana Prince",
    email: "diana.prince@example.com",
    role: "student",
    status: "suspended",
    joinDate: "2024-11-15",
    lastActive: "2025-01-05 09:15",
    lessonsCompleted: 8,
    totalLessons: 30,
    progress: 27,
  },
]

const roleColors: Record<UserRole, string> = {
  student: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  instructor: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  admin: "bg-orange-500/10 text-orange-500 border-orange-500/20",
}

const statusColors: Record<UserStatus, string> = {
  active: "bg-green-500/10 text-green-500 border-green-500/20",
  inactive: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  suspended: "bg-red-500/10 text-red-500 border-red-500/20",
}

export function UsersTable() {
  const [currentPage, setCurrentPage] = useState(1)
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null)
  const itemsPerPage = 10
  const totalPages = Math.ceil(mockUsers.length / itemsPerPage)

  const paginatedUsers = mockUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const handleDeleteUser = (userId: string) => {
    console.log("[v0] Deleting user:", userId)
    // TODO: Implement actual user deletion logic
    setDeleteUserId(null)
  }

  return (
    <>
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">User</TableHead>
                <TableHead className="w-[100px]">Role</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[120px]">Join Date</TableHead>
                <TableHead className="w-[180px]">Last Active</TableHead>
                <TableHead className="w-[150px]">Progress</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback>
                          {user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={roleColors[user.role]}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColors[user.status]}>
                      {user.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{user.joinDate}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{user.lastActive}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {user.lessonsCompleted}/{user.totalLessons}
                        </span>
                        <span className="font-medium">{user.progress}%</span>
                      </div>
                      <Progress value={user.progress} className="h-2" />
                    </div>
                  </TableCell>
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
                              <DialogTitle>User Details</DialogTitle>
                              <DialogDescription>Complete information for {user.name}</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-6">
                              <div className="flex items-center gap-4">
                                <Avatar className="h-16 w-16">
                                  <AvatarFallback className="text-lg">
                                    {user.name
                                      .split(" ")
                                      .map((n) => n[0])
                                      .join("")}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <h3 className="text-xl font-semibold">{user.name}</h3>
                                  <p className="text-sm text-muted-foreground">{user.email}</p>
                                  <p className="text-xs text-muted-foreground font-mono mt-1">{user.id}</p>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-muted-foreground">Role</p>
                                  <Badge variant="outline" className={roleColors[user.role]}>
                                    {user.role}
                                  </Badge>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                                  <Badge variant="outline" className={statusColors[user.status]}>
                                    {user.status}
                                  </Badge>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-muted-foreground">Join Date</p>
                                  <p className="text-sm">{user.joinDate}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-muted-foreground">Last Active</p>
                                  <p className="text-sm">{user.lastActive}</p>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <p className="text-sm font-medium text-muted-foreground">Learning Progress</p>
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between text-sm">
                                    <span>
                                      {user.lessonsCompleted} of {user.totalLessons} lessons completed
                                    </span>
                                    <span className="font-semibold">{user.progress}%</span>
                                  </div>
                                  <Progress value={user.progress} className="h-3" />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <p className="text-sm font-medium text-muted-foreground">Recent Activity</p>
                                <div className="rounded-lg border border-border p-4 space-y-2">
                                  <div className="flex items-center justify-between text-sm">
                                    <span>Total Chat Sessions</span>
                                    <span className="font-medium">42</span>
                                  </div>
                                  <div className="flex items-center justify-between text-sm">
                                    <span>Average Session Duration</span>
                                    <span className="font-medium">18 min</span>
                                  </div>
                                  <div className="flex items-center justify-between text-sm">
                                    <span>Completion Rate</span>
                                    <span className="font-medium">87%</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <DropdownMenuItem>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit User
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">
                          <Ban className="mr-2 h-4 w-4" />
                          Suspend User
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteUserId(user.id)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete User
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
            Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, mockUsers.length)}{" "}
            of {mockUsers.length} users
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

      <AlertDialog open={!!deleteUserId} onOpenChange={() => setDeleteUserId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the user account and remove all associated data
              from the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteUserId && handleDeleteUser(deleteUserId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
