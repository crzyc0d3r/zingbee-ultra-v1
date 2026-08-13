"use client";

import { Mic, Square, SendHorizontal } from "lucide-react";
import type { ConnectionQuality } from "@/lib/voice-types";

interface VoiceButtonProps {
  isVoiceModeActive: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  isProcessing?: boolean;
  audioLevel: number;
  connectionQuality: ConnectionQuality;
  error: string | null;
  transcript: string;
  userTranscript: string;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export function VoiceButton({
  isVoiceModeActive,
  isConnecting,
  isConnected,
  isRecording,
  isSpeaking,
  isProcessing = false,
  audioLevel,
  error,
  onStart,
  onStop,
  disabled = false,
}: VoiceButtonProps) {
  if (!isVoiceModeActive) {
    return (
      <button
        className="voice-toggle"
        onClick={onStart}
        disabled={disabled}
        title="Voice mode"
      >
        <Mic size={18} />
      </button>
    );
  }

  return (
    <div className="voice-panel">
      <div className="voice-panel__status">
        {isConnecting && <span className="voice-status voice-status--connecting">Connecting...</span>}
        {isConnected && isProcessing && !isSpeaking && <span className="voice-status voice-status--processing">Thinking...</span>}
        {isConnected && isRecording && !isProcessing && <span className="voice-status voice-status--recording">Listening...</span>}
        {isConnected && isSpeaking && <span className="voice-status voice-status--speaking">Speaking...</span>}
        {isConnected && !isRecording && !isSpeaking && !isProcessing && <span className="voice-status voice-status--ready">Ready</span>}
        {error && <span className="voice-status voice-status--error">{error}</span>}
      </div>

      {isConnected && (
        <div className="voice-level">
          <div className="voice-level__bar" style={{ width: `${Math.round(audioLevel * 100)}%` }} />
        </div>
      )}

    </div>
  );
}

export function SendButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} id="sendBtn" className="icon-btn" disabled={disabled} title="Send">
      <SendHorizontal size={18} />
    </button>
  );
}
