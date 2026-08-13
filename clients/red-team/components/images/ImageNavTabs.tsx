"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/images/generate", label: "Generate" },
  { href: "/images/evaluation", label: "Evaluation" },
  { href: "/images/hitl", label: "Human Review" },
  { href: "/distillations/review", label: "Distillations" },
] as const;

export function ImageNavTabs() {
  const pathname = usePathname();
  return (
    <nav className="images-nav">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`images-nav-tab${pathname === tab.href ? " active" : ""}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
