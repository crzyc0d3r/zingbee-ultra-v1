"use client"

import { forwardRef, useEffect, useRef, useImperativeHandle } from "react"

interface AutoGrowTextareaProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Min visible lines before any growth. Default 1. */
  minRows?: number
  /** Max visible lines before scrolling kicks in. Default 6. */
  maxRows?: number
  autoFocus?: boolean
}

export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  function AutoGrowTextarea(
    {
      value,
      onChange,
      onSubmit,
      placeholder,
      disabled,
      className = "",
      minRows = 1,
      maxRows = 6,
      autoFocus,
    },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null)
    useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement)

    useEffect(() => {
      const el = innerRef.current
      if (!el) return
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "20")
      const padding =
        parseFloat(getComputedStyle(el).paddingTop || "0") +
        parseFloat(getComputedStyle(el).paddingBottom || "0")
      const minH = lineHeight * minRows + padding
      const maxH = lineHeight * maxRows + padding
      el.style.height = "auto"
      const next = Math.min(Math.max(el.scrollHeight, minH), maxH)
      el.style.height = `${next}px`
      el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden"
    }, [value, minRows, maxRows])

    return (
      <textarea
        ref={innerRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && onSubmit) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={minRows}
        className={`w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-base leading-6 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      />
    )
  },
)
