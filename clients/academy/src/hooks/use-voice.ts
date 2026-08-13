"use client"

import { useState, useEffect, useCallback, useRef } from "react"

// Debug logging helper
const log = (category: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
  if (data !== undefined) {
    console.log(`[VOICE ${timestamp}] [${category}] ${message}`, data)
  } else {
    console.log(`[VOICE ${timestamp}] [${category}] ${message}`)
  }
}

function getApiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL
  if (!url) throw new Error("NEXT_PUBLIC_API_URL is not set")
  log("CONFIG", "Using NEXT_PUBLIC_API_URL", url)
  return url
}

export interface UseVoiceReturn {
  // Voice conversation mode
  isVoiceModeActive: boolean
  startVoiceMode: () => void
  stopVoiceMode: () => void
  
  // Speech-to-Text (Recording)
  isRecording: boolean
  isTranscribing: boolean
  startRecording: () => void
  stopRecording: () => Promise<string | null>
  
  // Text-to-Speech
  isSpeaking: boolean
  speak: (text: string) => Promise<void>
  stopSpeaking: () => void
  
  // State
  error: string | null
  transcript: string
  
  // Callback for when recording ends with transcript
  onTranscriptReady: ((transcript: string) => void) | null
  setOnTranscriptReady: (callback: ((transcript: string) => void) | null) => void
}

