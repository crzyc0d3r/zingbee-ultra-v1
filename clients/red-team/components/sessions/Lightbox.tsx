"use client";

import { useEffect, useCallback } from "react";

interface LightboxProps {
  url: string | null;
  onClose: () => void;
}

export default function Lightbox({ url, onClose }: LightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (url) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [url, handleKeyDown]);

  return (
    <div
      className={`lightbox${url ? " active" : ""}`}
      id="lightbox"
      onClick={onClose}
    >
      {url && <img id="lightboxImg" src={url} alt="" />}
    </div>
  );
}
