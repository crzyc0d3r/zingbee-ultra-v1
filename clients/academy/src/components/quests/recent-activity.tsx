"use client"

import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shared/ui/card"
import Image from "next/image"

export function RecentActivity() {
  const t = useTranslations()
  const activities = [
    {
      titleKey: "activity.welcomeTitle",
      descriptionKey: "activity.welcomeDescription",
      timeKey: "activity.justNow",
      icon: <Image src="/icons/glassmorphism/comet.svg" alt="Activity" width={20} height={20} className="object-contain" />,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("activity.recentActivity")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity, index) => (
            <div key={index} className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0">
                {activity.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{t(activity.titleKey)}</p>
                <p className="text-sm text-muted-foreground">{t(activity.descriptionKey)}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{t(activity.timeKey)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
