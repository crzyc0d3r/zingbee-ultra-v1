"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

const PUBLIC_PATHS = ["/login", "/sso"]

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (PUBLIC_PATHS.includes(pathname)) {
      setChecked(true)
      return
    }

    // Verify session via API (cookie-based)
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("not authenticated")
        setChecked(true)
      })
      .catch(() => {
        localStorage.removeItem("student")
        localStorage.removeItem("organization")
        localStorage.removeItem("stats")
        router.replace("/login")
      })
  }, [pathname, router])

  if (!checked && !PUBLIC_PATHS.includes(pathname)) {
    return null // Don't flash content while checking auth
  }

  return <>{children}</>
}
