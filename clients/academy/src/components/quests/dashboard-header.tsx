"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/shared/ui/button"
import { Avatar, AvatarFallback } from "@/components/shared/ui/avatar"
import { Languages } from "lucide-react"
import { apiClient } from "@/lib/api-client"

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "zh", name: "Chinese", nativeName: "简体中文", flag: "🇨🇳" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳" },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", flag: "🇧🇩" },
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "ur", name: "Urdu", nativeName: "اردو", flag: "🇵🇰" },
]

export function DashboardHeader() {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<{ username: string; credits: number; level: number } | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState("en")
  const [showLanguageModal, setShowLanguageModal] = useState(false)
  useEffect(() => {
    const loadUserData = async () => {
      try {
        const authData = await apiClient.auth.me()
        if (authData.student) {
          const studentName = authData.student.first_name
            ? `${authData.student.first_name}${authData.student.last_name ? ' ' + authData.student.last_name : ''}`
            : authData.student.username || authData.user?.username || ""
          const studentUser = {
            username: studentName,
            credits: 125,
            level: 3,
          }
          setUser(studentUser)
          localStorage.setItem("user", JSON.stringify(studentUser))
        } else {
          // Fallback to localStorage if no API data
          const userData = localStorage.getItem("user")
          if (userData) {
            setUser(JSON.parse(userData))
          } else {
            const defaultUser = { username: "", credits: 125, level: 3 }
            localStorage.setItem("user", JSON.stringify(defaultUser))
            setUser(defaultUser)
          }
        }
      } catch {
        // API not available, use localStorage
        const userData = localStorage.getItem("user")
        if (userData) {
          setUser(JSON.parse(userData))
        } else {
          const defaultUser = { username: "", credits: 125, level: 3 }
          localStorage.setItem("user", JSON.stringify(defaultUser))
          setUser(defaultUser)
        }
      }
    }

    loadUserData()

    const savedLanguage = localStorage.getItem("preferredLanguage")
    if (savedLanguage) {
      setSelectedLanguage(savedLanguage)
    }
  }, [])

  const handleLanguageSelect = (languageCode: string) => {
    setSelectedLanguage(languageCode)
    localStorage.setItem("preferredLanguage", languageCode)
    setShowLanguageModal(false)
    // Reload to apply language change
    window.location.reload()
  }

  const handleLogout = async () => {
    try { await apiClient.auth.logout() } catch {}
    localStorage.removeItem("user")
    localStorage.removeItem("student")
    localStorage.removeItem("organization")
    localStorage.removeItem("stats")
    router.push("/login")
  }

  const handleBack = () => {
    router.back()
  }

  if (!user) {
    return null
  }

  const showBackButton = pathname !== "/quests/dashboard"
  const currentLanguage = SUPPORTED_LANGUAGES.find((lang) => lang.code === selectedLanguage) || SUPPORTED_LANGUAGES[0]
  const displayUsername = user.username || t("common.student")

  return (
    <>
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 max-w-7xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {showBackButton && (
                <Button variant="ghost" size="icon" onClick={handleBack} className="mr-2" title="Go back">
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
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl overflow-hidden">
                <img src="/quest-themed.svg" alt="Quests" className="w-full h-full object-contain" />
              </div>
              <div>
                <h1 className="text-xl font-medium">Quests</h1>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg bg-chart-1/20">
                <svg className="w-5 h-5 text-chart-1" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="font-semibold">{user.credits}</span>
                <span className="text-sm text-muted-foreground">{t("header.credits")}</span>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLanguageModal(true)}
                className="hidden items-center gap-2 border-2"
                title={t("header.changeLanguage")}
              >
                <Languages className="w-4 h-4" />
                <span className="hidden md:inline text-lg">{currentLanguage.flag}</span>
                <span className="hidden lg:inline text-sm">{currentLanguage.nativeName}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/select-dashboard")}
                className="hidden sm:flex items-center gap-2"
                title={t("header.switchPlatform")}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <span className="hidden lg:inline">{t("header.switchPlatform")}</span>
              </Button>

              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {displayUsername.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:block">
                  <p className="text-sm font-medium">{displayUsername}</p>
                </div>
              </div>

              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </Button>
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
                {SUPPORTED_LANGUAGES.map((language) => (
                  <button
                    key={language.code}
                    onClick={() => handleLanguageSelect(language.code)}
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${selectedLanguage === language.code
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                      }`}
                  >
                    <span className="text-3xl">{language.flag}</span>
                    <div className="flex-1 text-left">
                      <div className="font-semibold text-slate-900">{language.nativeName}</div>
                      <div className="text-sm text-slate-600">{language.name}</div>
                    </div>
                    {selectedLanguage === language.code && (
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
                {t("language.tutorSpeakIn", { language: currentLanguage.nativeName })}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
