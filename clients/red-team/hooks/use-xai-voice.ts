"use client"

/**
 * LiveKit-based voice hook for ZingBee RT Studio.
 * Connects to LiveKit Cloud for audio transport (noise suppression, reliability).
 * A server-side LiveKit agent bridges audio to xAI's Realtime API.
 *
 * Preserves the same interface as the previous direct-WebSocket implementation
 * so page.tsx and other consumers don't need changes.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  DataPacket_Kind,
  ConnectionState,
  LocalParticipant,
  ParticipantEvent,
} from "livekit-client"
import type { ConnectionQuality } from "@/lib/voice-types"

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:9000"

export interface VoiceModeOptions {
  studentId: string
  subject?: string
  skipGreeting?: boolean
}

export interface UseXAIVoiceReturn {
  isVoiceModeActive: boolean
  startVoiceMode: (options: VoiceModeOptions) => Promise<void>
  stopVoiceMode: () => void
  isRecording: boolean
  isSpeaking: boolean
  isProcessing: boolean
  error: string | null
  transcript: string
  userTranscript: string
  setOnUserTranscriptReady: (cb: ((t: string) => void) | null) => void
  setOnAssistantTranscriptReady: (cb: ((t: string) => void) | null) => void
  setOnProcessTurnResult: (cb: ((result: any) => void) | null) => void
  setOnImageGenerated: (cb: ((imageUrl: string, topic: string) => void) | null) => void
  isConnected: boolean
  isConnecting: boolean
  connectionQuality: ConnectionQuality
  audioLevel: number
}

export function useXAIVoice(): UseXAIVoiceReturn {
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState("")
  const [userTranscript, setUserTranscript] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>("unknown")
  const [audioLevel, setAudioLevel] = useState(0)

  const roomRef = useRef<Room | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const onUserTranscriptReadyRef = useRef<((t: string) => void) | null>(null)
  const onAssistantTranscriptReadyRef = useRef<((t: string) => void) | null>(null)
  const onProcessTurnResultRef = useRef<((result: any) => void) | null>(null)
  const onImageGeneratedRef = useRef<((imageUrl: string, topic: string) => void) | null>(null)
  const audioLevelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Handle data messages from the LiveKit agent
  const handleDataMessage = useCallback((payload: Uint8Array) => {
    try {
      const msg = JSON.parse(new TextDecoder().decode(payload))
      console.log("[Voice/LK] Data message:", msg.type)

      switch (msg.type) {
        case "assistant_transcript":
          setTranscript(msg.text || "")
          onAssistantTranscriptReadyRef.current?.(msg.text || "")
          break

        case "user_transcript":
          setUserTranscript(msg.text || "")
          onUserTranscriptReadyRef.current?.(msg.text || "")
          break

        case "process_turn_result":
          setIsProcessing(false)
          onProcessTurnResultRef.current?.(msg.data)
          break

        case "image_generated":
          onImageGeneratedRef.current?.(msg.image_url, msg.topic)
          break
      }
    } catch (err) {
      console.error("[Voice/LK] Data parse error:", err)
    }
  }, [])

  const connect = useCallback(async (options: VoiceModeOptions) => {
    setIsConnecting(true)
    setError(null)

    try {
      // Get LiveKit token from our API (cookie-based auth via credentials: include)
      const resp = await fetch(`${API}/api/voice/livekit-token`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          student_id: options.studentId,
          subject: options.subject || "Biology",
        }),
      })

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.error || `Token request failed (${resp.status})`)
      }

      const { token, url } = await resp.json()
      console.log("[Voice/LK] Got LiveKit token, connecting to", url)

      // Create and connect to LiveKit room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      // Wire up events before connecting
      room.on(RoomEvent.Connected, () => {
        console.log("[Voice/LK] Connected to room")
        setIsConnected(true)
        setIsConnecting(false)
        setConnectionQuality("excellent")
      })

      room.on(RoomEvent.Disconnected, (reason) => {
        console.log("[Voice/LK] Disconnected, reason:", reason)
        setIsConnected(false)
        setIsVoiceModeActive(false)
        setConnectionQuality("unknown")
      })

      room.on(RoomEvent.MediaDevicesError, (err) => {
        console.error("[Voice/LK] Media device error:", err)
        setError("Microphone access failed: " + (err?.message || "unknown"))
      })

      room.on(RoomEvent.SignalConnected, () => {
        console.log("[Voice/LK] Signal connected")
      })

      room.on(RoomEvent.ParticipantConnected, (p) => {
        console.log("[Voice/LK] Participant connected:", p.identity)
      })

      room.on(RoomEvent.ConnectionQualityChanged, (_quality, participant) => {
        if (participant === room.localParticipant) {
          const q = _quality === 3 ? "excellent" : _quality === 2 ? "good" : _quality === 1 ? "poor" : "unknown"
          setConnectionQuality(q as ConnectionQuality)
        }
      })

      // Handle incoming audio from agent (xAI model's voice)
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        console.log("[Voice/LK] TrackSubscribed:", track.kind, "from:", participant.identity, "sid:", track.sid)
        if (track.kind === Track.Kind.Audio) {
          console.log("[Voice/LK] Attaching agent audio track")
          if (audioElementRef.current) {
            audioElementRef.current.remove()
          }
          const audio = track.attach() as HTMLAudioElement
          audio.autoplay = true
          audio.muted = false
          audio.volume = 1.0
          document.body.appendChild(audio)
          audioElementRef.current = audio
          audio.play().then(() => {
            console.log("[Voice/LK] Audio playback STARTED, paused:", audio.paused, "volume:", audio.volume)
          }).catch((err) => {
            console.error("[Voice/LK] Audio play() FAILED:", err.message)
          })
          setIsSpeaking(true)
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach(el => el.remove())
          audioElementRef.current = null
          setIsSpeaking(false)
        }
      })

      // Handle agent speaking state
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const agentSpeaking = speakers.some(p => p !== room.localParticipant)
        setIsSpeaking(agentSpeaking)
        setIsRecording(!agentSpeaking && isConnected)
      })

      // Handle data messages from agent
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        handleDataMessage(payload)
      })

      // Connect to room with audio enabled
      console.log("[Voice/LK] Calling room.connect()...")
      try {
        await room.connect(url, token)
        console.log("[Voice/LK] room.connect() resolved, state:", room.state)
      } catch (connectErr) {
        console.error("[Voice/LK] room.connect() FAILED:", connectErr)
        throw connectErr
      }

      // Enable microphone
      console.log("[Voice/LK] Enabling microphone...")
      await room.localParticipant.setMicrophoneEnabled(true)
      setIsRecording(true)
      console.log("[Voice/LK] Mic enabled, waiting for agent...")

      // Monitor local audio level
      audioLevelIntervalRef.current = setInterval(() => {
        const localPub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
        if (localPub?.track) {
          // audioLevel is 0-1 float
          setAudioLevel(Math.round((room.localParticipant.audioLevel || 0) * 100))
        }
      }, 100)

      roomRef.current = room
      console.log("[Voice/LK] Room connected, mic enabled")

    } catch (err) {
      console.error("[Voice/LK] Connect error:", err)
      setError(err instanceof Error ? err.message : "Connection failed")
      setIsConnecting(false)
      throw err
    }
  }, [handleDataMessage])

  const disconnect = useCallback(() => {
    if (audioLevelIntervalRef.current) {
      clearInterval(audioLevelIntervalRef.current)
      audioLevelIntervalRef.current = null
    }
    if (audioElementRef.current) {
      audioElementRef.current.remove()
      audioElementRef.current = null
    }
    roomRef.current?.disconnect()
    roomRef.current = null
    setIsConnected(false)
    setIsConnecting(false)
    setConnectionQuality("unknown")
    setIsRecording(false)
    setIsSpeaking(false)
    setIsProcessing(false)
    setAudioLevel(0)
  }, [])

  const startVoiceMode = useCallback(async (options: VoiceModeOptions) => {
    setError(null)
    setTranscript("")
    setUserTranscript("")

    try {
      await connect(options)
      setIsVoiceModeActive(true)
    } catch {
      setIsVoiceModeActive(false)
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
    isSpeaking,
    isProcessing,
    error,
    transcript,
    userTranscript,
    setOnUserTranscriptReady: useCallback((cb: ((t: string) => void) | null) => { onUserTranscriptReadyRef.current = cb }, []),
    setOnAssistantTranscriptReady: useCallback((cb: ((t: string) => void) | null) => { onAssistantTranscriptReadyRef.current = cb }, []),
    setOnProcessTurnResult: useCallback((cb: ((result: any) => void) | null) => { onProcessTurnResultRef.current = cb }, []),
    setOnImageGenerated: useCallback((cb: ((imageUrl: string, topic: string) => void) | null) => { onImageGeneratedRef.current = cb }, []),
    isConnected,
    isConnecting,
    connectionQuality,
    audioLevel,
  }
}
