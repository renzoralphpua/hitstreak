import Link from "next/link";
import type { ReactNode } from "react";
import type { SetCompletion } from "@/lib/catalog";
import type { ViewMode } from "@/lib/view-mode";
import { Panel, ProgressBar } from "@/components/ui";
import { cn } from "@/components/ui/cn";

/**
 * Stand-in art for a set we have no logo for.
 *
 * 169 of 320 sets have none — every One Piece and Riftbound set, and the Pokemon product groups that
 * pokemontcg.io does not carry. An empty box next to a set that HAS a logo reads as a broken image,
 * so this draws the set's code instead: the thing collectors actually use to name a set out loud.
 */
function ArtPlaceholder({ code, className }: { code: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex items-center justify-center rounded-tile border border-dashed border-hairline bg-hairline-soft",
        className
      )}
    >
      <span className="num truncate px-1.5 text-caption font-semibold tracking-label text-dim">{code ?? "—"}</span>
    </span>
  );
}

/**
 * One set: art where we have it, name, and how much of it you hold.
 *
 * Cards and sealed are reported separately — a set is not "40 of 200" when 6 of those 200 are booster
 * boxes. The bar tracks CARDS only, for the same reason.
 *
 * A set with nothing in it at all is rendered but NOT linked: a handful of TCGplayer groups carry no
 * products, and a page for one would be an empty screen with a back arrow.
 */
export default function SetPanel({ set, view, gameSlug }: { set: SetCompletion; view: ViewMode; gameSlug: string }) {
  const hasCards = set.totalCards > 0;
  const empty = set.totalCards === 0 && set.totalSealed === 0;
  // Ingested release dates are full ISO timestamps; the day is all this caption wants.
  const caption = [set.code, set.releaseDate?.slice(0, 10)].filter(Boolean).join(" · ");

  const bar = hasCards && (
    <ProgressBar
      value={set.ownedCards / set.totalCards}
      label={`${set.name} completion`}
      tone={set.ownedCards === set.totalCards ? "gain" : set.ownedCards > 0 ? "accent" : "muted"}
    />
  );

  const counts = empty ? (
    <span className="text-caption text-dim">Nothing listed</span>
  ) : (
    <span className="num text-caption text-muted">
      {hasCards && `${set.ownedCards} / ${set.totalCards}`}
      {hasCards && set.totalSealed > 0 && " · "}
      {set.totalSealed > 0 && `${set.ownedSealed} / ${set.totalSealed} sealed`}
    </span>
  );

  // The logo is decoration on a link that already carries the set's name, so it stays out of the
  // accessibility tree rather than repeating that name to a screen reader.
  const art = (cls: string, placeholderCls: string) =>
    set.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- upstream host until R2 is configured
      <img src={set.logoUrl} alt="" aria-hidden className={cls} />
    ) : (
      <ArtPlaceholder code={set.code} className={placeholderCls} />
    );

  const href = `/sets/${gameSlug}/${set.slug ?? set.id}`;
  /** An empty set stays on the page but stops being a destination. */
  const wrap = (children: ReactNode, className: string) =>
    empty ? (
      <div className={className}>{children}</div>
    ) : (
      <Link href={href} className={className}>
        {children}
      </Link>
    );

  if (view === "list") {
    return wrap(
      <Panel className={cn("flex items-center gap-4 transition-colors", !empty && "hover:border-ink")}>
        {art("h-9 w-24 shrink-0 object-contain", "h-9 w-24 shrink-0")}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className={cn("truncate", empty ? "text-muted" : "font-semibold text-ink")}>{set.name}</span>
          {caption && <span className="text-caption text-dim">{caption}</span>}
        </span>
        <span className="ml-auto flex w-44 shrink-0 flex-col items-end gap-1.5">
          {counts}
          {bar}
        </span>
      </Panel>,
      "block"
    );
  }

  // Square, logo-forward. A set is recognised by its logo long before its name is read, so the art
  // gets the whole upper half and the name sits under it — the reverse of the list, where a dense
  // scan of names is the point.
  return wrap(
    <Panel className={cn("flex aspect-square h-full flex-col gap-2 transition-colors", !empty && "hover:border-ink")}>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {art("max-h-full w-full object-contain", "size-full")}
      </div>
      <span className={cn("line-clamp-2", empty ? "text-caption text-muted" : "font-semibold text-ink")}>
        {set.name}
      </span>
      <div className="flex items-baseline justify-between gap-2">
        {caption ? <span className="truncate text-caption text-dim">{caption}</span> : <span />}
        {counts}
      </div>
      {bar}
    </Panel>,
    "block h-full"
  );
}
