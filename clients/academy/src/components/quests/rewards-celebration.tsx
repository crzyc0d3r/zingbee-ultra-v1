"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { useRouter } from "next/navigation"

export function RewardsCelebration() {
  const router = useRouter()
  const [show, setShow] = useState(true)

  if (!show) return null

  return (
    <Card className="border border-slate-200 bg-white">
      <CardContent className="pt-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center animate-bounce">
              <svg className="w-8 h-8 text-primary" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-medium mb-1">Lesson Complete!</h3>
              <p className="text-muted-foreground">You earned credits and unlocked new achievements</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => router.push("/quests/dashboard")}>Continue Learning</Button>
            <Button variant="outline" onClick={() => setShow(false)}>
              Dismiss
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
