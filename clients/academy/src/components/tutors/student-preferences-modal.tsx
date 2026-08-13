"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/shared/ui/button"
import { X, User, BarChart3, Trash2, AlertTriangle, CheckCircle, Clock, Target, ChevronLeft, Eye, XCircle } from "lucide-react"
import { apiClient, type StudentAssessmentSummary, type StudentAssessmentDetail, type Student } from "@/lib/api-client"

interface StudentPreferencesModalProps {
  isOpen: boolean
  onClose: () => void
  onLogout: () => void
  student: Student | null
}

type TabType = "general" | "progress"
type ConfirmationType = "resetAll" | "resetSubject" | null

interface PendingReset {
  type: "all" | "subject"
  subjectId?: string
  subjectName?: string
}

export function StudentPreferencesModal({ isOpen, onClose, onLogout, student }: StudentPreferencesModalProps) {
  const t = useTranslations()
  const [activeTab, setActiveTab] = useState<TabType>("general")
  const [assessments, setAssessments] = useState<StudentAssessmentSummary[]>([])
  const [selectedAssessment, setSelectedAssessment] = useState<StudentAssessmentDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmationType, setConfirmationType] = useState<ConfirmationType>(null)
  const [pendingReset, setPendingReset] = useState<PendingReset | null>(null)

  const loadAssessments = useCallback(async () => {
    if (!student?.id) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiClient.studentAssessments.listByStudent(student.id)
      setAssessments(data)
    } catch {
      // Endpoint may not exist on this backend - not critical
      setAssessments([])
    } finally {
      setLoading(false)
    }
  }, [student?.id])

  useEffect(() => {
    if (isOpen && student?.id && activeTab === "progress") {
      loadAssessments()
    }
  }, [isOpen, student?.id, activeTab, loadAssessments])

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscapeKey)
    }
    return () => {
      document.removeEventListener("keydown", handleEscapeKey)
    }
  }, [isOpen, onClose])

  const loadAssessmentDetail = async (assessmentId: string) => {
    setLoadingDetail(true)
    setError(null)
    try {
      const detail = await apiClient.studentAssessments.get(assessmentId)
      setSelectedAssessment(detail)
    } catch (err) {
      console.error("Failed to load assessment detail:", err)
      setError(t("preferences.failedToLoadAssessments"))
    } finally {
      setLoadingDetail(false)
    }
  }

  const initiateResetAll = () => {
    setConfirmationType("resetAll")
    setPendingReset({ type: "all" })
  }

  const initiateResetSubject = (subjectId: string, subjectName: string) => {
    setConfirmationType("resetSubject")
    setPendingReset({ type: "subject", subjectId, subjectName })
  }

  const cancelReset = () => {
    setConfirmationType(null)
    setPendingReset(null)
  }

  const confirmReset = async () => {
    if (!student?.id || !pendingReset) return

    setResetting(true)
    setError(null)
    setResetSuccess(null)
    setConfirmationType(null)

    try {
      if (pendingReset.type === "all") {
        const result = await apiClient.studentAssessments.reset(student.id)
        setResetSuccess(t("preferences.resetSuccess", { count: result.deleted_count }))
        setAssessments([])
      } else if (pendingReset.type === "subject" && pendingReset.subjectId) {
        const result = await apiClient.studentAssessments.reset(student.id, pendingReset.subjectId)
        setResetSuccess(t("preferences.resetSuccess", { count: result.deleted_count }))
        await loadAssessments()
      }
      // Clear local storage placement data
      localStorage.removeItem("assignedPhase")
      setPendingReset(null)
      // Log out the user after successful reset
      setTimeout(() => {
        onLogout()
      }, 1500)
    } catch (err) {
      console.error("Failed to reset assessments:", err)
      setError(t("preferences.failedToReset"))
      setPendingReset(null)
    } finally {
      setResetting(false)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-"
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getStatusBadge = (status: string) => {
    if (status === "completed") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
          <CheckCircle className="w-3 h-3" />
          {t("preferences.statusCompleted")}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <Clock className="w-3 h-3" />
        {t("preferences.statusInProgress")}
      </span>
    )
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preferences-modal-title"
    >
      <div className="w-full max-w-3xl bg-background rounded-2xl shadow-2xl overflow-hidden m-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 p-6 text-primary-foreground flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 id="preferences-modal-title" className="text-2xl font-medium flex items-center gap-2">
              <User className="w-6 h-6" />
              {t("preferences.title")}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-primary-foreground hover:bg-white/20 rounded-lg p-2 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-primary-foreground/80 mt-1">{t("preferences.subtitle")}</p>
        </div>

        {/* Tabs and Content */}
        <div className="flex flex-1 overflow-hidden min-h-[400px]">
          {/* Left Sidebar Tabs */}
          <div className="w-48 bg-muted/50 border-r border-border p-4 flex-shrink-0">
            <nav className="space-y-2">
              <button
                onClick={() => setActiveTab("general")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                  activeTab === "general"
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <User className="w-5 h-5" />
                <span className="font-medium">{t("preferences.tabGeneral")}</span>
              </button>
              <button
                onClick={() => setActiveTab("progress")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                  activeTab === "progress"
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <BarChart3 className="w-5 h-5" />
                <span className="font-medium">{t("preferences.tabProgress")}</span>
              </button>
            </nav>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-y-auto min-h-[400px]">
            {activeTab === "general" && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-foreground">{t("preferences.generalInfo")}</h3>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t("preferences.username")}
                    </label>
                    <p className="text-lg font-semibold text-foreground mt-1">
                      {student?.username || "-"}
                    </p>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t("preferences.email")}
                    </label>
                    <p className="text-lg font-semibold text-foreground mt-1">
                      {student?.email || "-"}
                    </p>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t("preferences.firstName")}
                    </label>
                    <p className="text-lg font-semibold text-foreground mt-1">
                      {student?.first_name || "-"}
                    </p>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t("preferences.lastName")}
                    </label>
                    <p className="text-lg font-semibold text-foreground mt-1">
                      {student?.last_name || "-"}
                    </p>
                  </div>

                  {student?.age && (
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("preferences.age")}
                      </label>
                      <p className="text-lg font-semibold text-foreground mt-1">
                        {student.age}
                      </p>
                    </div>
                  )}

                  {student?.date_of_birth && (
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("preferences.birthday")}
                      </label>
                      <p className="text-lg font-semibold text-foreground mt-1">
                        {new Date(student.date_of_birth).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric"
                        })}
                      </p>
                    </div>
                  )}

                  {student?.gender && (
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("preferences.gender")}
                      </label>
                      <p className="text-lg font-semibold text-foreground mt-1">
                        {t(`preferences.gender_${student.gender}`)}
                      </p>
                    </div>
                  )}
                </div>

                {student?.bio && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t("preferences.bio")}
                    </label>
                    <p className="text-muted-foreground mt-1">{student.bio}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "progress" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">{t("preferences.assessmentHistory")}</h3>
                  {assessments.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={initiateResetAll}
                      disabled={resetting || confirmationType !== null}
                      className="flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      {resetting ? t("preferences.resetting") : t("preferences.resetAll")}
                    </Button>
                  )}
                </div>

                {/* Success/Error messages */}
                {resetSuccess && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <p className="text-green-700">{resetSuccess}</p>
                  </div>
                )}

                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    <p className="text-red-700">{error}</p>
                  </div>
                )}

                {/* Inline Confirmation Dialog */}
                {confirmationType && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-amber-800 font-medium mb-3">
                          {confirmationType === "resetAll"
                            ? t("preferences.confirmResetAll")
                            : t("preferences.confirmResetSubject", { subject: pendingReset?.subjectName || "" })}
                        </p>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={confirmReset}
                            disabled={resetting}
                            className="flex items-center gap-2"
                          >
                            {resetting ? (
                              <>
                                <span className="animate-spin">&#8635;</span>
                                {t("preferences.resetting")}
                              </>
                            ) : (
                              <>
                                <Trash2 className="w-4 h-4" />
                                {t("buttons.confirm")}
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={cancelReset}
                            disabled={resetting}
                          >
                            {t("buttons.cancel")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {loading ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">{t("common.loading")}</p>
                  </div>
                ) : assessments.length === 0 ? (
                  <div className="text-center py-12 bg-muted/50 rounded-lg">
                    <Target className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-muted-foreground">{t("preferences.noAssessments")}</p>
                  </div>
                ) : selectedAssessment ? (
                  /* Assessment Detail View */
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedAssessment(null)}
                        className="flex items-center gap-2"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        {t("buttons.back")}
                      </Button>
                      <h3 className="text-lg font-semibold text-foreground">{t("preferences.assessmentDetails")}</h3>
                    </div>

                    {loadingDetail ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground">{t("common.loading")}</p>
                      </div>
                    ) : (
                      <>
                        {/* Phase Scores */}
                        {selectedAssessment.assessment_data.phase_scores && (
                          <div className="p-4 bg-muted/50 rounded-lg">
                            <h4 className="text-sm font-semibold text-foreground mb-3">{t("preferences.phaseScores")}</h4>
                            <div className="grid grid-cols-4 gap-2">
                              {Object.entries(selectedAssessment.assessment_data.phase_scores).map(([phase, score]) => (
                                <div key={phase} className="text-center p-2 bg-background rounded">
                                  <p className="text-xs text-muted-foreground">{t("preferences.phase")} {phase}</p>
                                  <p className="text-lg font-medium text-foreground">{score as number}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Theme Scores */}
                        {selectedAssessment.assessment_data.theme_scores && (
                          <div className="p-4 bg-muted/50 rounded-lg">
                            <h4 className="text-sm font-semibold text-foreground mb-3">{t("preferences.themeScores")}</h4>
                            <div className="space-y-2">
                              {Object.entries(selectedAssessment.assessment_data.theme_scores).map(([theme, scores]) => (
                                <div key={theme} className="flex items-center justify-between p-2 bg-background rounded">
                                  <span className="text-sm text-foreground">{theme}</span>
                                  <div className="flex items-center gap-2">
                                    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${scores.percentage >= 70 ? 'bg-green-500' : scores.percentage >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                                        style={{ width: `${scores.percentage}%` }}
                                      />
                                    </div>
                                    <span className="text-sm font-medium text-muted-foreground w-16 text-right">
                                      {scores.correct}/{scores.total} ({Math.round(scores.percentage)}%)
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Question Responses */}
                        {selectedAssessment.assessment_data.responses && (
                          <div className="p-4 bg-muted/50 rounded-lg">
                            <h4 className="text-sm font-semibold text-foreground mb-3">{t("preferences.questionResponses")}</h4>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                              {selectedAssessment.assessment_data.responses.map((response) => (
                                <div
                                  key={response.question_id}
                                  className={`p-3 rounded-lg border ${
                                    response.is_correct
                                      ? 'bg-green-50 border-green-200'
                                      : 'bg-red-50 border-red-200'
                                  }`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center flex-wrap gap-2 mb-1">
                                        {response.is_correct ? (
                                          <CheckCircle className="w-4 h-4 text-green-600" />
                                        ) : (
                                          <XCircle className="w-4 h-4 text-red-600" />
                                        )}
                                        <span className="font-medium text-foreground">
                                          {t("preferences.question")} {response.question_number}
                                        </span>
                                        {response.phase_number && (
                                          <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
                                            {t("preferences.phase")} {response.phase_number}
                                          </span>
                                        )}
                                        {response.question_type && (
                                          <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700">
                                            {response.question_type}
                                          </span>
                                        )}
                                      </div>
                                      {response.theme_name && (
                                        <p className="ml-6 text-xs text-muted-foreground mb-1">
                                          {t("preferences.theme")}: <span className="font-medium">{response.theme_name}</span>
                                        </p>
                                      )}
                                      <div className="ml-6 text-sm">
                                        <p className="text-muted-foreground">
                                          {t("preferences.yourAnswer")}: <span className={response.is_correct ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>{response.student_answer}</span>
                                        </p>
                                        {!response.is_correct && (
                                          <p className="text-muted-foreground">
                                            {t("preferences.correctAnswer")}: <span className="text-green-700 font-medium">{response.correct_answer}</span>
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                      {response.time_spent_seconds}s
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {assessments.map((assessment) => (
                      <div
                        key={assessment.id}
                        className="p-4 bg-card border border-border rounded-lg hover:border-border/80 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h4 className="font-semibold text-foreground">
                                {assessment.subject_name}
                              </h4>
                              {getStatusBadge(assessment.status)}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">{t("preferences.startedAt")}:</span>
                                <p className="font-medium text-foreground">{formatDate(assessment.started_at)}</p>
                              </div>

                              {assessment.completed_at && (
                                <div>
                                  <span className="text-muted-foreground">{t("preferences.completedAt")}:</span>
                                  <p className="font-medium text-foreground">{formatDate(assessment.completed_at)}</p>
                                </div>
                              )}

                              {assessment.total_score !== null && (
                                <div>
                                  <span className="text-muted-foreground">{t("preferences.score")}:</span>
                                  <p className="font-medium text-foreground">
                                    {assessment.total_score} / {assessment.max_score}
                                    <span className="text-muted-foreground ml-1">
                                      ({Math.round((assessment.total_score / (assessment.max_score || 1)) * 100)}%)
                                    </span>
                                  </p>
                                </div>
                              )}

                              {assessment.assigned_phase_name && (
                                <div>
                                  <span className="text-muted-foreground">{t("preferences.placedAt")}:</span>
                                  <p className="font-medium text-primary">{assessment.assigned_phase_name}</p>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 ml-4">
                            {assessment.status === "completed" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => loadAssessmentDetail(assessment.id)}
                                className="text-primary hover:text-primary hover:bg-primary/10"
                                title={t("preferences.viewDetails")}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => initiateResetSubject(assessment.subject_id, assessment.subject_name)}
                              disabled={resetting || confirmationType !== null}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              title={t("preferences.resetSubject")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer with Close Button */}
        <div className="border-t border-border bg-muted/30 px-6 py-4 flex justify-end flex-shrink-0">
          <Button variant="outline" onClick={onClose}>
            {t("buttons.close")}
          </Button>
        </div>
      </div>
    </div>
  )
}
