"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/shared/ui/card"
import Image from "next/image"

export default function SelectDashboard() {
  const router = useRouter()
  const t = useTranslations()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-medium mb-2">{t("selectDashboard.title")}</h1>
          <p className="text-muted-foreground">{t("selectDashboard.subtitle")}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Quests - Active */}
          <Card
            className="cursor-pointer border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all flex flex-col"
            onClick={() => router.push("/quests/dashboard")}
          >
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg">
                  <Image src="/icons/glassmorphism/sparkle.svg" alt="Quests" width={24} height={24} className="object-contain" />
                </div>
                <CardTitle className="text-2xl">Quests</CardTitle>
              </div>
              <CardDescription className="text-base">{t("selectDashboard.questsSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-grow">
              <p className="text-muted-foreground flex-grow">
                {t("selectDashboard.questsDescription")}
              </p>
            </CardContent>
          </Card>

          {/* Bots */}
          <Card
            className="cursor-pointer border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all flex flex-col"
            onClick={() => router.push("/tutors/dashboard")}
          >
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg">
                  <Image src="/icons/glassmorphism/open-book.svg" alt="Tutors" width={24} height={24} className="object-contain" />
                </div>
                <CardTitle className="text-2xl">Tutors</CardTitle>
              </div>
              <CardDescription className="text-base">{t("selectDashboard.tutorsSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-grow">
              <p className="text-muted-foreground flex-grow">
                {t("selectDashboard.tutorsDescription")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
