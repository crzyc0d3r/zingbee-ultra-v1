"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"

interface CopyButtonProps {
  text: string
  className?: string
  disabled?: boolean
}

function stripMarkdown(md: string): string {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .trim()
}

export function CopyButton({ text, className, disabled }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(stripMarkdown(text))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may be blocked; silently fail
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`p-1 rounded-md transition-colors ${
        copied
          ? "text-emerald-500 bg-emerald-50"
          : "text-slate-300 hover:text-blue-500 hover:bg-blue-50"
      } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-300 ${className || ""}`}
      title={disabled ? "Wait for the tutor to finish" : copied ? "Copied!" : "Copy"}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}
