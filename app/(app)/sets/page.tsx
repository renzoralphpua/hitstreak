import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames, listSetsWithCompletion, type SetCompletion } from "@/lib/catalog";
import { parseView, type ViewMode } from "@/lib/view-mode";
import {
  groupByEra, matchesFilter, parseCollapsed, parseSetFilter, toggleCollapsed,
  SET_FILTERS, UNGROUPED, type SetFilter,
} from "@/lib/set-filters";
import { SectionHeading, Panel, Pill, ProgressBar, EmptyState, Icon } from "@/components/ui";

export const metadata = { title: "Sets — Hitstreak" };
// Completion counts come from the signed-in user's collections: never prerender or cache across users.
export const dynamic = "force-dynamic";

const DEFAULT_GAME = "pokemon";

const FILTER_LABEL: Record<SetFilter, string> = {
  all: "All",
  started: "Started",
  incomplete: "Incomplete",
  complete: "Complete",
  sealed: "Sealed only",
};

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** One set: art where we have it, name, completion counts and the bar. Sealed-only sets (no
 *  numbered cards) say so instead of showing a 0 / 0 bar. */
function SetPanel({ set, view }: { set: SetCompletion; view: ViewMode }) {
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
  const logo = set.logoUrl && (
    // eslint-disable-next-line @next/next/no-img-element -- upstream host until R2 is configured
    <img src={set.logoUrl} alt="" aria-hidden className="h-9 w-auto max-w-28 shrink-0 object-contain" />
  );

  return (
    <Link href={`/sets/${set.id}`} className="block">
      <Panel className={view === "grid" ? "flex flex-col gap-2 transition-colors hover:border-ink" : "flex items-center gap-4 transition-colors hover:border-ink"}>
        {view === "grid" ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <span className={sealedOnly ? "text-muted" : "font-semibold text-ink"}>{set.name}</span>
              {logo}
            </div>
            <div className="flex items-baseline justify-between gap-3">
              {caption ? <span className="text-caption text-dim">{caption}</span> : <span />}
              {count}
            </div>
            {bar}
          </>
        ) : (
          <>
            {logo ?? <span className="h-9 w-9 shrink-0" />}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={sealedOnly ? "truncate text-muted" : "truncate font-semibold text-ink"}>{set.name}</span>
              {caption && <span className="text-caption text-dim">{caption}</span>}
            </span>
            <span className="ml-auto flex w-44 shrink-0 flex-col items-end gap-1.5">
              {count}
              {bar}
            </span>
          </>
        )}
      </Panel>
    </Link>
  );
}

export default async function SetsPage({ searchParams }: Props) {
  const { game, view: rawView, filter: rawFilter, closed: rawClosed } = await searchParams;
  const gameSlug = typeof game === "string" ? game : DEFAULT_GAME;
  const view = parseView(rawView);
  const filter = parseSetFilter(rawFilter);
  const collapsed = parseCollapsed(rawClosed);

  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id

  const games = await listGames();
  const current = games.find((g) => g.slug === gameSlug);
  if (!current) notFound();

  const all = await listSetsWithCompletion(session.user.id, gameSlug);
  const groups = groupByEra(all.filter((s) => matchesFilter(s, filter)));
  const shown = groups.reduce((n, g) => n + g.sets.length, 0);

  /** Every link keeps the other three parameters — a filter must not reset your view or your folds. */
  const href = (over: Partial<{ game: string; view: ViewMode; filter: SetFilter; closed: string }>) => {
    const q = new URLSearchParams();
    q.set("game", over.game ?? gameSlug);
    if ((over.view ?? view) === "list") q.set("view", "list");
    const f = over.filter ?? filter;
    if (f !== "all") q.set("filter", f);
    const cl = over.closed ?? [...collapsed].map(encodeURIComponent).join(",");
    if (cl) q.set("closed", cl);
    return `/sets?${q}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        as="h1"
        title="Sets"
        caption={shown === all.length ? `${all.length} in ${current.name}` : `${shown} of ${all.length} in ${current.name}`}
        trailing={
          <div className="flex gap-1.5">
            <Pill href={href({ view: "grid" })} selected={view === "grid"} scroll={false}>Grid</Pill>
            <Pill href={href({ view: "list" })} selected={view === "list"} scroll={false}>List</Pill>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {games.map((g) => (
          // Switching game drops the folds: an era name from one game means nothing in another.
          <Pill key={g.slug} href={href({ game: g.slug, closed: "" })} selected={g.slug === gameSlug}>
            {g.name}
          </Pill>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SET_FILTERS.map((f) => (
          <Pill key={f} href={href({ filter: f })} selected={f === filter} scroll={false}>
            {FILTER_LABEL[f]}
          </Pill>
        ))}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body={filter === "all" ? "The nightly ingest fills this in." : "No set in this game matches that filter."}
        />
      ) : (
        groups.map((g) => {
          const isClosed = collapsed.has(g.series);
          const completion = g.totalCards > 0 ? ` · ${g.ownedCards} / ${g.totalCards}` : "";
          return (
            <div key={g.series} className="flex flex-col gap-3">
              <Link
                href={href({ closed: toggleCollapsed(collapsed, g.series) })}
                scroll={false}
                aria-expanded={!isClosed}
                className="flex items-center gap-2 border-b border-hairline pb-1.5 text-ink hover:text-accent"
              >
                <Icon name={isClosed ? "chevron-right" : "chevron-down"} size="md" />
                <span className="font-display text-title">{g.series}</span>
                <span className="num text-caption text-dim">
                  {g.sets.length} set{g.sets.length === 1 ? "" : "s"}
                  {completion}
                </span>
              </Link>
              {!isClosed &&
                (view === "grid" ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {g.sets.map((s) => (
                      <SetPanel key={s.id} set={s} view={view} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {g.sets.map((s) => (
                      <SetPanel key={s.id} set={s} view={view} />
                    ))}
                  </div>
                ))}
            </div>
          );
        })
      )}

      {groups.some((g) => g.series === UNGROUPED) && (
        <p className="text-caption text-dim">
          &ldquo;{UNGROUPED}&rdquo; holds the TCGplayer product groups that are not sets in the game&rsquo;s own
          sense — decks, blisters, promo collections — so they have no era to sit in.
        </p>
      )}
    </div>
  );
}
