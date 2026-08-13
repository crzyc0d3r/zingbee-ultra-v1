"use client";

import { useEffect } from "react";
import { Icon } from "@/components/ui/Icon";

interface FormShellProps {
  title: string;
  editingPk: string | null;
  saving?: boolean;
  onSave: () => void;
  onClose: () => void;
  children: React.ReactNode;
  /** Set true when an inner overlay (ExpandEditor) is active, to suppress Escape */
  suppressEscape?: boolean;
  /** Extra CSS class(es) for the modal container */
  modalClassName?: string;
}

export function FormShell({ title, editingPk, saving, onSave, onClose, children, suppressEscape, modalClassName }: FormShellProps) {
  useEffect(() => {
    if (suppressEscape) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, suppressEscape]);

  return (
    <div className="overlay active">
      <div className={`modal${modalClassName ? ` ${modalClassName}` : ""}`}>
        <div className="modal-hd">
          <h3>{editingPk ? "Edit" : "Create"} {title}</h3>
          <button className="modal-x" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-bd">
          <div className="form-grid">
            {children}
          </div>
        </div>
        <div className="modal-ft">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            <Icon name="save" /> {saving ? "Saving..." : editingPk ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
