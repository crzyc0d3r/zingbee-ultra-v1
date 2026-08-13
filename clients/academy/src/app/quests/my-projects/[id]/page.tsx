"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { Textarea } from "@/components/shared/ui/textarea"
import { DashboardHeader } from "@/components/quests/dashboard-header"
import {
  FolderOpen, Upload, Trash2, FileText, File, CheckCircle2,
  AlertCircle, Loader2, MessageSquare, Edit2, Check, X
} from "lucide-react"
import { apiClient, Project, ProjectFile } from "@/lib/api-client"

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [tempName, setTempName] = useState("")
  const [tempDescription, setTempDescription] = useState("")
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadProject = useCallback(async () => {
    try {
      const [projectData, filesData] = await Promise.all([
        apiClient.projects.get(projectId),
        apiClient.projects.listFiles(projectId),
      ])
      setProject(projectData)
      setFiles(filesData)
      setTempName(projectData.name)
      setTempDescription(projectData.description || "")
    } catch (e) {
      console.error("Failed to load project", e)
      router.push("/quests/my-projects")
    } finally {
      setLoading(false)
    }
  }, [projectId, router])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  const handleFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return

    setUploading(true)
    try {
      for (const file of Array.from(fileList)) {
        const uploadedFile = await apiClient.projects.uploadFile(projectId, file)
        setFiles((prev) => [uploadedFile, ...prev])
      }
    } catch (e) {
      console.error("Failed to upload file", e)
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFileUpload(e.dataTransfer.files)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const handleSaveName = async () => {
    if (!project || !tempName.trim()) return
    try {
      const updated = await apiClient.projects.update(projectId, { name: tempName.trim() })
      setProject(updated)
      setEditingName(false)
    } catch (e) {
      console.error("Failed to update project name", e)
    }
  }

  const handleSaveDescription = async () => {
    if (!project) return
    try {
      const updated = await apiClient.projects.update(projectId, { description: tempDescription.trim() })
      setProject(updated)
      setEditingDescription(false)
    } catch (e) {
      console.error("Failed to update project description", e)
    }
  }

  const handleDeleteFile = async (fileId: string) => {
    setDeleting(true)
    try {
      await apiClient.projects.deleteFile(projectId, fileId)
      setFiles(files.filter((f) => f.id !== fileId))
      setDeleteConfirmId(null)
    } catch (e) {
      console.error("Failed to delete file", e)
    } finally {
      setDeleting(false)
    }
  }

  const getFileIcon = (mimeType?: string) => {
    if (mimeType?.includes("pdf")) return <FileText className="w-5 h-5 text-red-500" />
    if (mimeType?.includes("document") || mimeType?.includes("docx")) return <FileText className="w-5 h-5 text-blue-500" />
    if (mimeType?.includes("text")) return <FileText className="w-5 h-5 text-slate-500" />
    return <File className="w-5 h-5 text-slate-400" />
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "Unknown size"
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-slate-50 to-purple-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
      </div>
    )
  }

  if (!project) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-slate-50 to-purple-50">
      <DashboardHeader />

      <div className="container mx-auto p-6 max-w-5xl">
        {/* Project Header */}
        <Card className="mb-6 border border-slate-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-slate-200 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1">
                {editingName ? (
                  <div className="flex items-center gap-2 mb-2">
                    <Input
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      className="text-xl font-medium"
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" onClick={handleSaveName}>
                      <Check className="w-4 h-4 text-slate-600" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                      <X className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-2">
                    <h1 className="text-2xl font-medium text-slate-900">{project.name}</h1>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTempName(project.name)
                        setEditingName(true)
                      }}
                    >
                      <Edit2 className="w-4 h-4 text-slate-400" />
                    </Button>
                  </div>
                )}
                {editingDescription ? (
                  <div className="flex items-start gap-2">
                    <Textarea
                      value={tempDescription}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTempDescription(e.target.value)}
                      rows={2}
                      placeholder="Add a description"
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" onClick={handleSaveDescription}>
                      <Check className="w-4 h-4 text-slate-600" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingDescription(false)}>
                      <X className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className="text-slate-600 cursor-pointer hover:text-slate-800 group flex items-center gap-2"
                    onClick={() => {
                      setTempDescription(project.description || "")
                      setEditingDescription(true)
                    }}
                  >
                    {project.description || "Click to add a description"}
                    <Edit2 className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100" />
                  </div>
                )}
              </div>
              <Button
                onClick={() => router.push(`/quests/my-projects/${projectId}/chat`)}
                className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600"
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                Chat with Documents
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* File Upload Area */}
        <div
          className={`mb-6 border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragOver
              ? "border-slate-400 bg-slate-50"
              : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            accept=".pdf,.doc,.docx,.txt,.md"
            onChange={(e) => handleFileUpload(e.target.files)}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-10 h-10 text-slate-500 animate-spin" />
              <p className="text-slate-600">Uploading and processing...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 cursor-pointer">
              <Upload className="w-10 h-10 text-slate-400" />
              <p className="text-slate-600 font-medium">
                Drop files here or click to upload
              </p>
              <p className="text-sm text-slate-400">
                Supports PDF, DOCX, TXT, MD files
              </p>
            </div>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-sm mx-4">
              <CardContent className="p-6">
                <h2 className="text-xl font-medium text-slate-900 mb-3">Delete File?</h2>
                <p className="text-slate-600 mb-6">
                  This will permanently delete the file and its embeddings. This action cannot be undone.
                </p>
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setDeleteConfirmId(null)} disabled={deleting}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleDeleteFile(deleteConfirmId)}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Files List */}
        <div>
          <h2 className="text-lg font-medium text-slate-900 mb-4">
            Project Files ({files.length})
          </h2>
          {files.length === 0 ? (
            <Card className="border border-slate-200">
              <CardContent className="p-8 text-center">
                <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-slate-600">No files uploaded yet. Upload your first document above.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {files.map((file) => (
                <Card key={file.id} className="border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                        {getFileIcon(file.mime_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-slate-900 truncate">{file.name}</h3>
                          {file.is_embedded ? (
                            <span className="flex items-center gap-1 text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" />
                              Embedded
                            </span>
                          ) : file.embedding_error ? (
                            <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                              <AlertCircle className="w-3 h-3" />
                              Error
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Processing
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                          <span>{file.original_filename}</span>
                          <span>{formatFileSize(file.file_size)}</span>
                          <span>
                            {new Date(file.created_at).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        </div>
                        {file.embedding_error && (
                          <p className="text-xs text-red-500 mt-1 truncate">{file.embedding_error}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirmId(file.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
