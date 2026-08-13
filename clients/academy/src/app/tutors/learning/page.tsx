"use client"

import type React from "react"
import { useEffect, useState, useRef, useCallback } from "react"
import { useChatStream } from "@/hooks/use-chat-stream"
import { CapsuleSidebar, type SidebarData } from "@/components/tutors/capsule-sidebar"
import { VocabularyBank } from "@/components/tutors/vocabulary-bank"
import { ScrollArea } from "@/components/shared/ui/scroll-area"
import { useTranslations } from "next-intl"
import { Button } from "@/components/shared/ui/button"
import { AutoGrowTextarea } from "@/components/tutors/auto-grow-textarea"
import { DashboardHeader } from "@/components/tutors/dashboard-header"
import { useAuth } from "@/hooks/use-auth"
import { useVoiceMode } from "@/hooks/use-voice-mode"
import {
  Send,
  Mic,
  MicOff,
  BookOpen,
  Beaker,
  Globe,
  Palette,
  AlertCircle,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/shared/ui/alert"
import { MessageFeedback } from "@/components/tutors/message-feedback"
import { EndSessionFeedbackDialog } from "@/components/tutors/end-session-feedback"
import { TtsButton } from "@/components/tutors/tts-button"
import { CopyButton } from "@/components/tutors/copy-button"
import { useAutoReadTts } from "@/hooks/use-auto-read-tts"
import { useAfkSessionEnd } from "@/hooks/use-afk-session-end"

// ---------------------------------------------------------------------------
// Markdown / preview components (kept from original)
// ---------------------------------------------------------------------------

const HtmlPreview = ({ html, allowScripts }: { html: string; allowScripts?: boolean }) => {
  const sanitizedHtml = html || "<div></div>"
  const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>body { font-family: ui-sans-serif, system-ui; margin: 0; padding: 12px; }</style>
  </head>
  <body>${sanitizedHtml}</body>
</html>`
  return (
    <iframe
      className="w-full h-[200px] rounded-lg border bg-white"
      sandbox={allowScripts ? "allow-scripts" : ""}
      srcDoc={srcDoc}
      title="HTML Preview"
    />
  )
}

const JsPreview = ({ code }: { code: string }) => {
  const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: ui-sans-serif, system-ui; margin: 0; padding: 12px; }
      #app { min-height: 24px; }
      pre { background: #f1f5f9; padding: 8px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <pre id="log"></pre>
    <script>
      const logEl = document.getElementById('log');
      const log = (...args) => { logEl.textContent += args.map(a => String(a)).join(' ') + '\\n'; };
      console.log = log; console.error = log;
    </script>
    <script>try { ${code} } catch (e) { console.error(e); }</script>
  </body>
</html>`
  return (
    <iframe className="w-full h-[200px] rounded-lg border bg-white" sandbox="allow-scripts" srcDoc={srcDoc} title="JavaScript Preview" />
  )
}

const MermaidPreview = ({ code }: { code: string }) => {
  const cleanCode = code
    .trim()
    .replace(/[\u2018\u2019\u0027\u0060]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\[([^\]]*)\(([^)]*)\)([^\]]*)\]/g, "[$1$2$3]")
    .replace(/\[([^\]]*)\(([^)]*)\)([^\]]*)\]/g, "[$1$2$3]")

  const escaped = cleanCode.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const srcDoc = `<!doctype html>
<html><head><meta charset="utf-8" /><style>body{font-family:ui-sans-serif,system-ui;margin:0;padding:12px;}.error{color:#dc2626;font-size:12px;padding:8px;background:#fef2f2;border-radius:4px;}.error-code{font-family:monospace;font-size:11px;white-space:pre-wrap;background:#f1f5f9;padding:8px;border-radius:4px;margin-top:8px;max-height:150px;overflow:auto;}</style></head>
<body><div id="diagram" class="mermaid">${escaped}</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'default'});
const el=document.getElementById('diagram');const code=el.textContent;
mermaid.render('mermaid-svg',code).then(r=>{el.innerHTML=r.svg}).catch(err=>{el.innerHTML='<div class="error">Mermaid Error: '+err.message+'</div><div class="error-code">'+code.replace(/</g,'&lt;')+'</div>';});
</script></body></html>`
  return <iframe className="w-full min-h-[220px] rounded-lg border bg-white" sandbox="allow-scripts" srcDoc={srcDoc} title="Mermaid Chart" />
}