export function useVoice(): UseVoiceReturn {
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState("")
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const onTranscriptReadyRef = useRef<((transcript: string) => void) | null>(null)
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const isRecordingRef = useRef(false) // Track recording state for async callbacks
  const frameCountRef = useRef(0) // Track animation frames for logging

  // Clean up on unmount
  useEffect(() => {
    log("LIFECYCLE", "Voice hook mounted")
    return () => {
      log("LIFECYCLE", "Voice hook unmounting, cleaning up...")
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current)
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  // Check for silence during recording
  const checkForSilence = useCallback(() => {
    if (!analyserRef.current || !isRecordingRef.current) {
      return
    }

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(dataArray)
    
    // Calculate average volume
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
    
    // Log every 30 frames (~0.5 second at 60fps)
    frameCountRef.current++
    if (frameCountRef.current % 30 === 0) {
      log("AUDIO", `Volume level: ${average.toFixed(1)}, Silence started: ${silenceStartRef.current ? 'yes' : 'no'}`)
    }
    
    // If volume is very low, consider it silence
    if (average < 10) {
      if (!silenceStartRef.current) {
        silenceStartRef.current = Date.now()
        log("SILENCE", "Silence detected, starting timer...")
      } else {
        const silenceDuration = Date.now() - silenceStartRef.current
        if (silenceDuration > 1500) {
          log("SILENCE", `1.5 seconds of silence reached, stopping recording...`)
          stopRecordingAndTranscribe()
          return
        }
      }
    } else {
      if (silenceStartRef.current) {
        log("SILENCE", "Sound detected, resetting silence timer")
      }
      silenceStartRef.current = null
    }

    // Continue checking
    if (isRecordingRef.current) {
      requestAnimationFrame(checkForSilence)
    }
  }, [])

  // Stop recording and get transcript
  const stopRecordingAndTranscribe = useCallback(async () => {
    log("RECORD", "stopRecordingAndTranscribe called")
    
    if (!mediaRecorderRef.current) {
      log("RECORD", "No media recorder found")
      return null
    }
    
    if (mediaRecorderRef.current.state === "inactive") {
      log("RECORD", "Media recorder already inactive")
      return null
    }

    log("RECORD", `Media recorder state: ${mediaRecorderRef.current.state}`)
    isRecordingRef.current = false

    return new Promise<string | null>((resolve) => {
      const recorder = mediaRecorderRef.current!
      
      recorder.onstop = async () => {
        log("RECORD", "MediaRecorder onstop fired")
        setIsRecording(false)
        
        // Stop the stream
        if (streamRef.current) {
          log("RECORD", "Stopping media stream tracks")
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }

        // Close audio context
        if (audioContextRef.current) {
          log("RECORD", "Closing audio context")
          audioContextRef.current.close()
          audioContextRef.current = null
        }

        log("RECORD", `Audio chunks collected: ${audioChunksRef.current.length}`)
        
        if (audioChunksRef.current.length === 0) {
          log("RECORD", "No audio chunks, aborting transcription")
          resolve(null)
          return
        }

        // Create blob from chunks
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        
        log("RECORD", `Audio blob created: ${audioBlob.size} bytes, type: ${mimeType}`)
        
        if (audioBlob.size < 1000) {
          log("RECORD", "Audio blob too small (<1000 bytes), probably no speech")
          resolve(null)
          return
        }

        setIsTranscribing(true)
        log("TRANSCRIBE", "Starting transcription...")
        
        try {
          const apiUrl = getApiUrl()
          log("TRANSCRIBE", `Sending audio to ${apiUrl}/voice/transcribe`)
          
          // Send to backend for transcription
          const formData = new FormData()
          formData.append("audio", audioBlob, `recording.${mimeType.split('/')[1]}`)

          const response = await fetch(`${apiUrl}/voice/transcribe`, {
            method: "POST",
            credentials: "include",
            body: formData
          })

          log("TRANSCRIBE", `Response status: ${response.status}`)

          if (!response.ok) {
            const errorText = await response.text()
            log("TRANSCRIBE", `Error response: ${errorText}`)
            const errorData = JSON.parse(errorText).catch(() => ({}))
            throw new Error(errorData.detail || `Transcription failed: ${response.status}`)
          }

          const data = await response.json()
          log("TRANSCRIBE", "Transcription response:", data)
          
          const transcribedText = data.text?.trim() || ""
          
          log("TRANSCRIBE", `Transcribed text: "${transcribedText}"`)
          setTranscript(transcribedText)
          
          if (transcribedText && onTranscriptReadyRef.current) {
            log("TRANSCRIBE", "Calling onTranscriptReady callback")
            onTranscriptReadyRef.current(transcribedText)
          } else if (!transcribedText) {
            log("TRANSCRIBE", "No text transcribed")
          } else {
            log("TRANSCRIBE", "No onTranscriptReady callback set")
          }
          
          resolve(transcribedText)
        } catch (err: any) {
          log("TRANSCRIBE", `Transcription error: ${err.message}`, err)
          setError(`Transcription failed: ${err.message}`)
          resolve(null)
        } finally {
          setIsTranscribing(false)
        }
      }

      log("RECORD", "Calling recorder.stop()")
      recorder.stop()
    })
  }, [])

  // Start recording audio
  const startRecording = useCallback(async () => {
    log("RECORD", "startRecording called")
    
    try {
      setError(null)
      setTranscript("")
      audioChunksRef.current = []
      silenceStartRef.current = null
      frameCountRef.current = 0

      log("RECORD", "Requesting microphone access...")
      
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        } 
      })
      
      log("RECORD", "Microphone access granted", {
        tracks: stream.getAudioTracks().map(t => ({ label: t.label, enabled: t.enabled, muted: t.muted }))
      })
      
      streamRef.current = stream

      // Set up audio analysis for silence detection
      log("RECORD", "Setting up audio context for silence detection")
      audioContextRef.current = new AudioContext()
      const source = audioContextRef.current.createMediaStreamSource(stream)
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 256
      source.connect(analyserRef.current)

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      log("RECORD", `Creating MediaRecorder with mimeType: ${mimeType}`)
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
          log("RECORD", `Audio chunk received: ${event.data.size} bytes, total chunks: ${audioChunksRef.current.length}`)
        }
      }

      mediaRecorder.onerror = (event: any) => {
        log("RECORD", "MediaRecorder error:", event.error)
        setError(`Recording error: ${event.error?.message || 'Unknown error'}`)
      }

      log("RECORD", "Starting MediaRecorder...")
      mediaRecorder.start(100) // Collect data every 100ms
      isRecordingRef.current = true
      setIsRecording(true)
      
      log("RECORD", "MediaRecorder started, beginning silence detection")

      // Start silence detection
      requestAnimationFrame(checkForSilence)

    } catch (err: any) {
      log("RECORD", `Recording error: ${err.name} - ${err.message}`, err)
      
      if (err.name === "NotAllowedError") {
        setError("Microphone access denied. Please allow microphone access in your browser settings.")
      } else if (err.name === "NotFoundError") {
        setError("No microphone found. Please connect a microphone.")
      } else {
        setError(`Recording failed: ${err.message}`)
      }
      setIsRecording(false)
      isRecordingRef.current = false
    }
  }, [checkForSilence])

  // Manual stop recording
  const stopRecording = useCallback(async (): Promise<string | null> => {
    log("RECORD", "Manual stopRecording called")
    return stopRecordingAndTranscribe()
  }, [stopRecordingAndTranscribe])

  // Text-to-Speech using OpenAI TTS
  const speak = useCallback(async (text: string): Promise<void> => {
    log("TTS", `speak called with ${text.length} characters`)
    
    if (!text.trim()) {
      log("TTS", "Empty text, skipping")
      return
    }

    try {
      setIsSpeaking(true)
      setError(null)

      const apiUrl = getApiUrl()
      log("TTS", `Sending TTS request to ${apiUrl}/voice/tts`)

      const response = await fetch(`${apiUrl}/voice/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          text: text,
          voice: "nova"
        })
      })

      log("TTS", `Response status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        log("TTS", `Error response: ${errorText}`)
        throw new Error(`TTS failed: ${response.status}`)
      }

      // Create audio from response
      const audioBlob = await response.blob()
      log("TTS", `Received audio blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`)
      
      const audioUrl = URL.createObjectURL(audioBlob)
      
      // Create and play audio
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      
      log("TTS", "Starting audio playback...")
      
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          log("TTS", "Audio playback ended")
          URL.revokeObjectURL(audioUrl)
          setIsSpeaking(false)
          resolve()
        }
        audio.onerror = (e) => {
          log("TTS", "Audio playback error:", e)
          URL.revokeObjectURL(audioUrl)
          setIsSpeaking(false)
          reject(new Error("Audio playback failed"))
        }
        audio.onplay = () => {
          log("TTS", "Audio playback started")
        }
        audio.play().catch((err) => {
          log("TTS", `Audio play() failed: ${err.message}`)
          reject(err)
        })
      })

    } catch (err: any) {
      log("TTS", `TTS error: ${err.message}`, err)
      setError(`Speech failed: ${err.message}`)
      setIsSpeaking(false)
    }
  }, [])

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    log("TTS", "stopSpeaking called")
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    setIsSpeaking(false)
  }, [])

  // Start voice conversation mode
  const startVoiceMode = useCallback(() => {
    log("MODE", "Starting voice mode")
    setIsVoiceModeActive(true)
    setError(null)
    setTranscript("")
    startRecording()
  }, [startRecording])

  // Stop voice conversation mode
  const stopVoiceMode = useCallback(() => {
    log("MODE", "Stopping voice mode")
    setIsVoiceModeActive(false)
    isRecordingRef.current = false
    
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      log("MODE", "Stopping active media recorder")
      mediaRecorderRef.current.stop()
    }

    if (streamRef.current) {
      log("MODE", "Stopping media stream")
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    if (audioContextRef.current) {
      log("MODE", "Closing audio context")
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    stopSpeaking()
    setIsRecording(false)
    setIsTranscribing(false)
    setTranscript("")
  }, [stopSpeaking])

  // Set callback for when transcript is ready
  const setOnTranscriptReady = useCallback((callback: ((transcript: string) => void) | null) => {
    log("CALLBACK", `setOnTranscriptReady called, callback is ${callback ? 'set' : 'null'}`)
    onTranscriptReadyRef.current = callback
  }, [])

  return {
    // Voice conversation mode
    isVoiceModeActive,
    startVoiceMode,
    stopVoiceMode,
    
    // Recording
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    
    // TTS
    isSpeaking,
    speak,
    stopSpeaking,
    
    // State
    error,
    transcript,
    
    // Callback
    onTranscriptReady: onTranscriptReadyRef.current,
    setOnTranscriptReady,
  }
}
