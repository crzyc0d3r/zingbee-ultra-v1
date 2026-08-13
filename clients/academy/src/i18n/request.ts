import { getRequestConfig } from "next-intl/server"
import { cookies } from "next/headers"

const supportedLocales = ["en", "es", "zh", "hi", "ar", "fr", "pt", "bn", "ru", "de", "ur"]

export default getRequestConfig(async () => {
  // Get locale from cookie or default to 'en'
  const cookieStore = await cookies()
  const storedLocale = cookieStore.get("preferredLanguage")?.value
  const locale = storedLocale && supportedLocales.includes(storedLocale) ? storedLocale : "en"

  let messages = {}
  try {
    const common = (await import(`../../messages/${locale}/common.json`)).default
    const projects = await import(`../../messages/${locale}/projects.json`)
      .then((m) => m.default)
      .catch(() => ({}))
    const topics = await import(`../../messages/${locale}/topics.json`)
      .then((m) => m.default)
      .catch(() => ({}))
    messages = { ...common, projects, ...topics }
  } catch {
    // Fallback to English if locale messages not found
    const common = (await import(`../../messages/en/common.json`)).default
    const topics = await import(`../../messages/en/topics.json`)
      .then((m) => m.default)
      .catch(() => ({}))
    messages = { ...common, ...topics }
  }

  return {
    locale,
    messages,
    onError(error) {
      // Silently ignore missing message errors - just log in dev
      if (process.env.NODE_ENV === 'development') {
        console.warn('i18n:', error.message)
      }
    },
    getMessageFallback({ key }) {
      // Return empty string for missing messages instead of throwing
      return ''
    }
  }
})
