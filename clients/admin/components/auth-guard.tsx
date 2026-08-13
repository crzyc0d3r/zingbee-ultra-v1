"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Script from "next/script"
import { useAuth } from "@/lib/auth"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, loginWithGoogle } = useAuth()
  const [error, setError] = useState("")
  const googleBtnRef = useRef<HTMLDivElement>(null)

  const handleGoogleCallback = useCallback(async (response: any) => {
    setError("")
    try {
      await loginWithGoogle(response.credential)
    } catch (err: any) {
      setError(err.message || "Google login failed")
    }
  }, [loginWithGoogle])

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId || !googleBtnRef.current || user) return
    const initGoogle = () => {
      ;(window as any).google?.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCallback,
        use_fedcm_for_prompt: false,
      })
      ;(window as any).google?.accounts.id.renderButton(googleBtnRef.current!, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        width: 320,
      })
    }
    if ((window as any).google?.accounts) initGoogle()
    else (window as any).__googleLoginInit = initGoogle
  }, [user, handleGoogleCallback])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div>
            <h1 className="text-2xl font-bold">Academy Admin</h1>
            <p className="mt-2 text-muted-foreground">Sign in to continue</p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div ref={googleBtnRef} className="flex justify-center" />
          <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"
            onLoad={() => (window as any).__googleLoginInit?.()}
          />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
