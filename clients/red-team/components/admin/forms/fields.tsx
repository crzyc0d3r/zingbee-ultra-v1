"use client";

import { Icon } from "@/components/ui/Icon";
import type { FkOption } from "@/lib/types";

// -- Field Group wrapper --
interface FieldGroupProps {
  label: string;
  hint?: string;
  full?: boolean;
  className?: string;
  children: React.ReactNode;
  expandable?: boolean;
  onExpand?: () => void;
  charCount?: number;
  jsonError?: string;
  note?: string;
}

export function FieldGroup({ label, hint, full, className, children, expandable, onExpand, charCount, jsonError, note }: FieldGroupProps) {
  return (
    <div className={`fg ${full ? "full" : "compact"}${className ? ` ${className}` : ""}`}>
      <label>
        {label}
        {hint && <span className="hint">{hint}</span>}
        {expandable && (
          <button className="expand-btn" type="button" title="Expand editor" onClick={onExpand}>
            <Icon name="expand" size={12} />
          </button>
        )}
      </label>
      {children}
      {note && <div className="note">{note}</div>}
      {(jsonError || charCount !== undefined) && (
        <div className="field-info">
          {jsonError && <span className="json-err-msg">{jsonError}</span>}
          {charCount !== undefined && <span>{charCount} chars</span>}
        </div>
      )}
    </div>
  );
}

// -- FK select dropdown --
interface FkSelectProps {
  value: string;
  options: FkOption[];
  nullable?: boolean;
  onChange: (val: string) => void;
  disabled?: boolean;
}

export function FkSelect({ value, options, nullable, onChange, disabled }: FkSelectProps) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {nullable && <option value="">(null)</option>}
      {!nullable && !value && <option value="">-- select --</option>}
      {options.map((opt) => (
        <option key={String(opt.value)} value={String(opt.value)}>
          {opt.label} ({String(opt.value).substring(0, 8)})
        </option>
      ))}
    </select>
  );
}

// -- Bool select --
interface BoolSelectProps {
  value: string;
  nullable?: boolean;
  onChange: (val: string) => void;
  disabled?: boolean;
}

export function BoolSelect({ value, nullable, onChange, disabled }: BoolSelectProps) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {nullable && <option value="">(null)</option>}
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  );
}

// -- Number input --
interface NumberInputProps {
  value: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
}

export function NumberInput({ value, onChange, readOnly }: NumberInputProps) {
  return <input type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} />;
}

// -- Timestamp input --
interface TimestampInputProps {
  value: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
}

export function TimestampInput({ value, onChange, readOnly }: TimestampInputProps) {
  return <input type="text" placeholder="YYYY-MM-DD HH:MM:SS" value={value} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} />;
}

// -- Text input --
interface TextInputProps {
  value: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

export function TextInput({ value, onChange, readOnly, placeholder }: TextInputProps) {
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} placeholder={placeholder} />;
}

// -- JSON textarea --
interface JsonTextareaProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  readOnly?: boolean;
  hasError?: boolean;
  minHeight?: number;
}

export function JsonTextarea({ value, onChange, onBlur, readOnly, hasError, minHeight }: JsonTextareaProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      style={{ minHeight: minHeight || 180, fontFamily: "'SF Mono',Consolas,monospace" }}
      spellCheck={false}
      readOnly={readOnly}
      className={hasError ? "json-invalid" : undefined}
    />
  );
}

// -- Long textarea --
interface LongTextareaProps {
  value: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
  minHeight?: number;
}

export function LongTextarea({ value, onChange, readOnly, minHeight }: LongTextareaProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ minHeight: minHeight || 140 }}
      readOnly={readOnly}
    />
  );
}

// -- Read-only display field --
interface ReadOnlyFieldProps {
  value: string;
}

export function ReadOnlyField({ value }: ReadOnlyFieldProps) {
  return <input type="text" value={value} readOnly />;
}
