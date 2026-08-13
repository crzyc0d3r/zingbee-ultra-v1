"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api-client"

export function useAuth() {
  const router = useRouter()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const student = localStorage.getItem("student")
    const organization = localStorage.getItem("organization")

    if (!student || !organization) {
      router.push("/login")
      return
    }

    // Verify the session cookie is still valid via API
    apiClient.auth.me()
      .then(() => {
        setIsAuthenticated(true)
        setIsLoading(false)
      })
      .catch(() => {
        // Cookie expired or invalid — clear localStorage and redirect
        localStorage.removeItem("student")
        localStorage.removeItem("organization")
        localStorage.removeItem("stats")
        router.push("/login")
      })
  }, [router])

  return { isAuthenticated, isLoading }
}
