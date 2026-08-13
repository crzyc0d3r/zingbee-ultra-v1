"use client";

import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, footer, maxWidth = "960px" }: ModalProps) {
  if (!open) return null;
  return (
    <div className="overlay active">
      <div className="modal" style={{ maxWidth }}>
        <div className="modal-hd">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-bd">{children}</div>
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          width: 90%;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        .modal-hd {
          padding: 14px 20px;
          border-bottom: 1px solid #334155;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .modal-hd h3 { font-size: 14px; font-weight: 600; }
        .modal-x {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 20px;
          cursor: pointer;
          padding: 4px;
        }
        .modal-x:hover { color: #fff; }
        .modal-bd {
          padding: 16px 20px;
          overflow-y: auto;
          flex: 1;
        }
        .modal-ft {
          padding: 10px 20px;
          border-top: 1px solid #334155;
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
}
