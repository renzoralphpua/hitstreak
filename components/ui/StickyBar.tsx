import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The controls for a long list, pinned under {@link TopNav}.
 *
 * `top-16` is TopNav's height — the two meet with no gap, which is what lets this one be opaque
 * without a seam. Everything pinned in the app uses that offset, so a page with a pinned sidebar and
 * a pinned toolbar lines them up for free.
 *
 * Two independent knobs, because the three places this is used want different combinations:
 *
 * - `bleed` (default) cancels `main`'s horizontal padding with negative margins. Without it, rows
 *   scroll past in the gutters beside the bar. Turn it OFF inside one column of a grid, where
 *   bleeding to the viewport edge would paint over the neighbouring column.
 * - `atTop` additionally swallows `main`'s top padding, so the bar is no taller at rest than the
 *   markup it replaced. Only correct when this is the page root's FIRST child — anywhere else the
 *   negative margin pulls the bar up over whatever precedes it.
 */
export default function StickyBar({
  children, bleed = true, atTop = false, className,
}: {
  children: ReactNode;
  bleed?: boolean;
  atTop?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-16 z-30 flex flex-col gap-3 border-b border-hairline bg-ground pb-3",
        bleed ? "-mx-6 px-6 md:-mx-10 md:px-10" : "",
        atTop ? "-mt-6 pt-6" : "pt-3",
        className
      )}
    >
      {children}
    </div>
  );
}
