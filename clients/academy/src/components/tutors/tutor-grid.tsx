"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/shared/ui/card"
import Image from "next/image"
import { apiClient, type Subject as ApiSubject } from "@/lib/api-client"

interface Subject extends ApiSubject {
  bgColor: string
  icon: React.ReactNode
  iconColor: string
}

const emojiToSvgMap: Record<string, string> = {
  "🦉": "/icons/glassmorphism/quill-with-ink.svg",
  "🕌": "/icons/glassmorphism/lighthouse.svg",
  "🧠": "/icons/glassmorphism/biotech.svg",
  "📚": "/icons/glassmorphism/book.svg",
  "🔬": "/icons/glassmorphism/microscope.svg",
  "🌍": "/icons/glassmorphism/telescope.svg",
  "🎨": "/icons/glassmorphism/palette.svg",
  "📐": "/icons/glassmorphism/drafting-compass.svg",
}

export function TutorGrid() {
  const router = useRouter()
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [placements, setPlacements] = useState<Record<string, { phase: number | null; inProgress: boolean }>>({})
  const [progress, setProgress] = useState<Record<string, { completed: number; total: number }>>({})

  useEffect(() => {
    loadSubjects()
  }, [])

  useEffect(() => {
    if (subjects.length === 0) return
    const student = JSON.parse(localStorage.getItem("student") || "{}")
    if (!student.id) return
    const loadPlacements = async () => {
      const results: Record<string, { phase: number | null; inProgress: boolean }> = {}
      await Promise.all(subjects.map(async (s) => {
        try {
          const check = await apiClient.studentPreferences.checkPlacement(student.id, s.id)
          const placement = check.placement as any
          results[s.id] = {
            phase: check.has_placement && placement ? (placement.assigned_phase ?? placement.phase_number ?? null) : null,
            inProgress: check.has_in_progress,
          }
        } catch {
          results[s.id] = { phase: null, inProgress: false }
        }
      }))
      setPlacements(results)
    }
    const loadProgress = async () => {
      try {
        const data = await apiClient.students.get(student.id) as any
        const results: Record<string, { completed: number; total: number }> = {}
        for (const s of (data.subjects || [])) {
          results[s.subject_id] = { completed: s.capsules_completed, total: s.total_capsules }
        }
        setProgress(results)
      } catch {}
    }
    loadPlacements()
    loadProgress()
  }, [subjects])

  const getIconForSubject = (subject: ApiSubject) => {
    // Map by subject name/specialty to ensure correct icons
    const subjectName = subject.name.toLowerCase()
    const specialty = subject.specialty?.toLowerCase() || ""

    let iconSrc = "/icons/glassmorphism/sparkle.svg" // default

    if (subjectName.includes("archi") || specialty.includes("math")) {
      iconSrc = "/icons/glassmorphism/drafting-compass.svg"
    } else if (subjectName.includes("lexi") || specialty.includes("english") || specialty.includes("literature")) {
      iconSrc = "/icons/glassmorphism/quill-with-ink.svg"
    } else if (subjectName.includes("aris") || specialty.includes("biolog")) {
      iconSrc = "/icons/glassmorphism/biotech.svg"
    } else if (subjectName.includes("mendi") || specialty.includes("chemi")) {
      iconSrc = "/icons/glassmorphism/microscope.svg"
    } else if (subjectName.includes("newt") || specialty.includes("physic")) {
      iconSrc = "/icons/glassmorphism/telescope.svg"
    } else if (subject.character_emoji && emojiToSvgMap[subject.character_emoji]) {
      iconSrc = emojiToSvgMap[subject.character_emoji]
    }

    return (
      <div className="w-14 h-14 flex items-center justify-center">
        <Image
          src={iconSrc}
          alt={subject.name}
          width={56}
          height={56}
          className="object-contain"
        />
      </div>
    )
  }

  const loadSubjects = async () => {
    try {
      const apiSubjects = await apiClient.subjects.list(true)
      const subjectsWithUI = apiSubjects.map((subject: any) => {
        const mapped = {
          ...subject,
          name: subject.name,
          specialty: subject.name,
          description: subject.description || `Explore ${subject.name} with your AI tutor`,
          personality: subject.personality || "Knowledgeable, patient, encouraging",
          color_code: subject.color,
        }
        return {
          ...mapped,
          bgColor: "",
          icon: getIconForSubject(mapped),
          iconColor: `text-${subject.color || "blue"}-600`,
        }
      })
      setSubjects(subjectsWithUI)
    } catch (error) {
      console.error("Failed to load subjects:", error)
      setSubjects([])
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="p-6 h-64 animate-pulse bg-gray-100" />
        ))}
      </div>
    )
  }

  const handleSelectSubject = async (subjectId: string) => {
    setSelectedSubject(subjectId)
    const subject = subjects.find((s) => s.id === subjectId)
    if (subject) {
      const subjectData = {
        id: subject.id,
        name: subject.name,
        specialty: subject.specialty,
        description: subject.description,
        personality: subject.personality,
        bgColor: subject.bgColor,
        character_emoji: subject.character_emoji,
        color_code: subject.color_code,
      }
      localStorage.setItem("selectedSubject", JSON.stringify(subjectData))

      // Check if student has placement for this subject
      try {
        const student = JSON.parse(localStorage.getItem("student") || "{}")
        if (student.id) {
          const placementCheck = await apiClient.studentPreferences.checkPlacement(student.id, subjectId)

          if (placementCheck.has_in_progress && placementCheck.in_progress_assessment_id) {
            // Has in-progress assessment - go to assessment to resume
            setTimeout(() => {
              router.push("/tutors/assessment")
            }, 300)
            return
          }

          if (placementCheck.has_placement && placementCheck.placement) {
            // Has placement - store assigned phase and go directly to themes
            localStorage.setItem("assignedPhase", JSON.stringify({
              phase_id: placementCheck.placement.phase_id,
              phase_number: placementCheck.placement.phase_number,
            }))
            setTimeout(() => {
              router.push("/tutors/themes")
            }, 300)
            return
          }
        }
      } catch (err) {
        console.error("Error checking placement:", err)
        // On error, proceed to assessment
      }

      // No placement - redirect to assessment
      setTimeout(() => {
        router.push("/tutors/assessment")
      }, 300)
    }
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 max-w-6xl mx-auto">
      {subjects.map((subject) => (
        <Card
          key={subject.id}
          className="cursor-pointer border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all bg-white overflow-hidden"
          onClick={() => handleSelectSubject(subject.id)}
        >
          <div className="p-6 flex flex-col items-center text-center space-y-4">
            {subject.icon}
            <h3 className="text-2xl mb-1">{subject.name}</h3>
            <p className="text-xs text-muted-foreground">
              {placements[subject.id]?.phase != null
                ? `Phase ${placements[subject.id].phase}`
                : placements[subject.id]?.inProgress
                  ? "Resume Assessment"
                  : "Begin Assessment"}
            </p>
            {progress[subject.id] && progress[subject.id].total > 0 && (
              <div className="w-full mt-2">
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/60 rounded-full transition-all"
                    style={{ width: `${Math.round((progress[subject.id].completed / progress[subject.id].total) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {progress[subject.id].completed}/{progress[subject.id].total} capsules
                </p>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
