"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { DashboardHeader } from "@/components/quests/dashboard-header"
import { StatsCards } from "@/components/quests/stats-cards"
import { RecentActivity } from "@/components/quests/recent-activity"
import { Card } from "@/components/shared/ui/card"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import Image from "next/image"

import { apiClient } from "@/lib/api-client"
import { Quest } from "@/lib/types/quest"

const iconSvgMap: Record<string, string> = {
  Rocket: "/icons/glassmorphism/rocket.svg",
  Users: "/icons/glassmorphism/globe.svg",
  Globe: "/icons/glassmorphism/globe.svg",
  Brain: "/icons/glassmorphism/brain.svg",
  DollarSign: "/icons/glassmorphism/money-box.svg",
  Briefcase: "/icons/glassmorphism/briefcase.svg",
}

export default function DashboardPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [student, setStudent] = useState<any>(null)
  const [quests, setQuests] = useState<Quest[]>([])

  useEffect(() => {
    // Check for authentication
    const storedStudent = localStorage.getItem("student")
    if (!storedStudent) {
      router.push("/login")
      return
    }

    try {
      setStudent(JSON.parse(storedStudent))
    } catch (e) {
      console.error("Invalid student data")
      router.push("/login")
    }

    // Fetch quests
    const fetchQuests = async () => {
      try {
        const lang = localStorage.getItem("preferredLanguage") || "en"
        const data = await apiClient.quests.list(lang)
        setQuests(data)
      } catch (error) {
        console.error("Error fetching quests:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchQuests()
  }, [router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <DashboardHeader />
      <main className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="space-y-8">
          <StatsCards />

          <div>
            <h2 className="text-2xl font-medium mb-4">Quests</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
              {quests.map((quest) => {
                const iconSrc = iconSvgMap[quest.icon] || "/icons/glassmorphism/sparkle.svg"
                return (
                  <Link key={quest.title} href={quest.href}>
                    <Card className="cursor-pointer border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all bg-white overflow-hidden h-full">
                      <div className="p-6 flex flex-col items-center text-center h-full">
                        <div className="w-24 h-24 rounded-2xl flex items-center justify-center flex-shrink-0">
                          <Image src={iconSrc} alt={quest.title} width={64} height={64} className="object-contain" />
                        </div>

                        <div className="mt-4 flex-1 flex flex-col justify-center">
                          <h3 className="text-2xl font-medium mb-2">{quest.title}</h3>
                          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{quest.description}</p>
                        </div>
                      </div>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </div>

          <RecentActivity />
        </div>
      </main>
    </div>
  )
}

