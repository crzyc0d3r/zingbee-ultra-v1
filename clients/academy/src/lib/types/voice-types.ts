/**
 * TypeScript type definitions for XAI Realtime Voice API
 */

// Base message type
export interface BaseMessage {
  type: string
  [key: string]: unknown
}

// Client to Server messages
export interface AudioAppendMessage extends BaseMessage {
  type: "input_audio_buffer.append"
  audio: string // base64 PCM16 24kHz
}

export interface AudioCommitMessage extends BaseMessage {
  type: "input_audio_buffer.commit"
}

export interface ResponseCreateMessage extends BaseMessage {
  type: "response.create"
}

// Server to Client messages
export interface ConversationCreatedMessage extends BaseMessage {
  type: "conversation.created"
  conversation?: {
    id: string
  }
}

export interface SessionCreatedMessage extends BaseMessage {
  type: "session.created"
  session?: unknown
}

export interface SessionUpdatedMessage extends BaseMessage {
  type: "session.updated"
  session?: unknown
}

export interface SpeechStartedMessage extends BaseMessage {
  type: "input_audio_buffer.speech_started"
  audio_start_ms?: number
}

export interface SpeechStoppedMessage extends BaseMessage {
  type: "input_audio_buffer.speech_stopped"
  audio_end_ms?: number
}

export interface ResponseOutputAudioDeltaMessage extends BaseMessage {
  type: "response.output_audio.delta"
  delta: string // base64 PCM16 24kHz
}

export interface ResponseOutputAudioTranscriptDeltaMessage extends BaseMessage {
  type: "response.output_audio_transcript.delta"
  delta: string
}

export interface ResponseCreatedMessage extends BaseMessage {
  type: "response.created"
}

export interface ResponseDoneMessage extends BaseMessage {
  type: "response.done"
}

export interface ErrorMessage extends BaseMessage {
  type: "error"
  error?: {
    type?: string
    code?: string
    message?: string
  }
}

export interface InputAudioBufferCommittedMessage extends BaseMessage {
  type: "input_audio_buffer.committed"
  item_id?: string
}

export interface ConversationItemAddedMessage extends BaseMessage {
  type: "conversation.item.added"
  item?: {
    role: "user" | "assistant"
    content?: Array<{
      type: string
      text?: string
      transcript?: string
    }>
  }
}

// Union type for all messages
export type XAIMessage =
  | AudioAppendMessage
  | AudioCommitMessage
  | ResponseCreateMessage
  | ConversationCreatedMessage
  | SessionCreatedMessage
  | SessionUpdatedMessage
  | SpeechStartedMessage
  | SpeechStoppedMessage
  | ResponseOutputAudioDeltaMessage
  | ResponseOutputAudioTranscriptDeltaMessage
  | ResponseCreatedMessage
  | ResponseDoneMessage
  | ErrorMessage
  | InputAudioBufferCommittedMessage
  | ConversationItemAddedMessage
  | BaseMessage

// Connection state type
export type ConnectionQuality = "excellent" | "good" | "fair" | "poor" | "unknown"

// Transcript entry
export interface TranscriptEntry {
  timestamp: string
  role: "user" | "assistant"
  content: string
}
