"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import html2canvas from "html2canvas-pro";

interface FeedbackModalProps {
  open: boolean;
  messagePreview: string;
  initialSentiment: string;
  onClose: () => void;
  onSubmit: (sentiment: string, comment: string, images: string[]) => Promise<boolean>;
}

export function FeedbackModal({
  open,
  messagePreview,
  initialSentiment,
  onClose,
  onSubmit,
}: FeedbackModalProps) {
  const [sentiment, setSentiment] = useState(initialSentiment);
  const [comment, setComment] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when modal opens or sentiment changes
  useEffect(() => {
    if (open) {
      setSentiment(initialSentiment);
      setComment("");
      setImages([]);
      setSubmitError("");
    }
  }, [open, initialSentiment]);

  const addImage = useCallback((blob: Blob) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setImages((prev) => [...prev, ev.target!.result as string]);
      }
    };
    reader.readAsDataURL(blob);
  }, []);

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) addImage(blob);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      for (const file of e.target.files) {
        if (file.type.startsWith("image/")) addImage(file);
      }
      e.target.value = "";
    }
  };

  const captureScreenshot = async () => {
    // Hide our own modal (and any other open dialog) for the duration of the
    // capture so the screenshot shows the chat page underneath, not the modal.
    const overlayEls = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.fb-modal-overlay, [role="dialog"], [role="alertdialog"], [data-radix-portal], [data-slot^="dialog-"]'
      )
    );
    const prevVisibility = overlayEls.map((el) => el.style.visibility);
    overlayEls.forEach((el) => { el.style.visibility = "hidden"; });
    const origSrcs: { el: HTMLImageElement; src: string }[] = [];
    try {
      const chatEl = document.getElementById("messages");
      if (!chatEl) return;

      // Proxy cross-origin images so html2canvas can access them
      const imgs = chatEl.querySelectorAll("img");
      await Promise.all(
        Array.from(imgs).map(async (img) => {
          const src = img.src;
          if (!src || src.startsWith("data:") || src.startsWith(window.location.origin)) return;
          try {
            origSrcs.push({ el: img, src });
            const proxied = `/api/image-proxy?url=${encodeURIComponent(src)}`;
            const res = await fetch(proxied);
            const blob = await res.blob();
            img.src = URL.createObjectURL(blob);
            await new Promise((r) => { img.onload = r; img.onerror = r; });
          } catch {}
        })
      );

      const canvas = await html2canvas(chatEl, {
        backgroundColor: "#1a1a2e",
        scale: 1,
        logging: false,
      });
      const dataUrl = canvas.toDataURL("image/png");
      setImages((prev) => [...prev, dataUrl]);
    } catch (e) {
      console.error("Screenshot failed:", e);
      setSubmitError(`Screenshot failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // Restore image srcs and modal visibility regardless of success/error
      for (const { el, src } of origSrcs) {
        URL.revokeObjectURL(el.src);
        el.src = src;
      }
      overlayEls.forEach((el, i) => { el.style.visibility = prevVisibility[i]; });
    }
  };

  const handleSubmit = async () => {
    if (!sentiment) return;
    setSubmitting(true);
    setSubmitError("");

    const success = await onSubmit(sentiment, comment, images);
    setSubmitting(false);
    if (success) {
      onClose();
    } else {
      setSubmitError("Failed to submit - Try Again");
    }
  };

  if (!open) return null;

  const sentimentBtns = [
    { key: "positive", label: "\uD83D\uDC4D Good Response", cls: "active-pos" },
    { key: "negative", label: "\uD83D\uDC4E Bad Response", cls: "active-neg" },
    { key: "idea", label: "\uD83D\uDCA1 Idea", cls: "active-idea" },
    { key: "question", label: "\u2753 Question", cls: "active-question" },
  ];

  return (
    <div
      className="fb-modal-overlay active"
      id="fbModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fb-modal-header">
          <h3>Session Feedback</h3>
          <button className="fb-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="fb-modal-body">
          <div className="fb-msg-preview-label">Message being reviewed:</div>
          <div className="fb-msg-preview" id="fbMsgPreview">
            {messagePreview.substring(0, 300)}
            {messagePreview.length > 300 ? "..." : ""}
          </div>
          <div className="fb-sentiment-row">
            {sentimentBtns.map((btn) => (
              <button
                key={btn.key}
                className={`fb-sentiment-btn${sentiment === btn.key ? ` ${btn.cls}` : ""}`}
                onClick={() => setSentiment(btn.key)}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <textarea
            className="fb-textarea"
            id="fbComment"
            placeholder="Add your feedback, observations, or paste screenshots here..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onPaste={handlePaste}
            autoFocus
          />
          <div className="fb-attachments" id="fbAttachments">
            {images.map((src, i) => (
              <div key={i} className="fb-attachment">
                <img src={src} alt="attachment" />
                <button
                  className="fb-attachment-remove"
                  onClick={() => removeImage(i)}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          <div className="fb-toolbar">
            <button
              className="fb-toolbar-btn"
              onClick={captureScreenshot}
              title="Capture screenshot of chat"
            >
              <svg className="i" viewBox="0 0 50 50">
                <path d="M5 4a1 1 0 00-1 1v8a1 1 0 102 0V6h7a1 1 0 100-2H5zm12 0a1 1 0 100 2h4a1 1 0 100-2h-4zm8 0a1 1 0 100 2h4a1 1 0 100-2h-4zm8 0a1 1 0 100 2h7v7a1 1 0 102 0V5a1 1 0 00-1-1h-8zM5 16a1 1 0 00-1 1v4a1 1 0 102 0v-4a1 1 0 00-1-1zm36 0a1 1 0 00-1 1v4a1 1 0 102 0v-4a1 1 0 00-1-1zM5 24a1 1 0 00-1 1v4a1 1 0 102 0v-4a1 1 0 00-1-1zm36 0a1 1 0 00-1 1v4a1 1 0 102 0v-4a1 1 0 00-1-1zM5 32a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 100-2H6v-7a1 1 0 00-1-1zm36 0a1 1 0 00-1 1v7h-7a1 1 0 100 2h7v7a1 1 0 102 0v-7h7a1 1 0 100-2h-7v-7a1 1 0 00-1-1zm-24 8a1 1 0 100 2h4a1 1 0 100-2h-4zm8 0a1 1 0 100 2h4a1 1 0 100-2h-4z" />
              </svg>{" "}
              Screenshot
            </button>
            <button
              className="fb-toolbar-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg className="i" viewBox="0 0 50 50">
                <path d="M39 6c-1.8 0-3.6.7-5 2L14.2 27.9c-.1.1-.1.1-.2.2v.1c-1.7 2-1.7 5 .2 6.9 1.9 1.9 5.1 1.9 7 0l15.1-15.1c.3-.3.4-.7.2-1.1-.2-.4-.5-.6-1-.6-.3 0-.5.1-.7.3l-15.1 15.1c-1.2 1.2-3.1 1.2-4.3 0-1.1-1.1-1.1-2.9 0-4.1l.1-.1.1-.1L35.5 9.5c2-2 5.1-2 7.1 0s2 5.1 0 7.1L17.9 41.1c-2.7 2.7-7.1 2.7-9.9 0-2.7-2.7-2.7-7.1 0-9.9l19.7-19.6c.3-.2.4-.7.3-1-.1-.4-.4-.7-.8-.8-.4-.1-.8 0-1 .3L6.6 29.8c-3.5 3.5-3.5 9.2 0 12.7s9.2 3.5 12.7 0l24.6-24.6c2.7-2.7 2.7-7.2 0-9.9C42.6 6.7 40.8 6 39 6z" />
              </svg>{" "}
              Attach Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />
          </div>
        </div>
        <div className="fb-modal-footer">
          <button className="fb-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="fb-submit-btn"
            id="fbSubmitBtn"
            onClick={handleSubmit}
            disabled={!sentiment || submitting}
          >
            {submitting
              ? "Sending..."
              : submitError
                ? submitError
                : "Submit Feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}
