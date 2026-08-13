import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const LANGUAGES = {
  es: 'Spanish',
  zh: 'Chinese (Simplified)',
  hi: 'Hindi',
  ar: 'Arabic',
  fr: 'French',
  pt: 'Portuguese (Brazilian)',
  bn: 'Bengali',
  ru: 'Russian',
  de: 'German',
  ur: 'Urdu'
}

async function translateJSON(content: string, targetLanguage: string, namespace: string): Promise<string> {
  const prompt = `You are a professional translator for an educational platform for children ages 6-12.

Translate the following JSON from English to ${targetLanguage}.

IMPORTANT RULES:
1. Preserve all JSON structure, keys, and {placeholder} variables exactly as they appear
2. Only translate the VALUES (text content), never the KEYS
3. Keep all technical terms, placeholders like {level}, {language}, etc. exactly as-is
4. Maintain child-friendly, age-appropriate language (ages 6-12)
5. Use culturally appropriate examples where relevant
6. Preserve formatting markers
7. For Arabic and Urdu, use proper RTL text

Namespace: ${namespace}

Source JSON:
${content}

Return ONLY the translated JSON, no explanations.`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a professional translator. You return only valid JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.3,
    max_tokens: 4000
  })

  const translated = response.choices[0]?.message?.content?.trim() || '{}'
  const cleaned = translated.replace(/^```json\s*\n?/, '').replace(/\n?```$/, '').trim()

  // Validate JSON
  JSON.parse(cleaned)

  return cleaned
}

async function main() {
  console.log('🌍 Starting Translation for academy-client\n')

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set')
    process.exit(1)
  }

  const messagesDir = path.join(__dirname, '..', 'messages')
  const englishDir = path.join(messagesDir, 'en')

  if (!fs.existsSync(englishDir)) {
    console.error('❌ English messages directory not found')
    process.exit(1)
  }

  const namespaces = fs.readdirSync(englishDir)
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace('.json', ''))

  console.log(`📦 Namespaces: ${namespaces.join(', ')}\n`)

  for (const namespace of namespaces) {
    const englishPath = path.join(englishDir, `${namespace}.json`)
    const englishContent = fs.readFileSync(englishPath, 'utf-8')

    for (const [locale, languageName] of Object.entries(LANGUAGES)) {
      try {
        console.log(`🔄 Translating ${namespace} to ${languageName} (${locale})...`)

        const translated = await translateJSON(englishContent, languageName, namespace)

        const targetDir = path.join(messagesDir, locale)
        const targetPath = path.join(targetDir, `${namespace}.json`)

        fs.mkdirSync(targetDir, { recursive: true })
        fs.writeFileSync(targetPath, translated, 'utf-8')

        console.log(`✅ Completed ${namespace} → ${locale}`)

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error: any) {
        console.error(`❌ Failed ${namespace} → ${locale}: ${error.message}`)
      }
    }
  }

  console.log('\n✨ Translation complete!')
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
