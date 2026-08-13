export const locales = ["en", "es", "zh", "hi", "ar", "fr", "pt", "bn", "ru", "de", "ur"] as const
export type Locale = (typeof locales)[number]

export const localeNames: Record<Locale, { name: string; flag: string }> = {
  en: { name: "English", flag: "🇺🇸" },
  es: { name: "Español", flag: "🇪🇸" },
  zh: { name: "中文", flag: "🇨🇳" },
  hi: { name: "हिन्दी", flag: "🇮🇳" },
  ar: { name: "العربية", flag: "🇸🇦" },
  fr: { name: "Français", flag: "🇫🇷" },
  pt: { name: "Português", flag: "🇧🇷" },
  bn: { name: "বাংলা", flag: "🇧🇩" },
  ru: { name: "Русский", flag: "🇷🇺" },
  de: { name: "Deutsch", flag: "🇩🇪" },
  ur: { name: "اردو", flag: "🇵🇰" },
}

export const rtlLocales: Locale[] = ["ar", "ur"]

export function getLocaleFromStorage(): Locale {
  if (typeof window === "undefined") return "en"
  const stored = localStorage.getItem("preferredLanguage")
  return (stored && locales.includes(stored as Locale)) ? (stored as Locale) : "en"
}

export function setLocaleInStorage(locale: Locale): void {
  if (typeof window === "undefined") return
  localStorage.setItem("preferredLanguage", locale)
  // Also set cookie for server-side locale detection
  document.cookie = `preferredLanguage=${locale};path=/;max-age=31536000;SameSite=Lax`
}
