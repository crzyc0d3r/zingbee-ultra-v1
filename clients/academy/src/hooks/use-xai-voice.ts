"use client"

/**
 * XAI Voice hook - connects directly to XAI's realtime API
 * Based on reference implementation from web/client
 */

import { useState, useCallback, useRef, useEffect } from "react"
import { float32ToPCM16Base64, base64PCM16ToFloat32 } from "@/lib/audio"
import type { XAIMessage, ConnectionQuality } from "@/lib/types/voice-types"

// Get voice session URL from environment
function getVoiceSessionUrl(): string {
  if (process.env.NEXT_PUBLIC_VOICE_SESSION_URL) {
    return process.env.NEXT_PUBLIC_VOICE_SESSION_URL
  }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000/api"
  return `${apiUrl}/voice/session`
}

const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime"
const CHUNK_DURATION_MS = 100

export interface VoiceModeOptions {
  studentId: string
  questId?: string
  projectId?: string
  subjectId?: string
  themeId?: string
  voice?: string
  language?: string  // Language code for responses (e.g., "en", "es", "zh")
}

export interface UseXAIVoiceReturn {
  isVoiceModeActive: boolean
  startVoiceMode: (options?: VoiceModeOptions) => Promise<string | null>  // Returns session ID
  stopVoiceMode: () => void
  isRecording: boolean
  isTranscribing: boolean
  startRecording: () => void
  stopRecording: () => Promise<string | null>
  isSpeaking: boolean
  speak: (text: string) => Promise<void>
  stopSpeaking: () => void
  error: string | null
  transcript: string
  userTranscript: string
  setOnUserTranscriptReady: (callback: ((transcript: string) => void) | null) => void
  setOnAssistantTranscriptReady: (callback: ((transcript: string) => void) | null) => void
  onTranscriptReady: ((transcript: string) => void) | null
  setOnTranscriptReady: (callback: ((transcript: string) => void) | null) => void
  isConnected: boolean
  isConnecting: boolean
  connectionQuality: ConnectionQuality
  audioLevel: number
  chatSessionId: string | null  // The real session ID from the backend
}

