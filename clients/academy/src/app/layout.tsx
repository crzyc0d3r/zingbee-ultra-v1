"use client"

import type React from "react"
import localFont from "next/font/local"
import { Geist_Mono } from "next/font/google"
import { Suspense, useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { getLocaleFromStorage, rtlLocales, type Locale } from "@/lib/i18n"
import { AuthGate } from "@/components/auth-gate"
import "./globals.css"

const proximaNova = localFont({
  src: [
    { path: "../../public/fonts/ProximaNova-Light.otf", weight: "300", style: "normal" },
    { path: "../../public/fonts/ProximaNova-Regular.otf", weight: "400", style: "normal" },
    { path: "../../public/fonts/ProximaNova-RegularItalic.otf", weight: "400", style: "italic" },
    { path: "../../public/fonts/ProximaNova-Semibold.otf", weight: "600", style: "normal" },
    { path: "../../public/fonts/ProximaNova-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

function PoweredByLogo() {
  const pathname = usePathname()
  if (pathname?.includes("/learning")) return null
  return null
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const [locale, setLocale] = useState<Locale>("en")
  const [messages, setMessages] = useState<any>(null)

  useEffect(() => {
    const currentLocale = getLocaleFromStorage()
    setLocale(currentLocale)

    Promise.all([
      import(`../../messages/${currentLocale}/common.json`),
      import(`../../messages/${currentLocale}/projects.json`).catch(() => ({ default: {} })),
    ])
      .then(([common, projects]) => {
        setMessages({
          ...common.default,
          projects: projects.default,
        })
      })
      .catch((err) => {
        console.error("Failed to load translation messages:", err)
        setMessages({})
      })
  }, [])

  const isRTL = rtlLocales.includes(locale)

  if (!messages) {
    return (
      <html lang={locale} dir={isRTL ? "rtl" : "ltr"} suppressHydrationWarning>
        <body className={`font-sans ${proximaNova.variable} ${geistMono.variable}`}>
          <div>Loading...</div>
        </body>
      </html>
    )
  }

  return (
    <html lang={locale} dir={isRTL ? "rtl" : "ltr"} suppressHydrationWarning>
      <body className={`font-sans ${proximaNova.variable} ${geistMono.variable}`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthGate>
            <Suspense fallback={<div>Loading...</div>}>
              {children}
            </Suspense>
          </AuthGate>
          <PoweredByLogo />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
