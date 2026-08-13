type ConfirmDialogProps = {
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
  note: string;
  onNoteChange: (note: string) => void;
};

export function ConfirmDialog({ action, onConfirm, onCancel, note, onNoteChange }: ConfirmDialogProps) {
  return (
    <div
      className="images-panel"
      role="alertdialog"
      aria-label="Confirm action"
      style={{ border: "2px solid var(--color-warning, #f59e0b)", padding: 16, marginBottom: 8 }}
    >
      <p>
        <strong>Confirm {action}?</strong>{" "}
        {action === "regenerate"
          ? "This will regenerate using API credits."
          : "This will reject the variant."}
      </p>
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Optional note for reviewer..."
        rows={2}
        style={{
          width: "100%", marginTop: 8, padding: 8,
          borderRadius: 4, border: "1px solid var(--color-border, #ccc)",
        }}
      />
      <div className="images-actions" style={{ marginTop: 8 }}>
        <button
          className={action === "regenerate" ? "" : "images-btn-danger"}
          onClick={onConfirm}
        >
          Yes, {action}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
