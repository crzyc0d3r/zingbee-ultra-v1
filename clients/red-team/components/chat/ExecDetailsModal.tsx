"use client";

import { JsonViewer } from "@/components/audits/JsonViewer";

interface ExecDetailsModalProps {
  open: boolean;
  onClose: () => void;
  entry: {
    step: string;
    details: string;
    agent?: string;
    timestamp?: string;
  } | null;
}

export function ExecDetailsModal({ open, onClose, entry }: ExecDetailsModalProps) {
  if (!open || !entry) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  let parsed: unknown = entry.details;
  try {
    parsed = JSON.parse(entry.details);
  } catch {}

  return (
    <div className="modal-overlay active" id="execModal" onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="modalTitle">{entry.step}</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body" id="modalBody">
          <div style={{ marginBottom: "16px" }}>
            <span className="modal-badge agent">{entry.agent || "System"}</span>
            <span className="modal-badge step">{entry.step}</span>
            <span className="modal-badge time">
              {entry.timestamp || new Date().toLocaleString()}
            </span>
          </div>

          <JsonViewer data={parsed} />
        </div>
      </div>
    </div>
  );
}
