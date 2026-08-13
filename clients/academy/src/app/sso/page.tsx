"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { apiClient } from "@/lib/api-client"

export default function SSOPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const credential = searchParams.get("credential")
    const redirect = searchParams.get("redirect") || "/tutors/dashboard"

    if (!credential) {
      setError("Missing credential")
      return
    }

    const authenticate = async () => {
      try {
        const response = await fetch("/api/auth/sso", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ credential }),
        })

        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          setError(body.error || "SSO authentication failed")
          return
        }

        const result = await response.json()

        localStorage.setItem("student", JSON.stringify(result.student))
        localStorage.setItem("organization", JSON.stringify(result.organization))
        if (!localStorage.getItem("stats")) {
          localStorage.setItem("stats", JSON.stringify({ lessonsCompleted: 0, currentStreak: 0, totalTime: 0 }))
        }

        router.replace(redirect)
      } catch {
        setError("Could not connect to the server")
      }
    }

    authenticate()
  }, [searchParams, router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-blue-50 p-4">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <a href="/login" className="text-sm text-muted-foreground hover:underline">Go to login</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-blue-50">
      <p className="text-muted-foreground">Signing you in...</p>
    </div>
  )
}
