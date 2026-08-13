"use client"

import { Volume2, VolumeX } from "lucide-react"

interface TtsButtonProps {
  /** Whether auto-read mode is currently on */
  enabled: boolean
  /** Toggle auto-read mode */
  onToggle: () => void
  /** Optional CSS class */
  className?: string
  /** Disable the button (e.g., while LLM is thinking) */
  disabled?: boolean
}

export function TtsButton({ enabled, onToggle, className, disabled }: TtsButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`p-1 rounded-md transition-colors ${
        enabled
          ? "text-blue-500 bg-blue-50"
          : "text-slate-300 hover:text-blue-500 hover:bg-blue-50"
      } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-300 ${className || ""}`}
      title={disabled ? "Wait for the tutor to finish" : enabled ? "Auto read-aloud ON — click to turn off" : "Auto read-aloud OFF — click to turn on"}
    >
      {enabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
    </button>
  )
}
