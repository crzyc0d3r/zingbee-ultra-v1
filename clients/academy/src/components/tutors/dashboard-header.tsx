"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { apiClient } from "@/lib/api-client"
import { useTranslations } from "next-intl"
import { Button } from "@/components/shared/ui/button"
import { Avatar, AvatarFallback } from "@/components/shared/ui/avatar"
import { Languages, Trophy, ChevronDown, Settings, LogOut, ArrowLeftRight, Star } from "lucide-react"
import { localeNames, setLocaleInStorage, type Locale } from "@/lib/i18n"
import { StudentPreferencesModal } from "./student-preferences-modal"
import type { Student } from "@/lib/api-client"

export function DashboardHeader({ busy = false }: { busy?: boolean } = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations()
  const [user, setUser] = useState<{ username: string; credits: number; level: number } | null>(null)
  const [student, setStudent] = useState<Student | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState<Locale>("en")
  const [showLanguageModal, setShowLanguageModal] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [showPreferencesModal, setShowPreferencesModal] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const userData = localStorage.getItem("user")

    if (userData) {
      try {
        const parsedUser = JSON.parse(userData)
        setUser(parsedUser)
      } catch {
        // Corrupted data - use default
        const defaultUser = {
          username: t("common.student"),
          credits: 125,
          level: 3,
        }
        localStorage.setItem("user", JSON.stringify(defaultUser))
        setUser(defaultUser)
      }
    } else {
      const defaultUser = {
        username: t("common.student"),
        credits: 125,
        level: 3,
      }
      localStorage.setItem("user", JSON.stringify(defaultUser))
      setUser(defaultUser)
    }

    // Load student data
    const studentData = localStorage.getItem("student")
    if (studentData) {
      try {
        setStudent(JSON.parse(studentData))
      } catch {
        // Corrupted data - ignore
        setStudent(null)
      }
    }

    const savedLanguage = localStorage.getItem("preferredLanguage")
    if (savedLanguage) {
      setSelectedLanguage(savedLanguage as Locale)
    }
  }, [t])

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false)
      }
    }

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowUserDropdown(false)
      }
    }

    if (showUserDropdown) {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleEscapeKey)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscapeKey)
    }
  }, [showUserDropdown])

  const handleLanguageSelect = (languageCode: Locale) => {
    setSelectedLanguage(languageCode)
    setLocaleInStorage(languageCode)
    setShowLanguageModal(false)
    router.refresh()
    window.location.reload()
  }

  const handleLogout = async () => {
    try { await apiClient.auth.logout() } catch {}
    localStorage.removeItem("user")
    localStorage.removeItem("student")
    localStorage.removeItem("organization")
    localStorage.removeItem("stats")
    localStorage.removeItem("selectedTutor")
    localStorage.removeItem("selectedTheme")
    localStorage.removeItem("selectedSubject")
    localStorage.removeItem("selectedPhase")
    localStorage.removeItem("preferredLanguage")
    localStorage.removeItem("currentPhase")
    localStorage.removeItem("completedPhases")
    localStorage.removeItem("continueSession")
    router.push("/login")
  }

  const handleBack = () => {
    const backMap: Record<string, string> = {
      "/tutors/themes": "/tutors/dashboard",
      "/tutors/start-session": "/tutors/themes",
      "/tutors/learning": "/tutors/dashboard",
      "/tutors/session-summary": "/tutors/dashboard",
      "/tutors/phases": "/tutors/dashboard",
      "/tutors/assessment": "/tutors/dashboard",
    }
    router.push(backMap[pathname] || "/tutors/dashboard")
  }

  if (!user) {
    return null
  }

  const showBackButton = pathname !== "/tutors/dashboard"
  const currentLanguage = localeNames[selectedLanguage]

  // Use student's name if available, otherwise fall back to user object
  const displayName = student?.first_name || student?.username || user.username
  const displayInitial = displayName.charAt(0).toUpperCase()

  return (
    <>
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 max-w-7xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {showBackButton && (
                <Button variant="ghost" size="icon" onClick={handleBack} className="mr-2" title="Go back" disabled={busy}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    />
                  </svg>
                </Button>
              )}
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-xl overflow-hidden">
                <img src="/tutor-themed.svg" alt="Tutors" className="w-full h-full object-contain" />
              </div>
              <div>
                <h1 className="text-2xl">Tutors</h1>
                {student && (
                  <p className="text-sm text-muted-foreground">
                    Good {(() => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night" })()}, {[student.first_name, student.last_name].filter(Boolean).join(" ") || "Student"}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLanguageModal(true)}
                className="hidden items-center gap-2 border-2"
                title={t("header.changeLanguage")}
                disabled={busy}
              >
                <Languages className="w-4 h-4" />
                <span className="text-lg">{currentLanguage.flag}</span>
                <span className="hidden lg:inline text-sm">{currentLanguage.name}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/select-dashboard")}
                className="hidden md:flex items-center gap-2"
                title={t("header.switchPlatform")}
                disabled={busy}
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span className="hidden lg:inline">{t("header.switchPlatform")}</span>
              </Button>

              {/* User Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => !busy && setShowUserDropdown(!showUserDropdown)}
                  disabled={busy}
                  aria-expanded={showUserDropdown}
                  aria-haspopup="menu"
                  aria-controls="user-dropdown-menu"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <Avatar>
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {displayInitial}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden md:block text-left">
                    <p className="text-sm font-medium">{displayName}</p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showUserDropdown ? "rotate-180" : ""}`} />
                </button>

                {/* Dropdown Menu */}
                {showUserDropdown && (
                  <div
                    id="user-dropdown-menu"
                    role="menu"
                    aria-orientation="vertical"
                    className="absolute right-0 top-full mt-2 w-56 bg-background rounded-lg shadow-lg border border-border py-1 z-50"
                  >
                    {/* Mobile-only menu items - hidden on md+ screens */}
                    <div className="md:hidden">
                      <button
                        role="menuitem"
                        onClick={() => {
                          setShowUserDropdown(false)
                          router.push("/select-dashboard")
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <ArrowLeftRight className="w-4 h-4" />
                        {t("header.switchPlatform")}
                      </button>
                      <hr className="my-1 border-border" />
                    </div>

                    <button
                      role="menuitem"
                      onClick={() => {
                        setShowUserDropdown(false)
                        setShowPreferencesModal(true)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      {t("header.preferences")}
                    </button>
                    <hr className="my-1 border-border" />
                    <button
                      role="menuitem"
                      onClick={() => {
                        setShowUserDropdown(false)
                        handleLogout()
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {t("header.logout")}
                    </button>
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {showLanguageModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden m-4">
            <div className="bg-gradient-to-r from-blue-500 to-purple-500 p-6 text-white">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-2xl font-medium flex items-center gap-2">
                  <Languages className="w-6 h-6" />
                  {t("language.modalTitle")}
                </h2>
                <button
                  onClick={() => setShowLanguageModal(false)}
                  className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-blue-100">{t("language.modalSubtitle")}</p>
            </div>

            <div className="p-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(localeNames).map(([code, { name, flag }]) => (
                  <button
                    key={code}
                    onClick={() => handleLanguageSelect(code as Locale)}
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                      selectedLanguage === code
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span className="text-3xl">{flag}</span>
                    <div className="flex-1 text-left">
                      <div className="font-semibold text-slate-900">{name}</div>
                    </div>
                    {selectedLanguage === code && (
                      <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-600 text-center">
                {t("language.tutorSpeakIn", { language: currentLanguage.name })}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Student Preferences Modal */}
      <StudentPreferencesModal
        isOpen={showPreferencesModal}
        onClose={() => setShowPreferencesModal(false)}
        onLogout={handleLogout}
        student={student}
      />
    </>
  )
}
