export function MathIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-12 h-12"
    >
      {/* Hexagon */}
      <path
        d="M24 2L42 13V35L24 46L6 35V13L24 2Z"
        fill="currentColor"
        fillOpacity="0.2"
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* Pi symbol */}
      <text x="14" y="28" fontFamily="serif" fontSize="18" fontWeight="bold" fill="currentColor">
        π
      </text>
      {/* Compass/Divider tool */}
      <g transform="translate(28, 16)">
        <line x1="0" y1="0" x2="-3" y2="10" stroke="currentColor" strokeWidth="1.5" />
        <line x1="0" y1="0" x2="3" y2="10" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="0" cy="0" r="1.5" fill="currentColor" />
        <circle cx="-3" cy="10" r="1" fill="currentColor" />
        <circle cx="3" cy="10" r="1" fill="currentColor" />
      </g>
    </svg>
  )
}
