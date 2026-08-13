"use client";

interface ScoreBarProps {
  value: number | null | undefined;
}

function scoreColor(v: number): string {
  return v >= 0.8 ? "#2dd4bf" : v >= 0.6 ? "#fbbf24" : "#f472b6";
}

export function ScoreBar({ value }: ScoreBarProps) {
  if (value == null) {
    return <td style={{ color: "#475569" }}>-</td>;
  }
  const pct = Math.round(value * 100);
  const color = scoreColor(value);
  return (
    <td>
      <div className="score-bar-wrap">
        <div className="score-bar">
          <div
            className="score-bar-fill"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <span className="score-val" style={{ color }}>
          {pct}%
        </span>
      </div>
    </td>
  );
}

// Standalone version not wrapped in <td>
export function ScoreBarInline({ value }: ScoreBarProps) {
  if (value == null) {
    return <span style={{ color: "#475569" }}>-</span>;
  }
  const pct = Math.round(value * 100);
  const color = scoreColor(value);
  return (
    <div className="score-bar-wrap">
      <div className="score-bar">
        <div
          className="score-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="score-val" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

export { scoreColor };
