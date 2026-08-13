"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { Textarea } from "@/components/shared/ui/textarea"
import { DashboardHeader } from "@/components/quests/dashboard-header"
import { FolderOpen, Trash2, Calendar, FileText, Plus, X, Edit2, Check, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiClient, Project } from "@/lib/api-client"
import { useStudent } from "@/hooks/use-student"

export default function MyProjectsPage() {
  const t = useTranslations()
  const router = useRouter()
  const { student, loading: studentLoading } = useStudent()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [newProjectDescription, setNewProjectDescription] = useState("")
  const [creating, setCreating] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const loadProjects = async () => {
      if (!student?.id) return
      try {
        const data = await apiClient.projects.list(student.id)
        setProjects(data)
      } catch (e) {
        console.error("Failed to load projects", e)
      } finally {
        setLoading(false)
      }
    }
    if (student?.id) {
      loadProjects()
    }
  }, [student?.id])

  const handleCreateProject = async () => {
    if (!student?.id || !newProjectName.trim()) return
    setCreating(true)
    try {
      const project = await apiClient.projects.create({
        student_id: student.id,
        name: newProjectName.trim(),
        description: newProjectDescription.trim() || undefined,
      })
      setProjects([project, ...projects])
      setShowCreateDialog(false)
      setNewProjectName("")
      setNewProjectDescription("")
    } catch (e) {
      console.error("Failed to create project", e)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    setDeleting(true)
    try {
      await apiClient.projects.delete(projectId)
      setProjects(projects.filter(p => p.id !== projectId))
      setDeleteConfirmId(null)
    } catch (e) {
      console.error("Failed to delete project", e)
    } finally {
      setDeleting(false)
    }
  }

  if (studentLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-slate-50 to-purple-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-slate-50 to-purple-50">
      <DashboardHeader />

      <div className="container mx-auto p-6 max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-8">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <FolderOpen className="w-10 h-10" />
                  <h1 className="text-3xl font-medium">{t("projects.list.title")}</h1>
                </div>
                <p className="text-lg opacity-90">{t("projects.list.subtitle")}</p>
              </div>
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-slate-900 text-white hover:bg-slate-800"
              >
                <Plus className="w-5 h-5 mr-2" />
                {t("buttons.newProject")}
              </Button>
            </div>
          </div>
        </div>

        {/* Create Project Dialog */}
        {showCreateDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md mx-4">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-medium text-slate-900">{t("projects.create.title")}</h2>
                  <Button variant="ghost" size="sm" onClick={() => setShowCreateDialog(false)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t("projects.create.projectName")}</label>
                    <Input
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder={t("projects.create.projectNamePlaceholder")}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t("projects.create.description")}</label>
                    <Textarea
                      value={newProjectDescription}
                      onChange={(e) => setNewProjectDescription(e.target.value)}
                      placeholder={t("projects.create.descriptionPlaceholder")}
                      rows={3}
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                      {t("buttons.cancel")}
                    </Button>
                    <Button
                      onClick={handleCreateProject}
                      disabled={!newProjectName.trim() || creating}
                      className="bg-slate-900 hover:bg-slate-800"
                    >
                      {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      {t("projects.create.createButton")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-sm mx-4">
              <CardContent className="p-6">
                <h2 className="text-xl font-medium text-slate-900 mb-3">{t("projects.delete.title")}</h2>
                <p className="text-slate-600 mb-6">
                  {t("projects.delete.projectWarning")}
                </p>
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setDeleteConfirmId(null)} disabled={deleting}>
                    {t("buttons.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleDeleteProject(deleteConfirmId)}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {t("buttons.delete")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <Card className="border border-slate-200">
            <CardContent className="p-12 text-center">
              <FolderOpen className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <h3 className="text-xl font-medium text-slate-900 mb-2">{t("projects.list.noProjectsTitle")}</h3>
              <p className="text-slate-600 mb-4">
                {t("projects.list.noProjectsDescription")}
              </p>
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-slate-900 hover:bg-slate-800"
              >
                <Plus className="w-5 h-5 mr-2" />
                {t("projects.list.createFirstProject")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all cursor-pointer group"
                onClick={() => router.push(`/quests/my-projects/${project.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-200 flex items-center justify-center">
                        <FolderOpen className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-slate-900 group-hover:text-slate-700 transition-colors">
                          {project.name}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Calendar className="w-3 h-3" />
                          {new Date(project.created_at).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        setDeleteConfirmId(project.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  {project.description && (
                    <p className="text-sm text-slate-600 line-clamp-2 mb-3">{project.description}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <FileText className="w-3 h-3" />
                    {project.file_count || 0} {(project.file_count || 0) !== 1 ? t("projects.list.files") : t("projects.list.file")}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
