"use client";

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}

export function SuggestionChips({ suggestions, onSelect, disabled = false }: SuggestionChipsProps) {
  if (!suggestions.length) return null;

  return (
    <div id="suggestions" className="suggestions">
      {suggestions.map((text, i) => (
        <button
          key={i}
          className="suggestion-btn"
          onClick={() => onSelect(text)}
          disabled={disabled}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
