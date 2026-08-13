"use client";

import { useState, useRef, useEffect } from "react";
import { VoiceButton, SendButton } from "./VoiceButton";
import type { UseXAIVoiceReturn } from "@/hooks/use-xai-voice";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  voice?: UseXAIVoiceReturn | null;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
}

export function ChatInput({ onSend, disabled = false, voice = null, onVoiceStart, onVoiceStop }: ChatInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-focus after disabling ends
  useEffect(() => {
    if (!disabled && inputRef.current && !voice?.isVoiceModeActive) {
      inputRef.current.focus();
    }
  }, [disabled, voice?.isVoiceModeActive]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSend();
  };

  // When voice mode is active, show the voice panel instead of text input
  if (voice?.isVoiceModeActive) {
    return (
      <div className="chat-input" id="chatInput">
        <VoiceButton
          isVoiceModeActive={voice.isVoiceModeActive}
          isConnecting={voice.isConnecting}
          isConnected={voice.isConnected}
          isRecording={voice.isRecording}
          isSpeaking={voice.isSpeaking}
          isProcessing={voice.isProcessing}
          audioLevel={voice.audioLevel}
          connectionQuality={voice.connectionQuality}
          error={voice.error}
          transcript={voice.transcript}
          userTranscript={voice.userTranscript}
          onStart={onVoiceStart || (() => {})}
          onStop={onVoiceStop || (() => {})}
        />
      </div>
    );
  }

  return (
    <div className="chat-input" id="chatInput">
      <div className="input-row">
        <input
          ref={inputRef}
          type="text"
          id="userInput"
          placeholder="Type your answer or question..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <SendButton onClick={handleSend} disabled={disabled} />
      </div>
    </div>
  );
}

ChatInput.displayName = "ChatInput";
