import Link from "next/link";
import Icon from "./Icon";
import { cn } from "./cn";

export type Back = { href: string; label: string };

/**
 * The way back, as an arrow rather than a row of its own.
 *
 * A full-width "← Collections" line above a heading costs a whole row of vertical space on every
 * detail screen and says nothing the arrow does not. The LABEL survives as the accessible name —
 * the control still announces where it goes, it just stops taking a row to do it.
 *
 * Pass it to {@link SectionHeading} via `back` rather than placing it by hand: the heading is what
 * keeps the arrow on the title's baseline.
 */
export default function BackLink({ href, label, className }: Back & { className?: string }) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={`Back to ${label}`}
      className={cn(
        "-ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted",
        "transition-colors hover:bg-hairline-soft hover:text-ink",
        className
      )}
    >
      <Icon name="arrow-left" size="md" />
    </Link>
  );
}
