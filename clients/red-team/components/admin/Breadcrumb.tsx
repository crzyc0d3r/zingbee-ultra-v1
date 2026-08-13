"use client";

export interface NavEntry {
  table: string;
  filterCol: string | null;
  filterVal: string | null;
  rowLabel: string;
}

interface BreadcrumbProps {
  navStack: NavEntry[];
  tableLabel: (t: string) => string;
  onNavigate: (level: number) => void;
}

export function Breadcrumb({ navStack, tableLabel, onNavigate }: BreadcrumbProps) {
  if (navStack.length === 0) {
    return (
      <span className="bc-item current">Dashboard</span>
    );
  }

  return (
    <>
      {navStack.map((nav, i) => {
        const isLast = i === navStack.length - 1;
        return (
          <span key={`bc-${i}`} style={{ display: "contents" }}>
            {i > 0 && <span className="bc-sep">&#9656;</span>}
            {/* For drilled-down levels, show the parent row label first */}
            {i > 0 && (
              <>
                <span
                  className="bc-item"
                  data-level={i - 1}
                  onClick={() => onNavigate(i - 1)}
                >
                  {nav.rowLabel}
                </span>
                <span className="bc-sep">&#9656;</span>
              </>
            )}
            <span
              className={`bc-item${isLast ? " current" : ""}`}
              data-level={isLast ? undefined : i}
              onClick={isLast ? undefined : () => onNavigate(i)}
            >
              {tableLabel(nav.table)}
            </span>
          </span>
        );
      })}
    </>
  );
}
