"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive } from "./nav-items";
import Icon, { type IconName } from "./Icon";
import { cn } from "./cn";

const ICONS: Record<string, IconName> = { Binder: "binder", Sets: "grid", Decks: "decks", Alerts: "bell" };

/** Phone navigation. Leaves the system status-bar area alone; safe-area padding at the bottom. */
export default function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="sticky bottom-0 z-40 grid grid-cols-4 border-t border-hairline bg-surface px-3 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden">
      {NAV_ITEMS.map((it) => {
        const active = isActive(pathname, it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex min-h-11 flex-col items-center gap-1 py-1.5 text-[11px]", active ? "font-semibold text-ink" : "text-dim")}
          >
            <Icon name={ICONS[it.label]} size="lg" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
