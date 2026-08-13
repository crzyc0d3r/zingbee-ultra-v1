"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Trophy } from "lucide-react"

export function QuickActions() {
  const router = useRouter()

  const actions = [
    {
      title: "My Achievements",
      description: "View your badges and rewards",
      icon: <Trophy className="w-8 h-8" />,
      color: "bg-purple-100 text-purple-600",
      href: "/achievements",
    },
  ]

  return (
    <div>
      <h2 className="text-2xl font-medium mb-4">Quick Actions</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {actions.map((action) => (
          <Card
            key={action.title}
            className="cursor-pointer border border-slate-200 hover:shadow-xl hover:bg-slate-50 active:shadow-none active:scale-[0.98] transition-all"
            onClick={() => router.push(action.href)}
          >
            <CardContent className="pt-6">
              <div className={`w-16 h-16 rounded-2xl ${action.color} flex items-center justify-center mb-4`}>
                {action.icon}
              </div>
              <h3 className="text-lg font-semibold mb-2">{action.title}</h3>
              <p className="text-sm text-muted-foreground text-pretty">{action.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
