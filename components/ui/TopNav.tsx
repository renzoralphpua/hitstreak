"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NAV_ITEMS, isActive } from "./nav-items";
import { cn } from "./cn";

type Props = { search?: ReactNode; right?: ReactNode };

export default function TopNav({ search, right }: Props) {
  const pathname = usePathname();
  return (
    // Sticky on every screen: the builder is the worst case (a long card list with Save and
    // draft status in the heading) but nothing is improved by the wordmark and nav scrolling away.
    <header className="sticky top-0 z-40 flex h-16 items-center gap-9 border-b border-hairline bg-ground px-6 md:px-10">
      {/* Home has no nav item by design (decision 1): the wordmark is the way to it. */}
      <Link href="/home" className="font-display text-wordmark text-ink">Hitstreak</Link>
      <nav className="hidden gap-5 text-base md:flex" aria-label="Primary">
        {NAV_ITEMS.map((it) => {
          const active = isActive(pathname, it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(active ? "border-b-2 border-ink pb-0.5 font-semibold text-ink" : "text-muted hover:text-ink")}
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        {/* No wrapper: the palette hides its own trigger below md and its overlay is fixed, so a
            `hidden` ancestor here would take the overlay with it. */}
        {search}
        {right}
      </div>
    </header>
  );
}
