"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { ThumbsUp, ThumbsDown, Lightbulb, HelpCircle, Camera, Paperclip, X, Loader2 } from "lucide-react"
import html2canvas from "html2canvas-pro"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/shared/ui/dialog"
import { Button } from "@/components/shared/ui/button"
import { Textarea } from "@/components/shared/ui/textarea"

type Sentiment = "positive" | "negative" | "idea" | "question"

const SENTIMENTS: Array<{
  key: Sentiment
  label: string
  icon: typeof ThumbsUp
  triggerHover: string
  active: string
}> = [
  {
    key: "positive",
    label: "Good response",
    icon: ThumbsUp,
    triggerHover: "hover:text-emerald-500 hover:bg-emerald-50",
    active: "bg-emerald-100 text-emerald-700 border-emerald-400",
  },
  {
    key: "negative",
    label: "Needs work",
    icon: ThumbsDown,
    triggerHover: "hover:text-red-500 hover:bg-red-50",
    active: "bg-red-100 text-red-700 border-red-400",
  },
  {
    key: "idea",
    label: "Share an idea",
    icon: Lightbulb,
    triggerHover: "hover:text-amber-500 hover:bg-amber-50",
    active: "bg-amber-100 text-amber-700 border-amber-400",
  },
  {
    key: "question",
    label: "Ask a question",
    icon: HelpCircle,
    triggerHover: "hover:text-blue-500 hover:bg-blue-50",
    active: "bg-blue-100 text-blue-700 border-blue-400",
  },
]

interface MessageFeedbackProps {
  /** Index of this assistant message among all assistant messages */
  messageIndex: number
  /** Assistant message content, shown as a preview in the modal */
  messageContent?: string
  /** Disable all buttons (e.g., while LLM is thinking) */
  disabled?: boolean
  /** Unused; kept for backwards-compatibility */
  compact?: boolean
}

export function MessageFeedback({
  messageIndex,
  messageContent = "",
  disabled = false,
}: MessageFeedbackProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [initialSentiment, setInitialSentiment] = useState<Sentiment>("positive")
  const [submitted, setSubmitted] = useState(false)

  const openWith = (s: Sentiment) => {
    if (submitted || disabled) return
    setInitialSentiment(s)
    setModalOpen(true)
  }

  if (submitted) {
    return (
      <div className="flex items-center gap-1 mt-1">
        <span className="text-xs text-slate-400">Thanks for the feedback!</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-0.5">
        {SENTIMENTS.map(({ key, label, icon: Icon, triggerHover }) => (
          <button
            key={key}
            onClick={() => openWith(key)}
            disabled={disabled}
            title={disabled ? "Wait for the tutor to finish" : label}
            aria-label={label}
            className={`p-1 rounded-md text-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-300 ${triggerHover}`}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>

      <FeedbackDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        initialSentiment={initialSentiment}
        messageIndex={messageIndex}
        messagePreview={messageContent}
        onSubmitted={() => {
          setSubmitted(true)
          setModalOpen(false)
        }}
      />
    </>
  )
}

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSentiment: Sentiment
  messageIndex: number
  messagePreview: string
  onSubmitted: () => void
}

function FeedbackDialog({
  open,
  onOpenChange,
  initialSentiment,
  messageIndex,
  messagePreview,
  onSubmitted,
}: FeedbackDialogProps) {
  const [sentiment, setSentiment] = useState<Sentiment>(initialSentiment)
  const [comment, setComment] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setSentiment(initialSentiment)
      setComment("")
      setImages([])
      setError("")
      setSubmitting(false)
    }
  }, [open, initialSentiment])

  const addImage = useCallback((blob: Blob) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setImages((prev) => [...prev, ev.target!.result as string])
      }
    }
    reader.readAsDataURL(blob)
  }, [])

  const removeImage = (idx: number) =>
    setImages((prev) => prev.filter((_, i) => i !== idx))

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (blob) addImage(blob)
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      for (const file of Array.from(e.target.files)) {
        if (file.type.startsWith("image/")) addImage(file)
      }
      e.target.value = ""
    }
  }

  const captureScreenshot = async () => {
    // Hide our own dialog (and any other open dialog) for the duration of the
    // capture so the screenshot shows the page underneath, not the modal.
    const overlayEls = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [role="alertdialog"], [data-radix-portal], [data-slot^="dialog-"], .fb-modal-overlay'
      )
    )
    const prevVisibility = overlayEls.map((el) => el.style.visibility)
    overlayEls.forEach((el) => { el.style.visibility = "hidden" })

    // Reroute cross-origin <img> srcs through our same-origin /api/image-proxy
    // so html2canvas can draw them into the canvas. Without this they render
    // blank because the GCS bucket has no CORS headers.
    const sameOrigin = window.location.origin
    const imgEls = Array.from(document.querySelectorAll<HTMLImageElement>("img"))
    const swapped: { el: HTMLImageElement; src: string }[] = []
    await Promise.all(
      imgEls.map(async (img) => {
        const src = img.src
        if (!src || src.startsWith("data:") || src.startsWith(sameOrigin)) return
        try {
          swapped.push({ el: img, src })
          img.src = `/api/image-proxy?url=${encodeURIComponent(src)}`
          await new Promise<void>((r) => {
            if (img.complete) r()
            else { img.onload = () => r(); img.onerror = () => r() }
          })
        } catch {}
      })
    )

    try {
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        scale: 0.5,
        backgroundColor: "#ffffff",
      })
      setImages((prev) => [...prev, canvas.toDataURL("image/jpeg", 0.7)])
    } catch (err) {
      setError(
        `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      // Restore original srcs and modal visibility regardless of success/error
      for (const { el, src } of swapped) {
        el.src = src
      }
      overlayEls.forEach((el, i) => { el.style.visibility = prevVisibility[i] })
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError("")
    let fullComment = comment
    if (images.length) {
      fullComment += "\n\n[ATTACHMENTS]\n" + images.join("\n")
    }
    try {
      const resp = await fetch("/api/feedback", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentiment,
          comment: fullComment,
          message_index: messageIndex,
          message_text: messagePreview,
        }),
      })
      if (resp.ok) {
        onSubmitted()
        return
      }
      const body = await resp.json().catch(() => ({}))
      setError(body?.error || `Failed to submit (HTTP ${resp.status})`)
    } catch {
      setError("Network error — please try again")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share Feedback</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {messagePreview && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">
                Message being reviewed
              </div>
              <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
                {messagePreview.substring(0, 500)}
                {messagePreview.length > 500 ? "..." : ""}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {SENTIMENTS.map(({ key, label, icon: Icon, active }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSentiment(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  sentiment === key
                    ? active
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onPaste={handlePaste}
            placeholder="Add your feedback, observations, or paste screenshots here..."
            rows={8}
            className="min-h-[200px] text-sm"
            autoFocus
          />

          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((src, i) => (
                <div key={i} className="relative">
                  <img
                    src={src}
                    alt="attachment"
                    className="w-24 h-24 object-cover rounded-md border border-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center hover:bg-slate-700"
                    aria-label="Remove attachment"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={captureScreenshot}
            >
              <Camera className="w-4 h-4" /> Screenshot
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="w-4 h-4" /> Attach
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Sending...
              </>
            ) : (
              "Submit Feedback"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
