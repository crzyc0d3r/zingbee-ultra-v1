"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shared/ui/tooltip"
import { DashboardHeader } from "@/components/quests/dashboard-header"
import {
  Send, Loader2, FolderOpen, FileText, Copy, Check,
  ChevronLeft, ChevronRight, History, Trash2, Save, Lightbulb,
  Mic, MicOff, Volume2, VolumeX
} from "lucide-react"
import { apiClient, Project, ProjectFile, ChatSession, ChatMessage as DBChatMessage } from "@/lib/api-client"
import { useStudent } from "@/hooks/use-student"
import { useXAIVoice } from "@/hooks/use-xai-voice"
import { toast } from "sonner"

// Quest chat backend (/llm-chat/chat/completions/) was on the legacy
// .org service and has not been ported to api.zingbee.ai. Hard-disable
// the entrypoint until the endpoint is implemented in api/quest_routes.py.
// Typed as boolean (not literal `true`) so TS does not flag downstream
// existing fetch code as unreachable.
const QUEST_CHAT_DISABLED: boolean = false

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

// HTML Preview component
const HtmlPreview = ({ html, allowScripts }: { html: string; allowScripts?: boolean }) => {
  const sanitizedHtml = html || "<div></div>"
  const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: ui-sans-serif, system-ui; margin: 0; padding: 12px; }
    </style>
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

// JavaScript Preview component
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
      const log = (...args) => {
        logEl.textContent += args.map(a => String(a)).join(' ') + '\\n';
      };
      console.log = log;
      console.error = log;
    </script>
    <script>
      try { ${code} } catch (e) { console.error(e); }
    </script>
  </body>
</html>`

  return (
    <iframe
      className="w-full h-[200px] rounded-lg border bg-white"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      title="JavaScript Preview"
    />
  )
}

// Mermaid Preview component
const MermaidPreview = ({ code }: { code: string }) => {
  const escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: ui-sans-serif, system-ui; margin: 0; padding: 12px; }
    </style>
  </head>
  <body>
    <div class="mermaid">${escaped}</div>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <script>mermaid.initialize({ startOnLoad: true });</script>
  </body>
</html>`

  return (
    <iframe
      className="w-full h-[220px] rounded-lg border bg-white"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      title="Mermaid Chart"
    />
  )
}

