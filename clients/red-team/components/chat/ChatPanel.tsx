"use client";

import { useRef, useEffect } from "react";
import { ChatMessage } from "./ChatMessage";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { SuggestionChips } from "./SuggestionChips";
import type { ChatMessage as ChatMessageType } from "@/lib/types";

interface ChatPanelProps {
  messages: ChatMessageType[];
  tutorName: string;
  isThinking: boolean;
  thinkingText?: string;
  suggestions: string[];
  onSuggestionSelect: (text: string) => void;
  onFeedback: (msgIndex: number, sentiment: string) => void;
  feedbackSentMap: Record<number, boolean>;
  isLoading: boolean;
  isVoiceMode?: boolean;
}

export function ChatPanel({
  messages,
  tutorName,
  isThinking,
  thinkingText,
  suggestions,
  onSuggestionSelect,
  onFeedback,
  feedbackSentMap,
  isLoading,
  isVoiceMode = false,
}: ChatPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or thinking state changes
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isThinking, suggestions]);

  let assistantIdx = 0;

  return (
    <div
      ref={containerRef}
      className={`chat-messages${isLoading ? " loading" : ""}`}
      id="messages"
    >
      {messages.map((msg, i) => {
        const elements: React.ReactNode[] = [];

        // Image loading placeholder
        if (msg.imageLoading && !msg.imageUrl) {
          elements.push(
            <div key={`img-${i}`} className="message assistant">
              <div className="image-loading">Generating illustration...</div>
            </div>
          );
          if (!msg.content) return elements;
        }

        // If this message has an image, show it (image-only messages have empty content)
        if (msg.imageUrl) {
          elements.push(
            <div key={`img-${i}`} className="message assistant">
              <img
                src={msg.imageUrl}
                alt="Educational diagram"
                className="lesson-image"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLElement).parentElement?.remove();
                }}
              />
              {msg.imageCaption && (
                <div className="image-caption">{msg.imageCaption}</div>
              )}
            </div>
          );
          // If this is an image-only message (no content), skip the text message
          if (!msg.content) return elements;
        }

        // Track assistant message index for feedback (only for feedback-enabled messages)
        const showFeedback = msg.role === "assistant" && msg.showFeedback !== false;
        const currentAssistantIdx = showFeedback ? assistantIdx++ : -1;

        elements.push(
          <ChatMessage
            key={`msg-${i}`}
            role={msg.role}
            content={msg.content}
            tutorName={tutorName}
            showFeedback={showFeedback}
            msgIndex={currentAssistantIdx >= 0 ? currentAssistantIdx : undefined}
            latencyMs={msg.latencyMs}
            firstByteMs={msg.firstByteMs}
            textDoneMs={msg.textDoneMs}
            imageDoneMs={msg.imageDoneMs}
            onFeedback={onFeedback}
            feedbackSent={
              currentAssistantIdx >= 0
                ? feedbackSentMap[currentAssistantIdx]
                : undefined
            }
          />
        );

        return elements;
      })}

      {isThinking && <ThinkingIndicator thinkingText={thinkingText} />}

      {!isVoiceMode && (
        <SuggestionChips
          suggestions={suggestions}
          onSelect={onSuggestionSelect}
          disabled={isLoading}
        />
      )}
    </div>
  );
}
