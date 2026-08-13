"use client";

import { Modal } from "./Modal";

interface ConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  message: string;
}

export function ConfirmModal({ open, onConfirm, onCancel, title = "Confirm", message }: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      maxWidth="400px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>Delete</button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>{message}</p>
    </Modal>
  );
}
