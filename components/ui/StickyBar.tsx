import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The controls for a long list, pinned under {@link TopNav}.
 *
 * `top-16` is TopNav's height — the two meet with no gap, which is what lets this one be opaque
 * without a seam. Everything pinned in the app uses that offset, so a page with a pinned sidebar
 * and a pinned toolbar lines them up for free.
 *
 * `bleed` (the default) is for a bar that owns the page's full width. The negative margins are
 * load-bearing there: `main` pads the page, so a bar confined to the content column would let rows
 * scroll past in the gutters beside it, and `-mt-6 pt-6` swallows `main`'s top padding so the bar
 * is no taller at rest than the markup it replaced. It must be the FIRST child of the page root.
 *
 * `bleed={false}` is for a bar inside one column of a grid, where bleeding to the viewport edge
 * would paint over the neighbouring column.
 */
export default function StickyBar({
  children, bleed = true, className,
}: {
  children: ReactNode;
  bleed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-16 z-30 flex flex-col gap-3 border-b border-hairline bg-ground pb-3",
        bleed ? "-mx-6 -mt-6 px-6 pt-6 md:-mx-10 md:px-10" : "pt-3",
        className
      )}
    >
      {children}
    </div>
  );
}
