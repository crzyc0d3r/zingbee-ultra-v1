"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MoreVertical, Eye, Edit, Trash2 } from "lucide-react"

const mockSchools = [
  {
    id: 1,
    name: "Lincoln High School",
    district: "Central District",
    students: 342,
    status: "active",
    plan: "premium",
    engagement: 87,
    joinedDate: "2024-01-15",
    contact: "admin@lincolnhs.edu",
  },
  {
    id: 2,
    name: "Washington Elementary",
    district: "North District",
    students: 156,
    status: "active",
    plan: "basic",
    engagement: 92,
    joinedDate: "2024-02-20",
    contact: "principal@washingtonelem.edu",
  },
  {
    id: 3,
    name: "Roosevelt Middle School",
    district: "East District",
    students: 289,
    status: "trial",
    plan: "trial",
    engagement: 78,
    joinedDate: "2024-11-01",
    contact: "admin@rooseveltms.edu",
  },
  {
    id: 4,
    name: "Jefferson Academy",
    district: "South District",
    students: 421,
    status: "active",
    plan: "enterprise",
    engagement: 94,
    joinedDate: "2023-09-10",
    contact: "director@jeffersonacademy.edu",
  },
  {
    id: 5,
    name: "Madison Charter School",
    district: "West District",
    students: 198,
    status: "inactive",
    plan: "basic",
    engagement: 45,
    joinedDate: "2024-03-12",
    contact: "info@madisoncharter.edu",
  },
]

export function SchoolsTable() {
  const [selectedSchool, setSelectedSchool] = useState<any>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  return (
    <>
      <div className="rounded-lg border border-card bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-muted/50">
              <TableHead className="text-muted-foreground">School Name</TableHead>
              <TableHead className="text-muted-foreground">District</TableHead>
              <TableHead className="text-muted-foreground">Students</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Plan</TableHead>
              <TableHead className="text-muted-foreground">Engagement</TableHead>
              <TableHead className="text-muted-foreground">Joined</TableHead>
              <TableHead className="text-right text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockSchools.map((school) => (
              <TableRow key={school.id} className="border-border hover:bg-muted/50">
                <TableCell className="font-medium text-foreground">{school.name}</TableCell>
                <TableCell className="text-muted-foreground">{school.district}</TableCell>
                <TableCell className="text-foreground">{school.students}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      school.status === "active" ? "default" : school.status === "trial" ? "secondary" : "outline"
                    }
                  >
                    {school.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{school.plan}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${school.engagement}%` }} />
                    </div>
                    <span className="text-sm text-muted-foreground">{school.engagement}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{school.joinedDate}</TableCell>
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
                          setSelectedSchool(school)
                          setShowDetails(true)
                        }}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit School
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          setSelectedSchool(school)
                          setShowDelete(true)
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete School
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
            <DialogTitle>{selectedSchool?.name}</DialogTitle>
            <DialogDescription>School details and statistics</DialogDescription>
          </DialogHeader>
          {selectedSchool && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">District</p>
                  <p className="text-foreground">{selectedSchool.district}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Contact Email</p>
                  <p className="text-foreground">{selectedSchool.contact}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Students</p>
                  <p className="text-foreground">{selectedSchool.students}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Joined Date</p>
                  <p className="text-foreground">{selectedSchool.joinedDate}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <Badge
                    variant={
                      selectedSchool.status === "active"
                        ? "default"
                        : selectedSchool.status === "trial"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {selectedSchool.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Plan</p>
                  <Badge variant="outline">{selectedSchool.plan}</Badge>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">Engagement Rate</p>
                <div className="flex items-center gap-2">
                  <div className="h-3 flex-1 rounded-full bg-muted">
                    <div className="h-3 rounded-full bg-primary" style={{ width: `${selectedSchool.engagement}%` }} />
                  </div>
                  <span className="text-sm font-medium text-foreground">{selectedSchool.engagement}%</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetails(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete School</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedSchool?.name}? This action cannot be undone and will affect{" "}
              {selectedSchool?.students} students.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowDelete(false)
                setSelectedSchool(null)
              }}
            >
              Delete School
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
