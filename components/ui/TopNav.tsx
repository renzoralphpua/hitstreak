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
    <header className="flex h-16 items-center gap-9 border-b border-hairline px-6 md:px-10">
      <Link href="/portfolios" className="font-display text-2xl text-ink">Hitstreak</Link>
      <nav className="hidden gap-5 text-[15px] md:flex" aria-label="Primary">
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
        {search && <div className="hidden w-72 md:block">{search}</div>}
        {right}
      </div>
    </header>
  );
}