const ReasoningBlock = ({ summary, children }: { summary: string; children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <div className="my-3 border border-purple-200 rounded-lg bg-purple-50/50 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 flex items-center gap-2 text-left text-sm font-medium text-purple-700 hover:bg-purple-100/50 transition-colors"
      >
        <ChevronRight className={`w-4 h-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        {summary}
      </button>
      {isOpen && (
        <div className="px-4 py-3 border-t border-purple-200 text-sm text-purple-900 bg-white/50">{children}</div>
      )}
    </div>
  )
}

const MarkdownContent = ({ content }: { content: string }) => {
  if (!content) return null

  const renderInline = (text: string) => {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    const segments: React.ReactNode[] = []
    let lastIndex = 0
    let match
    let segmentIndex = 0
    while ((match = imageRegex.exec(text)) !== null) {
      if (match.index > lastIndex)
        segments.push(<span key={`text-${segmentIndex++}`}>{renderTextFormatting(text.slice(lastIndex, match.index))}</span>)
      segments.push(
        <img key={`img-${segmentIndex++}`} src={match[2]} alt={match[1]} className="max-w-full h-auto rounded-lg my-2 shadow-md" style={{ maxHeight: "400px" }} />
      )
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length)
      segments.push(<span key={`text-${segmentIndex++}`}>{renderTextFormatting(text.slice(lastIndex))}</span>)
    return segments.length > 0 ? segments : renderTextFormatting(text)
  }

  const renderTextFormatting = (text: string) => {
    const parts = text.split(/(`[^`]+`)/)
    return parts.map((part, index) => {
      if (part.startsWith("`") && part.endsWith("`"))
        return <code key={`code-${index}`} className="bg-slate-100 px-1.5 py-0.5 rounded text-sm font-mono">{part.slice(1, -1)}</code>
      return part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((segment, i) => {
        if (!segment) return null
        if (segment.startsWith("**") && segment.endsWith("**")) return <strong key={`bold-${index}-${i}`}>{segment.slice(2, -2)}</strong>
        if (segment.startsWith("*") && segment.endsWith("*") && !segment.startsWith("**")) return <em key={`em-${index}-${i}`}>{segment.slice(1, -1)}</em>
        return segment
      })
    })
  }

  const renderBlocks = (text: string, keyPrefix: string) => {
    const lines = text.split("\n")
    const nodes: React.ReactNode[] = []
    let paragraph: string[] = []
    let listItems: React.ReactNode[] = []
    let listType: "ul" | "ol" | null = null
    let listIndex = 0
    let tableRows: string[][] = []
    let tableHeader: string[] | null = null

    const flushParagraph = () => {
      if (!paragraph.length) return
      nodes.push(<p key={`${keyPrefix}-p-${nodes.length}`} className="mt-2 first:mt-0">{renderInline(paragraph.join(" "))}</p>)
      paragraph = []
    }
    const flushList = () => {
      if (!listItems.length || !listType) return
      const Tag = listType === "ol" ? "ol" : "ul"
      const cls = listType === "ol" ? "list-decimal pl-5 mt-2 space-y-1" : "list-disc pl-5 mt-2 space-y-1"
      nodes.push(<Tag key={`${keyPrefix}-${listType}-${nodes.length}`} className={cls}>{listItems}</Tag>)
      listItems = []; listType = null; listIndex = 0
    }
    const flushTable = () => {
      if (!tableHeader && !tableRows.length) return
      nodes.push(
        <div key={`${keyPrefix}-table-${nodes.length}`} className="my-3 overflow-x-auto">
          <table className="min-w-full border-collapse border border-slate-200 text-sm">
            {tableHeader && (
              <thead className="bg-slate-100">
                <tr>{tableHeader.map((cell, i) => <th key={i} className="border border-slate-200 px-3 py-2 text-left font-semibold">{renderInline(cell.trim())}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  {row.map((cell, ci) => <td key={ci} className="border border-slate-200 px-3 py-2">{renderInline(cell.trim())}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      tableHeader = null; tableRows = []
    }

    const parseTableRow = (line: string): string[] | null => {
      if (!line.includes("|")) return null
      const trimmed = line.trim()
      if (!trimmed.startsWith("|") && !trimmed.endsWith("|")) return null
      const cells = trimmed.split("|").slice(1, -1)
      return cells.length ? cells : null
    }
    const isTableSeparator = (line: string) => /^\|?[\s\-:|]+\|?$/.test(line.trim()) && line.includes("-")

    const headingClasses: Record<number, string> = {
      1: "text-xl font-semibold mt-4", 2: "text-lg font-semibold mt-4",
      3: "text-base font-semibold mt-3", 4: "text-sm font-semibold mt-3",
      5: "text-sm font-semibold mt-2", 6: "text-sm font-semibold mt-2",
    }

    lines.forEach((rawLine, lineIndex) => {
      const line = rawLine.replace(/\s+$/, "")
      const trimmed = line.trim()

      if (!trimmed) { flushParagraph(); flushList(); flushTable(); return }

      const tableCells = parseTableRow(trimmed)
      if (tableCells) {
        flushParagraph(); flushList()
        if (isTableSeparator(trimmed)) {
          if (tableRows.length > 0 && !tableHeader) tableHeader = tableRows.shift() || null
          return
        }
        tableRows.push(tableCells); return
      }
      if (tableHeader || tableRows.length) flushTable()

      if (/^---+$/.test(trimmed)) { flushParagraph(); flushList(); nodes.push(<hr key={`${keyPrefix}-hr-${lineIndex}`} className="my-3 border-slate-200" />); return }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
      if (headingMatch) {
        flushParagraph(); flushList()
        const level = headingMatch[1].length
        const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements
        nodes.push(<HeadingTag key={`${keyPrefix}-h-${lineIndex}`} className={headingClasses[level]}>{renderInline(headingMatch[2])}</HeadingTag>)
        return
      }

      const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/)
      const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/)
      if (unorderedMatch || orderedMatch) {
        flushParagraph()
        const isOrdered = Boolean(orderedMatch)
        const currentType = isOrdered ? "ol" : "ul"
        if (listType && listType !== currentType) flushList()
        listType = currentType
        const itemText = (unorderedMatch || orderedMatch)?.[1] || ""
        listItems.push(<li key={`${keyPrefix}-li-${lineIndex}-${listIndex++}`}>{renderInline(itemText)}</li>)
        return
      }
      paragraph.push(trimmed)
    })
    flushParagraph(); flushList(); flushTable()
    return nodes
  }

  const renderMainContent = (text: string) => {
    const codeParts = text.split(/(```[\s\S]*?```)/)
    return (
      <div className="text-sm leading-relaxed">
        {codeParts.map((part, index) => {
          if (!part) return null
          if (part.startsWith("```")) {
            const raw = part.slice(3, -3)
            const lines = raw.split("\n")
            const firstLine = lines[0]?.trim() || ""
            const hasLanguage = lines.length > 1 && /^[a-zA-Z0-9 _-]+$/.test(firstLine)
            const language = hasLanguage ? firstLine.toLowerCase() : ""
            const codeContent = hasLanguage ? lines.slice(1).join("\n") : raw.trim()
            if (language === "mermaid") return <MermaidPreview key={`mermaid-${index}`} code={codeContent} />
            if (language === "html") return <HtmlPreview key={`html-${index}`} html={codeContent} allowScripts />
            if (language === "javascript" || language === "js") return <JsPreview key={`js-${index}`} code={codeContent} />
            if (["markdown", "md", "raw markdown", "raw"].includes(language))
              return <div key={`md-${index}`} className="mt-2 first:mt-0">{renderBlocks(codeContent, `md-${index}`)}</div>
            return (
              <pre key={`code-${index}`} className="bg-slate-100 rounded-lg p-3 my-2 overflow-x-auto">
                <code className="text-xs font-mono text-slate-800">{codeContent}</code>
              </pre>
            )
          }
          return <div key={`text-${index}`} className="mt-2 first:mt-0">{renderBlocks(part, `text-${index}`)}</div>
        })}
      </div>
    )
  }

  const renderWithDetails = (text: string): React.ReactNode[] => {
    const detailsRegex = /<details>\s*<summary>(.*?)<\/summary>\s*([\s\S]*?)\s*<\/details>/g
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match
    while ((match = detailsRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const before = text.slice(lastIndex, match.index)
        if (before.trim()) parts.push(<span key={`before-${match.index}`}>{renderMainContent(before)}</span>)
      }
      parts.push(
        <ReasoningBlock key={`details-${match.index}`} summary={match[1].replace(/\*\*/g, "")}>
          <div className="whitespace-pre-wrap">{match[2].trim()}</div>
        </ReasoningBlock>
      )
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) {
      const after = text.slice(lastIndex)
      if (after.trim()) parts.push(<span key={`after-${lastIndex}`}>{renderMainContent(after)}</span>)
    }
    return parts.length > 0 ? parts : [renderMainContent(text)]
  }

  if (content.includes("<details>")) return <div className="text-sm leading-relaxed">{renderWithDetails(content)}</div>
  return renderMainContent(content)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const tutorCharacters: Record<string, string> = {
  Luna: "\uD83E\uDD89", Max: "\uD83E\uDD16", Bella: "\uD83D\uDD2C",
  Coco: "\uD83C\uDFA8", Rocky: "\uD83C\uDF0D", Sunny: "\u2600\uFE0F",
}

const subjectThemes: Record<string, { gradient: string; buttonColor: string; icon: any }> = {
  "Reading & Writing": { gradient: "from-blue-50 via-indigo-50 to-purple-50", buttonColor: "bg-blue-500 hover:bg-blue-600", icon: BookOpen },
  "Math & Logic": { gradient: "from-violet-50 via-purple-50 to-indigo-50", buttonColor: "bg-violet-500 hover:bg-violet-600", icon: Beaker },
  "Science & Nature": { gradient: "from-sky-50 via-blue-50 to-indigo-50", buttonColor: "bg-sky-500 hover:bg-sky-600", icon: Beaker },
  "Art & Creativity": { gradient: "from-pink-50 via-rose-50 to-fuchsia-50", buttonColor: "bg-pink-500 hover:bg-pink-600", icon: Palette },
  "History & Geography": { gradient: "from-slate-50 via-stone-50 to-amber-50", buttonColor: "bg-slate-600 hover:bg-slate-700", icon: Globe },
  "Social Skills": { gradient: "from-rose-50 via-pink-50 to-red-50", buttonColor: "bg-rose-500 hover:bg-rose-600", icon: Palette },
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function LearningPage() {
  const { isLoading } = useAuth()
  const t = useTranslations()
  const chatStream = useChatStream()

  // True when streaming OR any image placeholder is visible on the page
  const hasImageLoading: boolean = chatStream.messages.some((m: any) => m.imageLoading && !m.imageUrl)
  const busy: boolean = chatStream.streaming || chatStream.waitingForImage || hasImageLoading

  // Screen-reader mastery cue: announce a genuine mastery event (which only
  // lands at EVIDENCE). No visible all-facts progress counter — one fact per
  // session, so a "covered / total" pill would just be noise.
  const [masteryAnnounce, setMasteryAnnounce] = useState("")
  const prevMasteredRef = useRef<number | null>(null)
  useEffect(() => {
    const mastered = chatStream.factsState.mastered ?? 0
    const prev = prevMasteredRef.current
    prevMasteredRef.current = mastered
    // Skip the first observation and any resume/reset (mastered not increasing),
    // so we never fire a false celebration for a previous session's facts or on
    // a back-to-back capsule where the count resets.
    if (prev === null || mastered <= prev) return
    setMasteryAnnounce(`Fact mastered. ${mastered} of ${chatStream.totalFacts} mastered.`)
    const t2 = setTimeout(() => setMasteryAnnounce(""), 4000)
    return () => { clearTimeout(t2) }
  }, [chatStream.factsState.mastered, chatStream.totalFacts])

  // Local UI state
  const [tutorData, setTutorData] = useState<any>(null)
  const [selectedTheme, setSelectedTheme] = useState<any>(null)
  const [studentData, setStudentData] = useState<any>(null)
  const [inputValue, setInputValue] = useState("")
  const [userName, setUserName] = useState("Alex")
  const [showAIWarning, setShowAIWarning] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [vocabCollapsed, setVocabCollapsed] = useState(false)
  const [isWide, setIsWide] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pinnedTerms, setPinnedTerms] = useState<string[]>([])
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [endFeedbackOpen, setEndFeedbackOpen] = useState(false)

  // Capsule / knowledge state derived from the stream's done events
  const [capsuleName, setCapsuleName] = useState("")
  const [themeName, setThemeName] = useState("")

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const greetingFiredRef = useRef(false)

  // Auto read-aloud (persistent). Voice comes from the tutor's persona in the DB;
  // fall back to a subject-based default for older sessions that don't carry a voice.
  const autoReadVoiceId =
    (tutorData?.voice as string | undefined) ||
    ({ Physics: "Sal", Biology: "Ara", Chemistry: "Eve", Math: "Rex", English: "Leo" } as Record<string, string>)[tutorData?.specialty || ""] ||
    "Sal"
  const { enabled: autoReadEnabled, toggle: toggleAutoRead, speak: speakText } = useAutoReadTts(autoReadVoiceId)
  const spokenMessageIdsRef = useRef<Set<number>>(new Set())

  // Simple dictation: mic → speech recognition → populate input box
  // Continuous mode + manual silence timer so the mic stays open through pauses.
  const SILENCE_TIMEOUT_MS = 8000
  const [dictating, setDictating] = useState(false)
  const recognitionRef = useRef<any>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleDictationToggle = () => {
    if (dictating) {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
      recognitionRef.current?.stop()
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = "en-US"
    const resetSilenceTimer = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(() => {
        try { rec.stop() } catch {}
      }, SILENCE_TIMEOUT_MS)
    }
    rec.onresult = (e: any) => {
      let text = ""
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      setInputValue(text)
      resetSilenceTimer()
    }
    rec.onend = () => {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
      setDictating(false)
      recognitionRef.current = null
    }
    rec.onerror = () => {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
      setDictating(false)
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    setDictating(true)
    rec.start()
    resetSilenceTimer()
  }

  // Voice — STT + TTS wrapping the text pipeline
  const {
    voiceState, isVoiceModeActive, startVoiceMode, stopVoiceMode,
    audioLevel, interimTranscript, error: voiceError, isSupported: voiceSupported,
  } = useVoiceMode({
    sendMessage: chatStream.sendMessage,
    setOnToken: chatStream.setOnToken,
    setOnDone: chatStream.setOnDone,
  })
  // Show voice error if any
  useEffect(() => {
    if (voiceError) { setChatError(voiceError); setShowAIWarning(true) }
  }, [voiceError])

  // Auto read-aloud: speak the latest assistant message exactly once, only after
  // streaming has fully finished. Triggers when `streaming` transitions true → false.
  const prevStreamingRef = useRef(false)
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current
    prevStreamingRef.current = chatStream.streaming
    if (!autoReadEnabled) return
    if (!(wasStreaming && !chatStream.streaming)) return // only on falling edge
    // Find the most recent assistant message with content
    for (let i = chatStream.messages.length - 1; i >= 0; i--) {
      const m: any = chatStream.messages[i]
      if (m.role !== "assistant" || !m.content) continue
      if (spokenMessageIdsRef.current.has(i)) break
      spokenMessageIdsRef.current.add(i)
      speakText(m.content)
      break
    }
  }, [chatStream.streaming, chatStream.messages, autoReadEnabled, speakText])

  // ------ Responsive sidebar ------
  useEffect(() => {
    const handleResize = () => {
      const wide = window.innerWidth >= 1200
      setSidebarCollapsed(!wide)
      setIsWide(wide)
    }
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // ------ Vocabulary Bank pins (per student + capsule, lesson-scoped) ------
  const vocabPinKey =
    studentData?.id && chatStream.capsuleName
      ? `vocabPins:${studentData.id}:${chatStream.capsuleName}`
      : null
  useEffect(() => {
    if (!vocabPinKey) return
    try {
      const raw = sessionStorage.getItem(vocabPinKey)
      setPinnedTerms(raw ? JSON.parse(raw) : [])
    } catch {
      setPinnedTerms([])
    }
  }, [vocabPinKey])
  const togglePin = useCallback(
    (term: string) => {
      setPinnedTerms((prev) => {
        const next = prev.some((p) => p.toLowerCase() === term.toLowerCase())
          ? prev.filter((p) => p.toLowerCase() !== term.toLowerCase())
          : [...prev, term]
        if (vocabPinKey) {
          try {
            sessionStorage.setItem(vocabPinKey, JSON.stringify(next))
          } catch {
            /* sessionStorage unavailable — pins stay in-memory only */
          }
        }
        return next
      })
    },
    [vocabPinKey]
  )

  // ------ Initialize from localStorage ------
  useEffect(() => {
    const selectedTutor = localStorage.getItem("selectedTutor")
    const selectedSubject = localStorage.getItem("selectedSubject")
    // Subject has specialty (e.g. "Biology"), tutor has name (e.g. "Aris")
    const subjectObj = selectedSubject ? JSON.parse(selectedSubject) : null
    const tutorObj = selectedTutor ? JSON.parse(selectedTutor) : null
    setTutorData({
      name: tutorObj?.name || subjectObj?.name || "Tutor",
      specialty: subjectObj?.specialty || tutorObj?.specialty || subjectObj?.name || "Science",
      ...subjectObj,
      ...tutorObj,
    })

    const topic = localStorage.getItem("selectedTheme")
    if (topic) {
      try {
        const themeData = JSON.parse(topic)
        setSelectedTheme(themeData)
        setThemeName(themeData.title || "")
      } catch {}
    }

    const userData = localStorage.getItem("user")
    if (userData) {
      try { setUserName(JSON.parse(userData).name || "Alex") } catch {}
    }

    const studentInfo = localStorage.getItem("student")
    if (studentInfo) {
      try { setStudentData(JSON.parse(studentInfo)) } catch {}
    }
  }, [])

  // ------ Fetch greeting on mount (once student + subject ready) ------
  useEffect(() => {
    if (!studentData?.id || !tutorData?.specialty || greetingFiredRef.current) return
    greetingFiredRef.current = true
    chatStream.fetchGreeting(studentData.id, tutorData.specialty, tutorData?.id || null)
  }, [studentData?.id, tutorData?.specialty, tutorData?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------ Scroll to bottom when messages change ------
  useEffect(() => {
    // Scroll ONLY the message list, not via scrollIntoView — that scrolls
    // every scrollable ancestor (incl. the overflow-hidden chat wrapper),
    // which pushes the input footer to mid-screen.
    const el = messagesScrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [chatStream.messages])

  // ------ Send a text message ------
  const handleSendMessage = useCallback(
    (text: string) => {
      if (!studentData?.id) { setChatError("Student information not found. Please log in again."); setShowAIWarning(true); return }
      if (!tutorData?.specialty) { setChatError("Please select a subject first."); setShowAIWarning(true); return }
      setChatError(null)
      setShowAIWarning(false)
      chatStream.sendMessage(studentData.id, text, tutorData.specialty)
    },
    [studentData?.id, tutorData?.specialty, chatStream] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim() && !busy) {
      // Immediately stop any active dictation — the mic must go dark the instant send is pressed.
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch {}
        recognitionRef.current = null
      }
      setDictating(false)
      handleSendMessage(inputValue.trim())
      setInputValue("")
    }
  }

  // ------ Voice mode ------
  const handleVoiceToggle = () => {
    if (isVoiceModeActive) { stopVoiceMode(); return }
    if (!studentData?.id || !tutorData?.specialty) return
    const lang = localStorage.getItem("preferredLanguage") || "en"
    startVoiceMode({
      studentId: studentData.id,
      subject: tutorData.specialty,
      language: lang,
    })
  }


  // ------ Derived values ------
  const theme = subjectThemes[tutorData?.specialty] || subjectThemes["Science & Nature"]
  const tutorCharacter = tutorCharacters[tutorData?.name] || "\uD83C\uDF93"
  const tutorIconPath = tutorData?.character_emoji?.startsWith("/") ? tutorData.character_emoji : null

  const renderTutorIcon = (size: "sm" | "md" | "lg" = "md") => {
    const sizeClasses = { sm: "w-6 h-6", md: "w-8 h-8", lg: "w-10 h-10" }
    if (tutorIconPath) return <img src={tutorIconPath} alt={tutorData?.name} className={sizeClasses[size]} />
    return <span className={size === "sm" ? "text-lg" : "text-xl"}>{tutorCharacter}</span>
  }

  // Actually terminates the session: calls /api/end-session, stashes the
  // summary in localStorage, and navigates to the summary page. Only invoked
  // after the student submits end-of-session feedback.
  const finalizeEndSession = useCallback(async () => {
    if (!studentData?.id) return
    try {
      const resp = await fetch(`/api/end-session/${studentData.id}`, { method: "POST", credentials: "include" })
      const data = await resp.json().catch(() => ({}))
      localStorage.setItem("sessionSummary", JSON.stringify({
        ...data,
        subject: tutorData?.specialty || "",
        theme: themeName || selectedTheme?.title || "",
        tutor: tutorData?.name || "",
        factsState: chatStream.factsState,
        totalFacts: chatStream.totalFacts,
        currentStep: chatStream.currentStep,
        questionsAsked: chatStream.questionsAsked,
        correctAnswers: chatStream.correctAnswers,
        sessionStartTime: localStorage.getItem("sessionStartTime"),
      }))
    } catch {}
    chatStream.resetState()
    window.location.href = "/tutors/session-summary"
  }, [studentData?.id, tutorData, themeName, selectedTheme, chatStream])

  // Public entry point for ending the session. Opens the feedback dialog;
  // the dialog calls finalizeEndSession after a successful submit.
  const handleStopSession = useCallback(() => {
    setEndFeedbackOpen(true)
  }, [])

  // Session end is student-paced: the green "Session complete" panel shows an
  // OK button and the feedback dialog only opens when the student clicks it —
  // never auto-popped over the tutor's wrap-up. Only an EXPIRED session
  // (already ended server-side — AFK sweep, another tab) auto-redirects to
  // the summary after a notice. endHandledRef keeps the whole flow one-shot
  // (without it, a re-render while finalizeEndSession navigates re-opened a
  // second blank dialog).
  const endHandledRef = useRef(false)
  useEffect(() => {
    if (!chatStream.endSessionData || chatStream.streaming) return
    if (endHandledRef.current || endFeedbackOpen) return
    if (chatStream.endSessionData.session_expired) {
      endHandledRef.current = true
      setChatError("This session has ended. Taking you to your session summary…")
      setShowAIWarning(true)
      const t2 = setTimeout(() => { void finalizeEndSession() }, 2500)
      return () => clearTimeout(t2)
    }
  }, [chatStream.endSessionData, chatStream.streaming, endFeedbackOpen, finalizeEndSession])

  // AFK auto-end: warn at 9 min, end at 10 min. Disable once the session has
  // already wrapped (endSessionData set) so we don't fight the natural-end UX.
  // Reset the idle timer on every chatStream.messages change so assistant
  // responses count as activity (server is doing work, student is engaged).
  const afkEnabled = Boolean(studentData?.id) && !chatStream.endSessionData && !endFeedbackOpen
  const { warning: afkWarning, dismissWarning: dismissAfkWarning } = useAfkSessionEnd({
    studentId: studentData?.id,
    enabled: afkEnabled,
    onEnd: () => { void finalizeEndSession() },
    externalActivityKey: chatStream.messages.length,
  })

  const sidebarData: SidebarData = {
    subject: tutorData?.specialty || "",
    theme: themeName || selectedTheme?.title || "",
    capsuleName: chatStream.capsuleName || capsuleName,
    currentFact: chatStream.currentFact,
    currentStep: chatStream.currentStep,
    tutor: { name: tutorData?.name || "", emoji: tutorData?.emoji || "\uD83C\uDF93" },
    factsState: chatStream.factsState,
    totalFacts: chatStream.totalFacts,
    phase: selectedTheme?.phase || chatStream.currentPhase,
    onStopSession: handleStopSession,
    busy: busy,
    allFacts: chatStream.allFacts,
    taughtTexts: chatStream.taughtTexts,
    assessedTexts: chatStream.assessedTexts,
    masteredTexts: chatStream.masteredTexts,
  }

  // ------ Loading state ------
  if (isLoading || !tutorData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
      <DashboardHeader busy={busy} />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar */}
        <div className={`bg-white border-r border-slate-200 transition-all duration-300 ${sidebarCollapsed ? "w-0" : "w-80"} overflow-hidden flex flex-col`}>
          <CapsuleSidebar data={sidebarData} />
        </div>

        {/* Sidebar Toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute left-0 top-1/2 -translate-y-1/2 bg-white border rounded-r-lg p-2 z-10 hover:bg-slate-50 transition-colors"
          style={{ left: sidebarCollapsed ? "0px" : "320px" }}
        >
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        {/* Center Chat Area. min-h-0 lets the overflow-y-auto messages child
            actually clamp this flex column — without it the column grows to its
            content height, overflows the wrapper, and scrollIntoView scrolls the
            footer to mid-screen (flexbox min-height:auto trap). */}
        <div className="flex-1 flex flex-col bg-white min-w-0 min-h-0">
          {/* Error banner */}
          {showAIWarning && (
            <div className="max-w-3xl mx-auto w-full px-4 pt-4">
              <Alert className="border-amber-200 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  {chatError || "Something went wrong. Please try again."}
                  <Button variant="ghost" size="sm" onClick={() => setShowAIWarning(false)} className="ml-2">
                    <X className="w-4 h-4" />
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Messages */}
          <div ref={messagesScrollRef} className="flex-1 overflow-y-auto min-h-0">
            <div className="max-w-3xl mx-auto p-6 space-y-4">
              {chatStream.messages.map((message, idx) => {
                // Show loading placeholder for image-loading messages (no content, imageLoading=true)
                // Falls through to the imageLoading block below

                // Image placeholder with URL
                if (message.imageUrl) {
                  return (
                    <div key={`img-${idx}`} className="max-w-[85%]">
                      <div className="rounded-2xl px-4 py-3 bg-slate-100">
                        <img src={message.imageUrl} alt={message.imageCaption || "AI generated image"}
                          className="max-w-full h-auto rounded-lg shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                          style={{ maxHeight: "400px" }}
                          onClick={() => setExpandedImage(message.imageUrl!)} />
                        {message.imageCaption && <p className="text-xs text-slate-500 mt-2">{message.imageCaption}</p>}
                      </div>
                    </div>
                  )
                }

                // Image loading placeholder - shimmer box matching image size
                if (message.imageLoading) {
                  return (
                    <div key={`imgload-${idx}`} className="max-w-[85%]">
                      <div className="w-full aspect-video rounded-2xl border border-slate-200 overflow-hidden relative" style={{ background: "linear-gradient(110deg, #f1f5f9 8%, #e2e8f0 18%, #f1f5f9 33%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s linear infinite" }}>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex items-center gap-2 text-slate-400 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating illustration...
                          </div>
                        </div>
                      </div>
                      <style jsx>{`@keyframes shimmer { to { background-position: -200% 0; } }`}</style>
                    </div>
                  )
                }

                // Count assistant feedback index (only among showFeedback messages)
                const assistantFeedbackIndex = message.role === "assistant" && message.showFeedback
                  ? chatStream.messages.slice(0, idx).filter((m) => m.role === "assistant" && m.showFeedback).length
                  : -1

                return (
                  <div key={`msg-${idx}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[85%]">
                      <div className={`rounded-2xl px-4 py-3 ${message.role === "user" ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-900"}`}>
                        <MarkdownContent content={message.content} />
                      </div>
                      {message.role === "assistant" && message.showFeedback && message.content && (
                        <div className="flex items-center gap-1 mt-1 ml-1">
                          <TtsButton enabled={autoReadEnabled} onToggle={toggleAutoRead} disabled={busy} />
                          <CopyButton text={message.content} disabled={busy} />
                          <MessageFeedback messageIndex={assistantFeedbackIndex} messageContent={message.content} disabled={busy} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Thinking indicator - orbiting dots */}
              {chatStream.thinkingLabel && (
                <div>
                  <div className="bg-slate-100 rounded-2xl px-5 py-4 inline-flex items-center gap-3 text-slate-500 text-sm">
                    <div className="relative w-6 h-6" style={{ animation: "orbitSpin 2s linear infinite" }}>
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="absolute w-2 h-2 rounded-full bg-blue-400" style={{
                          top: `${50 - 42 * Math.cos(i * Math.PI / 2)}%`,
                          left: `${50 + 42 * Math.sin(i * Math.PI / 2)}%`,
                          transform: "translate(-50%, -50%)",
                          animation: `dotPulse 1.2s ease-in-out ${i * 0.3}s infinite`,
                        }} />
                      ))}
                    </div>
                    <span style={{ animation: "blink 1.5s ease-in-out infinite" }}>{chatStream.thinkingLabel}...</span>
                  </div>
                  <style jsx>{`
                    @keyframes orbitSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                    @keyframes dotPulse { 0%, 100% { transform: translate(-50%,-50%) scale(0.6); opacity: 0.4; } 50% { transform: translate(-50%,-50%) scale(1.2); opacity: 1; } }
                    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
                  `}</style>
                </div>
              )}

              {/* Suggestion pills -- hide when session ended or in voice mode */}
              {!chatStream.endSessionData && !isVoiceModeActive && chatStream.suggestions.length > 0 && !busy && (
                <div role="group" aria-label={t("tutors.chat.suggestedReplies")} className="flex flex-wrap gap-2 pt-2 justify-start">
                  {chatStream.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        handleSendMessage(suggestion)
                        chatStream.setSuggestions([])
                        // keep keyboard focus in the conversation instead of
                        // dropping it to <body> when this button unmounts
                        chatInputRef.current?.focus()
                      }}
                      className="text-sm text-left max-w-full min-h-11 px-4 py-2 rounded-2xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-colors shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              {/* Screen-reader announcement for dynamically changing chips */}
              <div role="status" aria-live="polite" className="sr-only">
                {!chatStream.endSessionData && !busy && chatStream.suggestions.length > 0
                  ? `${chatStream.suggestions.length} ${t("tutors.chat.suggestedReplies")}`
                  : ""}
              </div>

              {/* Screen-reader announcement for a mastery event (no visible
                  all-facts progress counter — one fact per session). */}
              <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {masteryAnnounce}
              </div>

              {/* Session complete — student clicks OK when ready; that opens
                  the feedback dialog (never auto-popped over the wrap-up). */}
              {chatStream.endSessionData && !chatStream.streaming &&
                !chatStream.endSessionData.session_expired && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-6 py-5 text-center max-w-md">
                    <p className="text-emerald-800 font-semibold text-lg mb-1">Session complete!</p>
                    <p className="text-emerald-600 text-sm mb-4">Great work today — take a moment to read your tutor&apos;s wrap-up above.</p>
                    <Button
                      onClick={() => setEndFeedbackOpen(true)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-8"
                    >
                      OK
                    </Button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Vocabulary Bank — bottom drawer (narrow screens) */}
          {!isWide && chatStream.vocabBank.length > 0 && !chatStream.endSessionData && (
            <div className="border-t border-slate-200 bg-white">
              <button
                onClick={() => setDrawerOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 transition-colors"
                aria-expanded={drawerOpen}
              >
                <BookOpen className="w-4 h-4 text-blue-600 shrink-0" aria-hidden />
                <span className="text-sm font-medium text-slate-700">
                  {t("tutors.vocab.title")}
                </span>
                {/* Ambient cue: show the current fact's terms even when collapsed */}
                {!drawerOpen && (
                  <span className="flex-1 min-w-0 flex gap-1.5 overflow-hidden">
                    {chatStream.vocabBank
                      .filter((v) => v.status === "current")
                      .slice(0, 3)
                      .map((v) => (
                        <span key={v.term} className="text-[11px] bg-blue-50 text-blue-700 rounded px-1.5 py-0.5 whitespace-nowrap">
                          {v.term}
                        </span>
                      ))}
                  </span>
                )}
                <span className="ms-auto inline-flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold px-2 py-0.5 shrink-0">
                  {chatStream.vocabBank.length}
                </span>
                {drawerOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />}
              </button>
              {drawerOpen && (
                <div className="max-h-[40vh] border-t border-slate-100">
                  <VocabularyBank
                    terms={chatStream.vocabBank}
                    ageRange={chatStream.ageRange}
                    pinned={pinnedTerms}
                    onTogglePin={togglePin}
                    definitionsHidden={chatStream.definitionsHidden}
                    variant="drawer"
                  />
                </div>
              )}
            </div>
          )}

          {/* Input Area -- hide when session ended */}
          <div className={`border-t border-slate-200 bg-white p-4 ${chatStream.endSessionData ? "hidden" : ""}`}>
            {isVoiceModeActive ? (
              <div className="flex gap-3 max-w-3xl mx-auto items-center">
                <div className={`flex-1 h-12 rounded-lg border flex items-center justify-center gap-1 px-4 overflow-hidden ${
                  voiceState === "listening" ? "bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-300" :
                  voiceState === "thinking" ? "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-300" :
                  voiceState === "speaking" ? "bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-300" :
                  "bg-slate-50 border-slate-200"
                }`}>
                  {[...Array(20)].map((_, i) => {
                    const cd = Math.abs(i - 9.5) / 9.5
                    const base = 0.15 + (1 - cd) * 0.25
                    const h = voiceState === "listening"
                      ? base + audioLevel * (1 - cd) * 0.8
                      : base + (1 - cd) * 0.2
                    return (
                      <div
                        key={i}
                        className={`w-1 rounded-full ${
                          voiceState === "listening" ? "bg-purple-500" :
                          voiceState === "thinking" ? "bg-amber-400" :
                          voiceState === "speaking" ? "bg-blue-500" : "bg-slate-300"
                        }`}
                        style={{
                          height: `${Math.max(4, h * 40)}px`,
                          transition: voiceState === "listening" ? "height 75ms" : "height 300ms",
                          animation: voiceState === "speaking"
                            ? `pulse 0.4s ease-in-out ${i * 0.05}s infinite alternate`
                            : voiceState === "thinking"
                              ? `pulse 1.2s ease-in-out ${i * 0.1}s infinite alternate`
                              : undefined,
                        }}
                      />
                    )
                  })}
                  <span className={`ml-3 text-sm whitespace-nowrap min-w-0 truncate font-medium ${
                    voiceState === "listening" ? "text-purple-600" :
                    voiceState === "thinking" ? "text-amber-600" :
                    voiceState === "speaking" ? "text-blue-600" : "text-slate-500"
                  }`}>
                    {interimTranscript
                      ? `"${interimTranscript}"`
                      : voiceState === "speaking"
                        ? `${tutorData?.name || "Tutor"} is speaking...`
                        : voiceState === "thinking"
                          ? `${tutorData?.name || "Tutor"} is thinking...`
                          : t("tutors.voice.listening")}
                  </span>
                </div>
                <Button type="button" variant="destructive" onClick={handleVoiceToggle} className="flex-shrink-0 h-12 px-4" title={t("tutors.voice.endVoice")}>
                  <MicOff className="w-5 h-5 mr-2" />
                  {t("tutors.voice.endVoice")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto items-end">
                <div className="flex-1 min-w-0">
                  <AutoGrowTextarea
                    ref={chatInputRef}
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={() => {
                      if (inputValue.trim() && !busy) {
                        handleSubmit({ preventDefault: () => {} } as React.FormEvent)
                      }
                    }}
                    placeholder={
                      // Assessment phases have no chips and expect an ANSWER —
                      // "Ask a question..." at that moment misleads students
                      ["TRY", "EVIDENCE"].includes(chatStream.currentStep || "")
                        ? t("assessment.typeAnswer")
                        : t("tutors.chat.askQuestion")
                    }
                    disabled={busy}
                    minRows={1}
                    maxRows={8}
                  />
                </div>
                <Button
                  type="button"
                  variant={dictating ? "destructive" : "outline"}
                  onClick={handleDictationToggle}
                  disabled={busy}
                  title={dictating ? "Stop dictation" : "Dictate into the input box"}
                  className="shrink-0"
                >
                  {dictating ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button type="submit" disabled={!inputValue.trim() || busy} className={`${theme.buttonColor} shrink-0`}>
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            )}
          </div>
        </div>

        {/* Right Sidebar — Vocabulary Bank (wide screens) */}
        {isWide && chatStream.vocabBank.length > 0 && !chatStream.endSessionData && (
          <>
            <button
              onClick={() => setVocabCollapsed((v) => !v)}
              className="absolute top-1/3 -translate-y-1/2 bg-white border rounded-s-lg p-2 z-10 hover:bg-slate-50 transition-colors"
              style={{ insetInlineEnd: vocabCollapsed ? "0px" : "288px" }}
              aria-label={vocabCollapsed ? t("tutors.vocab.openBank") : t("tutors.vocab.closeBank")}
            >
              {vocabCollapsed ? <ChevronLeft className="w-4 h-4 rtl:rotate-180" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
            </button>
            <div
              className={`bg-white border-s border-slate-200 transition-all duration-300 ${vocabCollapsed ? "w-0" : "w-72"} overflow-hidden flex flex-col`}
              /* keep collapsed content out of the tab order */
              inert={vocabCollapsed ? true : undefined}
            >
              <VocabularyBank
                terms={chatStream.vocabBank}
                ageRange={chatStream.ageRange}
                pinned={pinnedTerms}
                onTogglePin={togglePin}
                definitionsHidden={chatStream.definitionsHidden}
                variant="sidebar"
              />
            </div>
          </>
        )}
      </div>
      {expandedImage && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center cursor-pointer"
          onClick={() => setExpandedImage(null)}>
          <img src={expandedImage} alt="Expanded" className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl" />
        </div>
      )}

      <EndSessionFeedbackDialog
        open={endFeedbackOpen}
        onComplete={() => {
          endHandledRef.current = true
          setEndFeedbackOpen(false)
          finalizeEndSession()
        }}
      />

      {afkWarning && (
        <div className="fixed inset-0 z-[210] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h2 className="text-lg font-semibold text-slate-900">Still there?</h2>
            <p className="text-slate-600 text-sm mt-2">
              You have been quiet for a while. Your session will end in about a minute
              if there is no activity.
            </p>
            <div className="flex gap-2 mt-5">
              <Button
                onClick={dismissAfkWarning}
                className={`${theme.buttonColor} flex-1`}
              >
                Keep going
              </Button>
              <Button
                variant="outline"
                onClick={() => { void finalizeEndSession() }}
                className="flex-1"
              >
                End now
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