// Markdown Content component
const MarkdownContent = ({ content }: { content: string }) => {
  if (!content) return null

  const renderInline = (text: string) => {
    const parts = text.split(/(`[^`]+`)/)
    return parts.map((part, index) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={`code-${index}`} className="bg-slate-100 px-1.5 py-0.5 rounded text-sm font-mono">
            {part.slice(1, -1)}
          </code>
        )
      }
      return part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((segment, i) => {
        if (!segment) return null
        if (segment.startsWith("**") && segment.endsWith("**")) {
          return <strong key={`bold-${index}-${i}`}>{segment.slice(2, -2)}</strong>
        }
        if (segment.startsWith("*") && segment.endsWith("*") && !segment.startsWith("**")) {
          return <em key={`em-${index}-${i}`}>{segment.slice(1, -1)}</em>
        }
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

    const flushParagraph = () => {
      if (paragraph.length === 0) return
      nodes.push(
        <p key={`${keyPrefix}-p-${nodes.length}`} className="mt-2 first:mt-0">
          {renderInline(paragraph.join(" "))}
        </p>
      )
      paragraph = []
    }

    const flushList = () => {
      if (listItems.length === 0 || !listType) return
      if (listType === "ol") {
        nodes.push(
          <ol key={`${keyPrefix}-ol-${nodes.length}`} className="list-decimal pl-5 mt-2 space-y-1">
            {listItems}
          </ol>
        )
      } else {
        nodes.push(
          <ul key={`${keyPrefix}-ul-${nodes.length}`} className="list-disc pl-5 mt-2 space-y-1">
            {listItems}
          </ul>
        )
      }
      listItems = []
      listType = null
      listIndex = 0
    }

    const headingClasses: Record<number, string> = {
      1: "text-xl font-semibold mt-4",
      2: "text-lg font-semibold mt-4",
      3: "text-base font-semibold mt-3",
      4: "text-sm font-semibold mt-3",
      5: "text-sm font-semibold mt-2",
      6: "text-sm font-semibold mt-2",
    }

    lines.forEach((rawLine, lineIndex) => {
      const line = rawLine.replace(/\s+$/, "")
      const trimmed = line.trim()

      if (!trimmed) {
        flushParagraph()
        flushList()
        return
      }

      if (/^---+$/.test(trimmed)) {
        flushParagraph()
        flushList()
        nodes.push(<hr key={`${keyPrefix}-hr-${lineIndex}`} className="my-3 border-slate-200" />)
        return
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
      if (headingMatch) {
        flushParagraph()
        flushList()
        const level = headingMatch[1].length
        const headingText = headingMatch[2]
        const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements
        nodes.push(
          <HeadingTag key={`${keyPrefix}-h-${lineIndex}`} className={headingClasses[level]}>
            {renderInline(headingText)}
          </HeadingTag>
        )
        return
      }

      const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/)
      const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/)
      if (unorderedMatch || orderedMatch) {
        flushParagraph()
        const isOrdered = Boolean(orderedMatch)
        const currentType = isOrdered ? "ol" : "ul"
        if (listType && listType !== currentType) {
          flushList()
        }
        listType = currentType
        const itemText = (unorderedMatch || orderedMatch)?.[1] || ""
        listItems.push(
          <li key={`${keyPrefix}-li-${lineIndex}-${listIndex++}`}>
            {renderInline(itemText)}
          </li>
        )
        return
      }

      paragraph.push(trimmed)
    })

    flushParagraph()
    flushList()

    return nodes
  }

  const parts = content.split(/(```[\s\S]*?```)/)
  return (
    <div className="text-sm leading-relaxed">
      {parts.map((part, index) => {
        if (!part) return null
        if (part.startsWith("```")) {
          const raw = part.slice(3, -3)
          const lines = raw.split("\n")
          const firstLine = lines[0]?.trim() || ""
          const hasLanguage = lines.length > 1 && /^[a-zA-Z0-9 _-]+$/.test(firstLine)
          const language = hasLanguage ? firstLine.toLowerCase() : ""
          const codeContent = hasLanguage ? lines.slice(1).join("\n") : raw.trim()

          if (language === "mermaid") {
            return <MermaidPreview key={`mermaid-${index}`} code={codeContent} />
          }
          if (language === "html") {
            return <HtmlPreview key={`html-${index}`} html={codeContent} allowScripts />
          }
          if (language === "javascript" || language === "js") {
            return <JsPreview key={`js-${index}`} code={codeContent} />
          }
          if (language === "markdown" || language === "md" || language === "raw markdown" || language === "raw") {
            return (
              <div key={`md-${index}`} className="mt-2 first:mt-0">
                {renderBlocks(codeContent, `md-${index}`)}
              </div>
            )
          }

          return (
            <pre key={`code-${index}`} className="bg-slate-100 rounded-lg p-3 my-2 overflow-x-auto">
              <code className="text-xs font-mono text-slate-800">{codeContent}</code>
            </pre>
          )
        }
        return (
          <div key={`text-${index}`} className="mt-2 first:mt-0">
            {renderBlocks(part, `text-${index}`)}
          </div>
        )
      })}
    </div>
  )
}

