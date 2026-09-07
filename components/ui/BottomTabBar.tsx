"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NAV_ITEMS, isActive } from "./nav-items";
import { cn } from "./cn";

const ICONS: Record<string, ReactNode> = {
  Binder: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 3 V21" />
    </svg>
  ),
  Sets: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  ),
  Decks: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="2" width="13" height="18" rx="2" transform="rotate(8 12 11)" />
      <rect x="4" y="5" width="13" height="18" rx="2" />
    </svg>
  ),
  Alerts: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8 A6 6 0 0 0 6 8 C6 15 3 17 3 17 H21 C21 17 18 15 18 8 Z" />
      <path d="M10 21 A2 2 0 0 0 14 21" />
    </svg>
  ),
};

/** Phone navigation. Leaves the system status-bar area alone; safe-area padding at the bottom. */
export default function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="grid grid-cols-4 border-t border-hairline bg-surface px-3 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden">
      {NAV_ITEMS.map((it) => {
        const active = isActive(pathname, it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex min-h-11 flex-col items-center gap-1 py-1.5 text-[11px]", active ? "font-semibold text-ink" : "text-dim")}
          >
            {ICONS[it.label]}
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
