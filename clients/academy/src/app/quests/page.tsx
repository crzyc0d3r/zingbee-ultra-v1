"use client"
import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { DashboardHeader } from "@/components/quests/dashboard-header"
import { Rocket, Users, Globe, Brain, DollarSign, Briefcase } from "lucide-react"
import Link from "next/link"

const iconMap: any = {
    Rocket,
    Users,
    Globe,
    Brain,
    DollarSign,
    Briefcase,
}

type Quest = {
    id: string
    title: string
    description: string
    icon: string
    color: string
    bg_color: string
    border_color: string
    href: string
}

export default function QuestListPage() {
    const [quests, setQuests] = useState<Quest[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchQuests = async () => {
            try {
                const lang = localStorage.getItem("preferredLanguage") || "en"
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/quests/?lang=${lang}`, {
                    credentials: 'include'
                })
                if (res.ok) {
                    const data = await res.json()
                    setQuests(data)
                } else {
                    console.error("Failed to fetch quests")
                }
            } catch (e) {
                console.error("Error fetching quests", e)
            } finally {
                setLoading(false)
            }
        }
        fetchQuests()
    }, [])

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <DashboardHeader />
            <main className="flex-1 container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto">
                    <div className="mb-8">
                        <h1 className="text-3xl font-medium text-slate-900">Available Quests</h1>
                        <p className="text-slate-600 mt-2">Choose a quest to start your journey.</p>
                    </div>

                    {loading ? (
                        <div className="text-center py-12">Loading quests...</div>
                    ) : (
                        <div className="grid gap-6 md:grid-cols-2">
                            {quests.map((quest) => {
                                const Icon = iconMap[quest.icon] || Rocket
                                return (
                                    <Link key={quest.id} href={quest.href}>
                                        <Card className={`cursor-pointer border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all`}>
                                            <CardHeader className={`bg-gradient-to-br ${quest.bg_color} rounded-t-lg`}>
                                                <CardTitle className="flex items-center gap-3 text-slate-900">
                                                    <div className={`p-2 bg-white rounded-lg shadow-sm`}>
                                                        <Icon className={`w-6 h-6 text-slate-700`} />
                                                    </div>
                                                    {quest.title}
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="p-6">
                                                <CardDescription className="text-base mb-4">
                                                    {quest.description}
                                                </CardDescription>
                                                <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white">
                                                    Start Quest
                                                </Button>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                )
                            })}
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
