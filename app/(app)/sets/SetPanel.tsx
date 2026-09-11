import Link from "next/link";
import type { SetCompletion } from "@/lib/catalog";
import type { ViewMode } from "@/lib/view-mode";
import { Panel, ProgressBar } from "@/components/ui";

/** One set: art where we have it, name, completion counts and the bar. Sealed-only sets (no
 *  numbered cards) say so instead of showing a 0 / 0 bar. */
export default function SetPanel({ set, view }: { set: SetCompletion; view: ViewMode }) {
  const sealedOnly = set.totalCards === 0;
  // Ingested release dates are full ISO timestamps; the day is all this caption wants.
  const caption = [set.code, set.releaseDate?.slice(0, 10)].filter(Boolean).join(" · ");
  const bar = !sealedOnly && (
    <ProgressBar
      value={set.ownedCards / set.totalCards}
      label={`${set.name} completion`}
      tone={set.ownedCards === set.totalCards ? "gain" : set.ownedCards > 0 ? "accent" : "muted"}
    />
  );
  const count = sealedOnly ? (
    <span className="text-caption text-dim">No singles</span>
  ) : (
    <span className="num text-caption text-muted">
      {set.ownedCards} / {set.totalCards}
    </span>
  );
  // The logo is decoration on a link that already carries the set's name, so it stays out of the
  // accessibility tree rather than repeating that name to a screen reader.
  const logo = (cls: string) =>
    set.logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- upstream host until R2 is configured
      <img src={set.logoUrl} alt="" aria-hidden className={cls} />
    ) : null;

  if (view === "list") {
    return (
      <Link href={`/sets/${set.id}`} className="block">
        <Panel className="flex items-center gap-4 transition-colors hover:border-ink">
          {logo("h-9 w-24 shrink-0 object-contain") ?? <span className="h-9 w-24 shrink-0" />}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={sealedOnly ? "truncate text-muted" : "truncate font-semibold text-ink"}>{set.name}</span>
            {caption && <span className="text-caption text-dim">{caption}</span>}
          </span>
          <span className="ml-auto flex w-44 shrink-0 flex-col items-end gap-1.5">
            {count}
            {bar}
          </span>
        </Panel>
      </Link>
    );
  }

  // Square, logo-forward. A set is recognised by its logo long before its name is read, so the art
  // gets the whole upper half and the name sits under it — the reverse of the list, where a dense
  // scan of names is the point.
  return (
    <Link href={`/sets/${set.id}`} className="block h-full">
      <Panel className="flex aspect-square h-full flex-col gap-2 transition-colors hover:border-ink">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {logo("max-h-full w-full object-contain") ?? (
            <span className="font-display text-title text-dim">{set.code ?? "—"}</span>
          )}
        </div>
        <span className={sealedOnly ? "line-clamp-2 text-caption text-muted" : "line-clamp-2 font-semibold text-ink"}>
          {set.name}
        </span>
        <div className="flex items-baseline justify-between gap-2">
          {caption ? <span className="truncate text-caption text-dim">{caption}</span> : <span />}
          {count}
        </div>
        {bar}
      </Panel>
    </Link>
  );
}
