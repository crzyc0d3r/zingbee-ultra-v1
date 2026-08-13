"use client"

import { useEffect, useState } from "react"
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/shared/ui/dialog"
import { Button } from "@/components/shared/ui/button"
import { Textarea } from "@/components/shared/ui/textarea"

type Sentiment = "positive" | "negative"

interface EndSessionFeedbackDialogProps {
  open: boolean
  /** Called after feedback submits successfully. Parent should end the session here. */
  onComplete: () => void
}

export function EndSessionFeedbackDialog({
  open,
  onComplete,
}: EndSessionFeedbackDialogProps) {
  const [sentiment, setSentiment] = useState<Sentiment | null>(null)
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setSentiment(null)
      setComment("")
      setError("")
      setSubmitting(false)
    }
  }, [open])

  const submit = async () => {
    if (!sentiment) return
    setSubmitting(true)
    setError("")
    try {
      const resp = await fetch("/api/learning-session-feedback", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentiment,
          comment: comment.trim(),
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        setError(body?.error || `Failed to submit (HTTP ${resp.status})`)
        setSubmitting(false)
        return
      }
      // Let the parent end the session / navigate.
      onComplete()
    } catch {
      setError("Network error — please try again")
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>How was your session?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Before you go, tell us how this session went. Your feedback helps
            your tutor improve.
          </p>

          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setSentiment("positive")}
              aria-label="Thumbs up"
              className={`flex flex-col items-center gap-1 px-6 py-4 rounded-xl border-2 transition-colors ${
                sentiment === "positive"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-500"
              }`}
            >
              <ThumbsUp className="w-8 h-8" />
              <span className="text-sm font-medium">Good session</span>
            </button>
            <button
              type="button"
              onClick={() => setSentiment("negative")}
              aria-label="Thumbs down"
              className={`flex flex-col items-center gap-1 px-6 py-4 rounded-xl border-2 transition-colors ${
                sentiment === "negative"
                  ? "border-red-500 bg-red-50 text-red-700"
                  : "border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-500"
              }`}
            >
              <ThumbsDown className="w-8 h-8" />
              <span className="text-sm font-medium">Not great</span>
            </button>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              Share your thoughts (optional)
            </label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What went well? What could be better?"
              rows={6}
              className="min-h-[140px] text-sm"
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!sentiment || submitting}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Ending session...
              </>
            ) : (
              "Submit & End Session"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