export function useXAIVoice(): UseXAIVoiceReturn {
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing] = useState(false)
  const [chatSessionId, setChatSessionId] = useState<string | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState("")
  const [userTranscript, setUserTranscript] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>("unknown")
  const [audioLevel, setAudioLevel] = useState(0)

  // Refs
  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null)
  const playbackQueueRef = useRef<Float32Array[]>([])
  const isPlayingRef = useRef(false)
  const currentPlaybackSourceRef = useRef<AudioBufferSourceNode | null>(null)

  // Session state
  const sessionConfigRef = useRef<{ voice: string; instructions: string; sampleRate: number } | null>(null)
  const isSessionConfiguredRef = useRef(false)

  // Transcript refs
  const assistantTranscriptRef = useRef("")
  const onTranscriptReadyRef = useRef<((transcript: string) => void) | null>(null)
  const onUserTranscriptReadyRef = useRef<((transcript: string) => void) | null>(null)
  const onAssistantTranscriptReadyRef = useRef<((transcript: string) => void) | null>(null)

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
      console.log(`[XAI] Audio context: ${audioContextRef.current.sampleRate}Hz`)
    }
    return audioContextRef.current
  }, [])

  // Configure XAI session after conversation.created
  const configureSession = useCallback((ws: WebSocket) => {
    if (!sessionConfigRef.current) return

    const { voice, instructions, sampleRate } = sessionConfigRef.current
    console.log(`[XAI] Configuring session: ${sampleRate}Hz, voice: ${voice}`)

    const sessionConfig = {
      type: "session.update",
      session: {
        instructions,
        voice,
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: sampleRate,
            },
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: sampleRate,
            },
          },
        },
        turn_detection: {
          type: "server_vad",
        },
      },
    }

    ws.send(JSON.stringify(sessionConfig))
  }, [])

  // Send initial greeting after session.updated
  const sendInitialGreeting = useCallback((ws: WebSocket) => {
    console.log("[XAI] Session configured, sending greeting...")

    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }))

    const greetingMessage = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Say hello and introduce yourself briefly" }],
      },
    }
    ws.send(JSON.stringify(greetingMessage))
    ws.send(JSON.stringify({ type: "response.create" }))

    console.log("[XAI] Ready for voice interaction")
  }, [])

  // Play next audio chunk
  const playNextChunk = useCallback((audioContext: AudioContext) => {
    if (playbackQueueRef.current.length === 0) {
      isPlayingRef.current = false
      currentPlaybackSourceRef.current = null
      setIsSpeaking(false)
      return
    }

    const chunk = playbackQueueRef.current.shift()!
    const audioBuffer = audioContext.createBuffer(1, chunk.length, audioContext.sampleRate)
    audioBuffer.getChannelData(0).set(chunk)

    const source = audioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(audioContext.destination)
    currentPlaybackSourceRef.current = source

    source.onended = () => {
      if (currentPlaybackSourceRef.current === source) {
        currentPlaybackSourceRef.current = null
      }
      playNextChunk(audioContext)
    }
    source.start()
  }, [])

  const playAudio = useCallback((base64Audio: string) => {
    try {
      const audioContext = getAudioContext()
      const float32Data = base64PCM16ToFloat32(base64Audio)
      playbackQueueRef.current.push(float32Data)

      if (!isPlayingRef.current) {
        isPlayingRef.current = true
        setIsSpeaking(true)
        playNextChunk(audioContext)
      }
    } catch (err) {
      console.error("[XAI] Playback error:", err)
    }
  }, [getAudioContext, playNextChunk])

  const stopPlayback = useCallback(() => {
    if (currentPlaybackSourceRef.current) {
      try {
        currentPlaybackSourceRef.current.stop()
        currentPlaybackSourceRef.current.disconnect()
      } catch {}
      currentPlaybackSourceRef.current = null
    }
    playbackQueueRef.current = []
    isPlayingRef.current = false
    setIsSpeaking(false)
  }, [])

  // Handle XAI messages
  const handleMessage = useCallback((message: XAIMessage, ws: WebSocket) => {
    // Configure session after conversation.created
    if (message.type === "conversation.created" && !isSessionConfiguredRef.current) {
      console.log("[XAI] Conversation created, configuring...")
      configureSession(ws)
    }

    // Send greeting after session.updated
    if (message.type === "session.updated" && !isSessionConfiguredRef.current) {
      isSessionConfiguredRef.current = true
      setIsConnected(true)
      setIsConnecting(false)
      setConnectionQuality("good")
      sendInitialGreeting(ws)
    }

    // Handle audio output
    if (message.type === "response.output_audio.delta" && "delta" in message) {
      playAudio(message.delta as string)
    }

    // Handle transcript
    if (message.type === "response.output_audio_transcript.delta" && "delta" in message) {
      assistantTranscriptRef.current += message.delta
      setTranscript(assistantTranscriptRef.current)
    }

    // Handle response done
    if (message.type === "response.done") {
      if (assistantTranscriptRef.current) {
        onAssistantTranscriptReadyRef.current?.(assistantTranscriptRef.current)
        onTranscriptReadyRef.current?.(assistantTranscriptRef.current)
      }
      assistantTranscriptRef.current = ""
    }

    // Handle user speech
    if (message.type === "input_audio_buffer.speech_started") {
      setIsRecording(true)
      stopPlayback()
    }

    if (message.type === "input_audio_buffer.speech_stopped") {
      setIsRecording(false)
    }

    // Handle user transcript
    if (message.type === "conversation.item.added" && "item" in message) {
      const item = message.item as { role?: string; content?: Array<{ type?: string; transcript?: string }> }
      if (item.role === "user" && item.content) {
        for (const content of item.content) {
          if (content.type === "input_audio" && content.transcript) {
            setUserTranscript(content.transcript)
            onUserTranscriptReadyRef.current?.(content.transcript)
            break
          }
        }
      }
    }

    // Handle errors
    if (message.type === "error" && "error" in message) {
      const err = message.error as { message?: string }
      setError(err.message || "Unknown error")
    }
  }, [configureSession, sendInitialGreeting, playAudio, stopPlayback])

  // Start audio capture
  const startAudioCapture = useCallback((sampleRate: number) => {
    navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    }).then(async (stream) => {
      const audioContext = getAudioContext()
      mediaStreamRef.current = stream

      if (audioContext.state === "suspended") {
        await audioContext.resume()
      }

      const source = audioContext.createMediaStreamSource(stream)
      sourceNodeRef.current = source

      const bufferSize = 4096
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1)

      let audioBuffer: Float32Array[] = []
      let totalSamples = 0
      const chunkSizeSamples = (audioContext.sampleRate * CHUNK_DURATION_MS) / 1000

      processor.onaudioprocess = (event) => {
        // Don't send audio until session is configured
        if (!isSessionConfiguredRef.current) return

        const inputData = event.inputBuffer.getChannelData(0)
        audioBuffer.push(new Float32Array(inputData))
        totalSamples += inputData.length

        // Calculate RMS audio level for visualization (0-1 normalized)
        let sum = 0
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i]
        }
        const rms = Math.sqrt(sum / inputData.length)
        const normalizedLevel = Math.min(1, rms * 3)
        setAudioLevel(normalizedLevel)

        while (totalSamples >= chunkSizeSamples) {
          const chunk = new Float32Array(chunkSizeSamples)
          let offset = 0

          while (offset < chunkSizeSamples && audioBuffer.length > 0) {
            const buffer = audioBuffer[0]
            const needed = chunkSizeSamples - offset
            const available = buffer.length

            if (available <= needed) {
              chunk.set(buffer, offset)
              offset += available
              totalSamples -= available
              audioBuffer.shift()
            } else {
              chunk.set(buffer.subarray(0, needed), offset)
              audioBuffer[0] = buffer.subarray(needed)
              offset += needed
              totalSamples -= needed
            }
          }

          const base64Audio = float32ToPCM16Base64(chunk)
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: "input_audio_buffer.append",
              audio: base64Audio,
            }))
          }
        }
      }

      processorNodeRef.current = processor
      source.connect(processor)
      processor.connect(audioContext.destination)

      console.log(`[XAI] Audio capture started: ${audioContext.sampleRate}Hz`)
    }).catch((err) => {
      console.error("[XAI] Capture error:", err)
      setError(`Microphone error: ${err.message}`)
    })
  }, [getAudioContext])

  const stopAudioCapture = useCallback(() => {
    processorNodeRef.current?.disconnect()
    processorNodeRef.current = null
    sourceNodeRef.current?.disconnect()
    sourceNodeRef.current = null
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    mediaStreamRef.current = null
  }, [])

  // Connect to XAI
  const connect = useCallback(async (options?: VoiceModeOptions): Promise<string | null> => {
    const sessionUrl = getVoiceSessionUrl()
    console.log(`[XAI] Getting token from ${sessionUrl}`)

    setIsConnecting(true)
    setError(null)

    try {
      // Get ephemeral token with context parameters
      const response = await fetch(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          voice: options?.voice,
          student_id: options?.studentId,
          quest_id: options?.questId,
          project_id: options?.projectId,
          subject_id: options?.subjectId,
          theme_id: options?.themeId,
          language: options?.language || localStorage.getItem("preferredLanguage") || "en",
        }),
      })

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.status}`)
      }

      const data = await response.json()
      if (data.error || data.detail) {
        throw new Error(data.error || data.detail)
      }

      const token = data.client_secret?.value
      if (!token) throw new Error("No token received")

      // Store the real session ID from the backend
      const sessionId = data.session_id || null
      setChatSessionId(sessionId)
      if (sessionId) {
        console.log(`[XAI] Chat session created: ${sessionId}`)
      }

      // Get sample rate
      const audioContext = getAudioContext()
      const sampleRate = audioContext.sampleRate

      sessionConfigRef.current = {
        voice: data.voice || "ara",
        instructions: data.instructions || "",
        sampleRate,
      }
      isSessionConfiguredRef.current = false

      console.log(`[XAI] Connecting to ${XAI_REALTIME_URL}`)

      const ws = new WebSocket(XAI_REALTIME_URL, [
        "realtime",
        `openai-insecure-api-key.${token}`,
        "openai-beta.realtime-v1",
      ])

      ws.onopen = () => {
        console.log("[XAI] WebSocket connected")
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as XAIMessage
          if (!["ping", "input_audio_buffer.append", "response.output_audio.delta"].includes(message.type)) {
            console.log(`[XAI] ${message.type}`)
          }
          handleMessage(message, ws)
        } catch (err) {
          console.error("[XAI] Parse error:", err)
        }
      }

      ws.onerror = () => {
        setError("WebSocket error")
        setIsConnecting(false)
      }

      ws.onclose = (event) => {
        console.log(`[XAI] Closed: ${event.code}`)
        setIsConnected(false)
        setIsConnecting(false)
        isSessionConfiguredRef.current = false
      }

      wsRef.current = ws

      // Start audio capture
      startAudioCapture(sampleRate)

      return sessionId

    } catch (err) {
      console.error("[XAI] Connect error:", err)
      setError(err instanceof Error ? err.message : "Connection failed")
      setIsConnecting(false)
      throw err
    }
  }, [getAudioContext, handleMessage, startAudioCapture])

  const disconnect = useCallback(() => {
    stopAudioCapture()
    stopPlayback()
    wsRef.current?.close()
    wsRef.current = null
    audioContextRef.current?.close()
    audioContextRef.current = null
    sessionConfigRef.current = null
    isSessionConfiguredRef.current = false
    setIsConnected(false)
    setIsConnecting(false)
    setConnectionQuality("unknown")
    setIsRecording(false)
    setIsSpeaking(false)
    setChatSessionId(null)
  }, [stopAudioCapture, stopPlayback])

  const startVoiceMode = useCallback(async (options?: VoiceModeOptions): Promise<string | null> => {
    setError(null)
    setTranscript("")
    setUserTranscript("")
    assistantTranscriptRef.current = ""

    try {
      const sessionId = await connect(options)
      setIsVoiceModeActive(true)
      return sessionId
    } catch (err) {
      setIsVoiceModeActive(false)
      return null
    }
  }, [connect])

  const stopVoiceMode = useCallback(() => {
    setIsVoiceModeActive(false)
    disconnect()
  }, [disconnect])

  useEffect(() => {
    return () => { disconnect() }
  }, [disconnect])

  return {
    isVoiceModeActive,
    startVoiceMode,
    stopVoiceMode,
    isRecording,
    isTranscribing,
    startRecording: useCallback(() => {}, []),
    stopRecording: useCallback(async () => null, []),
    isSpeaking,
    speak: useCallback(async () => {}, []),
    stopSpeaking: stopPlayback,
    error,
    transcript,
    userTranscript,
    setOnUserTranscriptReady: useCallback((cb: ((t: string) => void) | null) => { onUserTranscriptReadyRef.current = cb }, []),
    setOnAssistantTranscriptReady: useCallback((cb: ((t: string) => void) | null) => { onAssistantTranscriptReadyRef.current = cb }, []),
    onTranscriptReady: onTranscriptReadyRef.current,
    setOnTranscriptReady: useCallback((cb: ((t: string) => void) | null) => { onTranscriptReadyRef.current = cb }, []),
    isConnected,
    isConnecting,
    connectionQuality,
    audioLevel,
    chatSessionId,
  }
}
