/**
 * TypeScript type definitions for XAI Realtime Voice API
 */

export interface BaseMessage {
  type: string
  [key: string]: unknown
}

export interface AudioAppendMessage extends BaseMessage {
  type: "input_audio_buffer.append"
  audio: string
}

export interface AudioCommitMessage extends BaseMessage {
  type: "input_audio_buffer.commit"
}

export interface ResponseCreateMessage extends BaseMessage {
  type: "response.create"
}

export interface ConversationCreatedMessage extends BaseMessage {
  type: "conversation.created"
  conversation?: { id: string }
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
  delta: string
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
  error?: { type?: string; code?: string; message?: string }
}

export interface InputAudioBufferCommittedMessage extends BaseMessage {
  type: "input_audio_buffer.committed"
  item_id?: string
}

export interface ConversationItemAddedMessage extends BaseMessage {
  type: "conversation.item.added"
  item?: {
    role: "user" | "assistant"
    content?: Array<{ type: string; text?: string; transcript?: string }>
  }
}

export interface FunctionCallArgsDoneMessage extends BaseMessage {
  type: "response.function_call_arguments.done"
  name: string
  call_id: string
  arguments: string  // JSON string
}

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
  | ResponseDoneMessage
  | ErrorMessage
  | InputAudioBufferCommittedMessage
  | ConversationItemAddedMessage
  | FunctionCallArgsDoneMessage
  | BaseMessage

export type ConnectionQuality = "excellent" | "good" | "fair" | "poor" | "unknown"
