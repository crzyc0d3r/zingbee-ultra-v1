"use client"

import type React from "react"

import { Button } from "@/components/shared/ui/button"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Input } from "@/components/shared/ui/input"
import { Label } from "@/components/shared/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/shared/ui/alert"
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react"
import Link from "next/link"
import Script from "next/script"
import { useRouter } from "next/navigation"
import { useState, useEffect, useRef, useCallback } from "react"
import Image from "next/image"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>("")
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const turnstileWidgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    const render = () => {
      const ts = (window as any).turnstile
      if (!ts || !turnstileRef.current || turnstileWidgetId.current) return
      turnstileWidgetId.current = ts.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      })
    }
    if ((window as any).turnstile) render()
    else (window as any).__turnstileOnLoad = render
  }, [])

  const handleGoogleSuccess = useCallback(async (credential: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await apiClient.auth.googleLogin(credential)
      localStorage.setItem("student", JSON.stringify(result.student))
      localStorage.setItem("organization", JSON.stringify(result.organization))
      if (!localStorage.getItem("stats")) {
        localStorage.setItem("stats", JSON.stringify({ lessonsCompleted: 0, currentStreak: 0, totalTime: 0 }))
      }
      toast.success("Welcome!", { description: `Signed in with Google` })
      router.push("/select-dashboard")
    } catch (err: any) {
      setError(err.message || "Google login failed")
    } finally {
      setIsLoading(false)
    }
  }, [router])

  const renderGoogleButton = useCallback(() => {
    const el = googleBtnRef.current
    if (!el || !window.google?.accounts) return
    el.innerHTML = ""
    window.google.accounts.id.renderButton(el, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      width: 309,
    })
  }, [])

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId || !googleBtnRef.current) return
    const initGoogle = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: (response: any) => handleGoogleSuccess(response.credential),
        use_fedcm_for_prompt: false,
      } as any)
      renderGoogleButton()
    }
    if (window.google?.accounts) initGoogle()
    else window.__googleLoginInit = initGoogle
  }, [handleGoogleSuccess, renderGoogleButton])


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Please complete the human verification.")
      return
    }
    setIsLoading(true)
    setError(null)

    try {
      const slug = process.env.NEXT_PUBLIC_ORGANIZATION_SLUG || "academy"

      // Call backend auth endpoint - this validates password and sets httpOnly cookie
      const result = await apiClient.auth.studentLogin(username, password, slug, turnstileToken || undefined)

      // Store student and organization in localStorage for UI purposes
      // (Session is secured via httpOnly cookie, not localStorage)
      localStorage.setItem("student", JSON.stringify(result.student))
      localStorage.setItem("organization", JSON.stringify(result.organization))

      // Initialize stats if they don't exist (Legacy/Frontend state)
      if (!localStorage.getItem("stats")) {
        localStorage.setItem(
          "stats",
          JSON.stringify({
            lessonsCompleted: 0,
            currentStreak: 0,
            totalTime: 0,
          }),
        )
      }

      toast.success("Welcome back!", {
        description: `Logged in as ${result.student.first_name}`
      })

      router.push("/select-dashboard")

    } catch (error: any) {
      console.error("Login failed:", error)
      // Check if it's an auth error vs connection error
      if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
        setError("Incorrect user name or password. Please try again.")
      } else if (error.message?.includes("404")) {
        setError("Student not found in this organization. Please check your username.")
      } else {
        setError("Could not connect to the learning server. Please ensure the backend is running.")
      }
      const ts = (window as any).turnstile
      if (ts && turnstileWidgetId.current) {
        ts.reset(turnstileWidgetId.current)
        setTurnstileToken("")
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-[373px]">
        <Card className="border border-border shadow-lg min-w-[250px]">
          <CardContent className="pt-6 pb-6 px-8">
            <div className="text-center mb-4">
              <div className="w-16 h-16 flex items-center justify-center mx-auto mb-3">
                <Image
                  src="/tutor-themed.svg"
                  alt="Academy"
                  width={80}
                  height={80}
                  className="w-full h-full object-contain"
                />
              </div>
              <h1 className="text-2xl font-medium text-primary mb-1">Welcome Back!</h1>
              <p className="text-sm text-muted-foreground">Sign in to continue your learning adventure</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Login Failed</AlertTitle>
                  <AlertDescription>
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              <div>
                <Input
                  id="username"
                  placeholder="Enter your email"
                  className="h-12 placeholder:text-muted-foreground/50 placeholder:font-light"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    if (error) setError(null)
                  }}
                  disabled={isLoading}
                />
              </div>

              <div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  className="h-12 placeholder:text-muted-foreground/50 placeholder:font-light"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError(null)
                  }}
                  disabled={isLoading}
                />
              </div>

              {TURNSTILE_SITE_KEY && (
                <div ref={turnstileRef} className="flex justify-center" />
              )}

              <Button
                type="submit"
                className="w-full h-12 bg-foreground text-white hover:bg-foreground/90 text-base"
                disabled={isLoading || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Start Learning!"
                )}
              </Button>

            </form>

            {TURNSTILE_SITE_KEY && (
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnLoad"
                strategy="afterInteractive"
              />
            )}

            {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or</span>
                  </div>
                </div>
                <div className="relative w-full" style={{ height: 48 }}>
                  <div ref={googleBtnRef} className="absolute inset-0 w-full" style={{ opacity: 0.01, zIndex: 2 }} />
                  <Button
                    type="button"
                    className="absolute inset-0 w-full h-full bg-foreground text-white hover:bg-foreground/90 text-base gap-3"
                    disabled={isLoading}
                    style={{ zIndex: 1 }}
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff"/>
                    </svg>
                    Sign in with Google
                  </Button>
                </div>
                <Script
                  src="https://accounts.google.com/gsi/client"
                  strategy="afterInteractive"
                  onLoad={() => window.__googleLoginInit?.()}
                />
              </>
            )}

            <div className="flex justify-center mt-2">
              <img src="/zinger.png" alt="Powered by ZingBee" className="h-20 w-auto object-contain opacity-40" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