export default function ProjectChatPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  const { student } = useStudent()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const historyListRef = useRef<HTMLDivElement>(null)

  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [projectLoading, setProjectLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)

  // Chat history state
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Voice functionality - WebRTC-based voice conversation using XAI Realtime API
  // In voice mode, XAI handles everything - we just display messages, NO OpenAI calls
  const {
    isVoiceModeActive,
    startVoiceMode,
    stopVoiceMode,
    isRecording,
    isTranscribing,
    transcript,
    error: voiceError,
    isSpeaking,
    stopSpeaking,
    setOnUserTranscriptReady,
    setOnAssistantTranscriptReady,
    isConnected,
    isConnecting,
    connectionQuality,
    audioLevel,
    chatSessionId
  } = useXAIVoice()

  // Currently speaking message ID
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)

  // Voice session ID for saving exchanges
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null)
  const pendingUserTranscriptRef = useRef<string | null>(null)
  const streamingAssistantIdRef = useRef<string | null>(null)

  // Stream assistant transcript in real-time as XAI speaks
  useEffect(() => {
    if (!isVoiceModeActive) return

    // When transcript starts coming in, create or update streaming message
    if (transcript && transcript.trim()) {
      if (!streamingAssistantIdRef.current) {
        // Create new streaming message
        const newId = `voice-assistant-streaming-${Date.now()}`
        streamingAssistantIdRef.current = newId
        const streamingMessage: Message = {
          id: newId,
          role: "assistant",
          content: transcript,
        }
        setMessages((prev) => [...prev, streamingMessage])
      } else {
        // Update existing streaming message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingAssistantIdRef.current
              ? { ...m, content: transcript }
              : m
          )
        )
      }
    }
  }, [transcript, isVoiceModeActive])

  // Set up callbacks for voice mode messages (NO OpenAI submission - XAI handles the AI)
  useEffect(() => {
    // When user speaks and XAI transcribes it, display as user message
    setOnUserTranscriptReady((userText: string) => {
      if (userText.trim()) {
        const userMessage: Message = {
          id: `voice-user-${Date.now()}`,
          role: "user",
          content: userText.trim(),
        }
        setMessages((prev) => [...prev, userMessage])
        // Store for saving when assistant responds
        pendingUserTranscriptRef.current = userText.trim()
        // Reset streaming assistant ID for next response
        streamingAssistantIdRef.current = null
      }
    })

    // When XAI finishes responding, finalize the message and save exchange
    setOnAssistantTranscriptReady(async (assistantText: string) => {
      if (assistantText.trim()) {
        // Finalize the streaming message with complete text
        if (streamingAssistantIdRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingAssistantIdRef.current
                ? { ...m, content: assistantText.trim() }
                : m
            )
          )
        } else {
          // Fallback: create new message if streaming wasn't set up
          const assistantMessage: Message = {
            id: `voice-assistant-${Date.now()}`,
            role: "assistant",
            content: assistantText.trim(),
          }
          setMessages((prev) => [...prev, assistantMessage])
        }
        streamingAssistantIdRef.current = null

        // Save the voice exchange to database (session already exists from startVoiceMode)
        const userText = pendingUserTranscriptRef.current
        if (userText && student?.id && voiceSessionId) {
          try {
            const result = await apiClient.voice.saveExchange({
              student_id: student.id,
              user_message: userText,
              assistant_message: assistantText.trim(),
              session_id: voiceSessionId,  // Always use real session ID
              project_id: projectId,
            })

            // Update session preview with summary if returned
            if (result.session_preview) {
              setChatHistory(prev => prev.map(s =>
                s.id === voiceSessionId
                  ? { ...s, session_preview: result.session_preview }
                  : s
              ))
            }
            pendingUserTranscriptRef.current = null
          } catch (e) {
            console.error("Failed to save voice exchange:", e)
          }
        }
      }
    })

    return () => {
      setOnUserTranscriptReady(null)
      setOnAssistantTranscriptReady(null)
    }
  }, [setOnUserTranscriptReady, setOnAssistantTranscriptReady, student?.id, projectId, voiceSessionId])

  // Handle voice mode toggle
  const handleVoiceToggle = async () => {
    if (isVoiceModeActive) {
      stopVoiceMode()
    } else {
      if (!student?.id) {
        return // Can't start voice without student context
      }
      // Always start a new chat when entering voice mode
      handleNewChat()
      setVoiceSessionId(null)
      streamingAssistantIdRef.current = null

      // Pass student and project IDs - server builds full context from DB
      // Includes student profile, relevant memories, project document embeddings, and language
      const lang = localStorage.getItem("preferredLanguage") || "en"
      const sessionId = await startVoiceMode({
        studentId: student.id,
        projectId: projectId,
        language: lang
      })

      // Add session to chat history with real ID from backend
      if (sessionId) {
        setVoiceSessionId(sessionId)
        setCurrentSessionId(sessionId)
        setSessionId(sessionId)
        const newSession: ChatSession = {
          id: sessionId,
          student_id: student.id,
          project_id: projectId,
          started_at: new Date().toISOString(),
          session_preview: "New conversation",
          is_active: true
        }
        setChatHistory(prev => [newSession, ...prev])
      }
    }
  }

  // Handle text-to-speech for a message using browser speech synthesis
  const handleSpeak = (messageId: string, content: string) => {
    if (speakingMessageId === messageId) {
      // Stop speaking
      window.speechSynthesis.cancel()
      setSpeakingMessageId(null)
    } else {
      // Stop any current speech and start new
      window.speechSynthesis.cancel()
      setSpeakingMessageId(messageId)
      const utterance = new SpeechSynthesisUtterance(content)
      utterance.onend = () => setSpeakingMessageId(null)
      utterance.onerror = () => setSpeakingMessageId(null)
      window.speechSynthesis.speak(utterance)
    }
  }

  // Load sidebar state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("projectChatSidebarCollapsed")
    if (saved !== null) {
      setSidebarCollapsed(saved === "true")
    }
  }, [])

  // Save sidebar state to localStorage
  useEffect(() => {
    localStorage.setItem("projectChatSidebarCollapsed", String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Load project data and chat history
  useEffect(() => {
    const loadProject = async () => {
      if (!student?.id) return
      try {
        const [projectData, filesData] = await Promise.all([
          apiClient.projects.get(projectId),
          apiClient.projects.listFiles(projectId),
        ])
        setProject(projectData)
        setFiles(filesData.filter((f) => f.is_embedded))

        // Load chat history for this project
        const sessions = await apiClient.chatSessions.list(student.id, undefined, projectId)
        setChatHistory(sessions)
      } catch (e) {
        router.push("/quests/my-projects")
      } finally {
        setProjectLoading(false)
      }
    }
    if (student?.id) {
      loadProject()
    }
  }, [projectId, router, student?.id])

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleLoadChat = async (session: ChatSession) => {
    // Stop voice mode if active when switching to text chat
    if (isVoiceModeActive) {
      stopVoiceMode()
    }

    try {
      const loadedMessages = await apiClient.chatMessages.list(session.id)
      setMessages(loadedMessages.map((m: DBChatMessage) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content
      })))
      setCurrentSessionId(session.id)
      setSessionId(session.id)
    } catch (e) {
      // Failed to load chat session
    }
  }

  const handleDeleteChat = async (sessionIdToDelete: string) => {
    try {
      await apiClient.chatSessions.delete(sessionIdToDelete)
      setChatHistory(prev => prev.filter(s => s.id !== sessionIdToDelete))
      if (currentSessionId === sessionIdToDelete) {
        setMessages([])
        setCurrentSessionId(null)
        setSessionId(null)
      }
      setConfirmDeleteId(null)
    } catch (e) {
      // Failed to delete chat session
    }
  }

  const handleNewChat = () => {
    setMessages([])
    setCurrentSessionId(null)
    setSessionId(null)
    setThreadId(null)
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!inputValue.trim() || isLoading || !student?.id) return

    // Quest chat backend (/llm-chat/chat/completions/) is not yet ported to
    // the FastAPI service on api.zingbee.ai. Show a notice and bail out.
    if (QUEST_CHAT_DISABLED) {
      toast.error("Quest chat is temporarily unavailable", {
        description: "We're rebuilding this feature on the new backend. Check back soon.",
      })
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue.trim(),
    }
    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsLoading(true)

    // If this is a new conversation, add placeholder to chat history immediately
    const isNewConversation = !sessionId
    const tempSessionId = isNewConversation ? `temp-${Date.now()}` : null
    if (isNewConversation && tempSessionId) {
      const placeholderSession: ChatSession = {
        id: tempSessionId,
        student_id: student?.id || "",
        project_id: projectId,
        started_at: new Date().toISOString(),
        session_preview: "New conversation",
        is_active: true
      }
      setChatHistory(prev => [placeholderSession, ...prev])
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/llm-chat/chat/completions/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            user_message_content: userMessage.content,
            student_id: student.id,
            project_id: projectId,
            session_id: sessionId,
            thread_id: threadId,
            stream: true,
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
      }
      setMessages((prev) => [...prev, assistantMessage])

      if (reader) {
        let done = false
        while (!done) {
          const { value, done: readerDone } = await reader.read()
          done = readerDone
          if (value) {
            const chunk = decoder.decode(value)
            const lines = chunk.split("\n")
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6))
                  if (data.content) {
                    assistantMessage.content += data.content
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMessage.id ? { ...m, content: assistantMessage.content } : m
                      )
                    )
                  }
                  if (data.session_id && !sessionId) {
                    setSessionId(data.session_id)
                    setCurrentSessionId(data.session_id)
                    // Replace temp session with real session_id
                    if (isNewConversation && tempSessionId) {
                      setChatHistory(prev => prev.map(s =>
                        s.id === tempSessionId
                          ? { ...s, id: data.session_id }
                          : s
                      ))
                    }
                  }
                  if (data.thread_id) {
                    setThreadId(data.thread_id)
                  }
                  // Update session preview with summary when done
                  if (data.done && data.session_id && data.session_preview) {
                    setChatHistory(prev => prev.map(s =>
                      s.id === data.session_id
                        ? { ...s, session_preview: data.session_preview }
                        : s
                    ))
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        }
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, there was an error processing your request. Please try again.",
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handlePromptClick = async (promptText: string) => {
    if (isLoading || !student?.id || files.length === 0) return

    if (QUEST_CHAT_DISABLED) {
      toast.error("Quest chat is temporarily unavailable", {
        description: "We're rebuilding this feature on the new backend. Check back soon.",
      })
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: promptText.trim(),
    }
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    // If this is a new conversation, add placeholder to chat history immediately
    const isNewConversation = !sessionId
    const tempSessionId = isNewConversation ? `temp-prompt-${Date.now()}` : null
    if (isNewConversation && tempSessionId) {
      const placeholderSession: ChatSession = {
        id: tempSessionId,
        student_id: student?.id || "",
        project_id: projectId,
        started_at: new Date().toISOString(),
        session_preview: "New conversation",
        is_active: true
      }
      setChatHistory(prev => [placeholderSession, ...prev])
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/llm-chat/chat/completions/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            user_message_content: promptText,
            student_id: student.id,
            project_id: projectId,
            session_id: sessionId,
            thread_id: threadId,
            stream: true,
          }),
        }
      )

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
      }
      setMessages((prev) => [...prev, assistantMessage])

      if (reader) {
        let done = false
        while (!done) {
          const { value, done: readerDone } = await reader.read()
          done = readerDone
          if (value) {
            const chunk = decoder.decode(value)
            const lines = chunk.split("\n")
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6))
                  if (data.content) {
                    assistantMessage.content += data.content
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMessage.id ? { ...m, content: assistantMessage.content } : m
                      )
                    )
                  }
                  if (data.session_id && !sessionId) {
                    setSessionId(data.session_id)
                    setCurrentSessionId(data.session_id)
                    // Replace temp session with real session_id
                    if (isNewConversation && tempSessionId) {
                      setChatHistory(prev => prev.map(s =>
                        s.id === tempSessionId
                          ? { ...s, id: data.session_id }
                          : s
                      ))
                    }
                  }
                  if (data.thread_id) {
                    setThreadId(data.thread_id)
                  }
                  // Update session preview with summary when done
                  if (data.done && data.session_id && data.session_preview) {
                    setChatHistory(prev => prev.map(s =>
                      s.id === data.session_id
                        ? { ...s, session_preview: data.session_preview }
                        : s
                    ))
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        }
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, there was an error processing your request. Please try again.",
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-slate-50 to-purple-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
      </div>
    )
  }

  if (!project) {
    return null
  }

  const starterPrompts = [
    "Summarize the key points from my documents",
    "What are the main topics covered in these files?",
    "Find specific information about a concept",
    "Explain how ideas connect across the documents"
  ]

  return (
    <div className="h-screen bg-gradient-to-br from-orange-50 via-slate-50 to-purple-50 flex flex-col overflow-hidden">
        <DashboardHeader />

        <div className="flex-1 flex min-h-0 relative">
          {/* Left Sidebar - Chat History */}
          <div className={`bg-white border-r border-slate-200 transition-all duration-300 flex flex-col h-full ${sidebarCollapsed ? "w-0" : "w-72"} overflow-hidden`}>
            {!sidebarCollapsed && (
              <>
                {/* Project Info */}
                <div className="p-4 border-b bg-gradient-to-r from-purple-50 to-indigo-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center flex-shrink-0">
                      <FolderOpen className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h1 className="text-lg font-medium text-slate-900 truncate">{project.name}</h1>
                      <p className="text-sm text-slate-600">
                        {files.length} embedded file{files.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  {files.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {files.slice(0, 3).map((file) => (
                        <span
                          key={file.id}
                          className="inline-flex items-center gap-1 text-xs bg-white/60 text-slate-600 px-2 py-1 rounded-full"
                        >
                          <FileText className="w-3 h-3" />
                          {file.name.length > 15 ? file.name.slice(0, 15) + "..." : file.name}
                        </span>
                      ))}
                      {files.length > 3 && (
                        <span className="text-xs text-slate-500 px-2 py-1">+{files.length - 3} more</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Chat History Header */}
                <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2"><History className="w-4 h-4" /> Chat History</h3>
                  <button
                    onClick={handleNewChat}
                    className="group relative w-7 h-7 rounded-md border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50 flex items-center justify-center transition-all"
                    title="New Chat"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none">
                      <path stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit="4" d="M10 4c-1.864 0-2.796 0-3.531.304-.98.406-1.759 1.185-2.165 2.165C4 7.204 4 8.136 4 10v3.6c0 2.24 0 3.36.436 4.216.383.753.995 1.365 1.748 1.748C7.04 20 8.16 20 10.4 20h3.6c1.864 0 2.796 0 3.531-.304.98-.406 1.759-1.185 2.165-2.165.304-.735.304-1.667.304-3.531"/>
                      <path stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit="4" d="M19.5 7.5l-7.06 7.06c-.281.281-.663.44-1.06.44H9v-2.38c0-.397.159-.779.44-1.06L16.5 4.5a2.121 2.121 0 113 3z"/>
                    </svg>
                    <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                      New Chat
                    </span>
                  </button>
                </div>

                {/* Chat History List */}
                <div ref={historyListRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1 min-h-0">
                  {chatHistory.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-4">No chat history yet</p>
                  ) : (
                    chatHistory.map((session, index) => (
                      <div
                        key={session.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleLoadChat(session)
                        }}
                      >
                        <Card
                          className="h-[50px] cursor-pointer hover:bg-slate-50 group"
                        >
                          <CardContent className="h-full px-2 py-0 flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <p className="text-sm font-medium truncate leading-none cursor-default">
                                      {session.session_preview || "Chat session"}
                                    </p>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-xs">
                                    <p>{session.session_preview || "Chat session"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <p className="text-xs text-slate-500 leading-none">
                                {new Date(session.started_at).toLocaleDateString()}
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDeleteId(session.id)
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded transition-opacity"
                              title="Delete chat"
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </button>
                          </CardContent>
                        </Card>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col bg-white min-w-0">
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="max-w-3xl mx-auto p-6 space-y-4">
                {messages.length === 0 && (
                  <div className="py-8">
                    <div className="text-center mb-8">
                      <FolderOpen className="w-16 h-16 mx-auto text-slate-400 mb-4" />
                      <h2 className="text-2xl font-medium text-slate-900 mb-2">Chat with Your Documents</h2>
                      <p className="text-slate-600 max-w-xl mx-auto">Ask questions about your uploaded documents. The AI will use the content of your files to provide relevant answers.</p>
                    </div>

                  {/* Starter Prompts */}
                  {starterPrompts.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
                      {starterPrompts.map((prompt, idx) => (
                        <button
                          key={idx}
                          onClick={() => handlePromptClick(prompt)}
                          disabled={isLoading}
                          className={`p-4 text-left rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all text-sm text-slate-700 flex items-start gap-2 ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <span className="line-clamp-2">{prompt}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  </div>
                )}

              {messages.filter(msg => msg.content.trim()).map((message) => (
                <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === "user" ? "bg-blue-500" : "bg-gradient-to-br from-purple-500 to-pink-500"}`}>
                    {message.role === "user" ? (
                      <span className="text-white text-sm">{student?.first_name?.[0] || "U"}</span>
                    ) : (
                      <FileText className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div className="flex-1 max-w-[85%]">
                    <div className={`rounded-2xl px-4 py-3 ${message.role === "user" ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-900"}`}>
                      <MarkdownContent content={message.content} />
                    </div>
                    {message.role === "assistant" && (
                      <div className="mt-1 flex justify-start gap-2">
                        <button
                          type="button"
                          className="group relative w-6 h-6 rounded border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 flex items-center justify-center"
                          title="Copy assistant message"
                          aria-label="Copy assistant message"
                          onClick={() => handleCopy(message.content, message.id)}
                        >
                          {copiedId === message.id ? (
                            <Check className="w-4 h-4 text-slate-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            Copy
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`group relative w-6 h-6 rounded border flex items-center justify-center ${speakingMessageId === message.id ? "border-blue-400 text-blue-600 bg-blue-50" : "border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300"}`}
                          title={speakingMessageId === message.id ? "Stop reading" : "Read aloud"}
                          aria-label={speakingMessageId === message.id ? "Stop reading" : "Read aloud"}
                          onClick={() => handleSpeak(message.id, message.content)}
                        >
                          {speakingMessageId === message.id ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            {speakingMessageId === message.id ? "Stop" : "Read"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="group relative w-6 h-6 rounded border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 flex items-center justify-center"
                          title="Save to project"
                          aria-label="Save to project"
                        >
                          <Save className="w-4 h-4" />
                          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            Save
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3 justify-start">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input Area */}
            <div className="border-t bg-white p-4 flex-shrink-0">
              {voiceError && (
                <div className="max-w-3xl mx-auto mb-3 text-center text-sm text-red-500">
                  {voiceError}
                </div>
              )}

              {isVoiceModeActive || isConnecting ? (
                /* Voice Mode UI - Sound Wave Visualization */
                <div className="flex gap-3 max-w-3xl mx-auto items-center">
                  <div className="flex-1 h-12 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 flex items-center justify-center gap-1 px-4 overflow-hidden">
                    {isConnecting ? (
                      <div className="flex items-center gap-2 text-purple-600">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-sm">Connecting to voice server...</span>
                      </div>
                    ) : (
                      /* Sound wave bars - height based on audio level */
                      <>
                        {[...Array(20)].map((_, i) => {
                          const centerDistance = Math.abs(i - 9.5) / 9.5
                          const baseHeight = 0.3 + (1 - centerDistance) * 0.4
                          const dynamicHeight = baseHeight + audioLevel * (1 - centerDistance) * 0.6
                          const delay = i * 0.05
                          return (
                            <div
                              key={i}
                              className={`w-1 rounded-full transition-all duration-75 ${
                                isSpeaking ? "bg-blue-500" : isRecording ? "bg-purple-500" : "bg-purple-300"
                              }`}
                              style={{
                                height: `${Math.max(8, dynamicHeight * 40)}px`,
                                opacity: isSpeaking || isRecording ? 1 : 0.5,
                                animation: isSpeaking ? `pulse 0.5s ease-in-out ${delay}s infinite alternate` : undefined
                              }}
                            />
                          )
                        })}
                        <span className="ml-3 text-sm text-purple-600 whitespace-nowrap">
                          {isSpeaking ? "AI speaking..." : isRecording ? "Listening..." : `Ready (${connectionQuality})`}
                        </span>
                      </>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleVoiceToggle}
                    disabled={isConnecting}
                    className="flex-shrink-0 h-12 px-4"
                    title="Stop voice conversation"
                  >
                    <MicOff className="w-5 h-5 mr-2" />
                    End
                  </Button>
                </div>
              ) : (
                /* Text Mode UI - Normal Input */
                <form onSubmit={handleSubmit} className="flex gap-3 max-w-3xl mx-auto">
                  <Input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Ask a question about your documents..."
                    disabled={isLoading || files.length === 0}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleVoiceToggle}
                    disabled={isLoading || files.length === 0}
                    className="flex-shrink-0"
                    title="Start voice conversation"
                  >
                    <Mic className="w-5 h-5" />
                  </Button>
                  <Button
                    type="submit"
                    disabled={!inputValue.trim() || isLoading || files.length === 0}
                    className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600"
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </Button>
                </form>
              )}

              {files.length === 0 && (
                <p className="text-center text-sm text-amber-600 mt-3">
                  No embedded documents found. Upload and wait for documents to be processed before chatting.
                </p>
              )}

              {!isVoiceModeActive && !isConnecting && (
                <p className="text-xs text-slate-500 mt-2 text-center">
                  Type a message or click the microphone for AI-powered voice conversation.
                </p>
              )}
            </div>
          </div>

          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="absolute left-0 top-1/2 -translate-y-1/2 bg-white border rounded-r-lg p-2 z-10" style={{ left: sidebarCollapsed ? "0px" : "288px" }}>
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Delete Confirmation Modal */}
        {confirmDeleteId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-xl">
              <h3 className="text-lg font-medium text-slate-900 mb-2">Delete Chat?</h3>
              <p className="text-slate-600 mb-4">This action cannot be undone.</p>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDeleteChat(confirmDeleteId)}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
  )
}
