"use client";
import { useMemo, useCallback } from "react";
import type { SetCompletion } from "@/lib/catalog";
import { VIEW_MODES, type ViewMode } from "@/lib/view-mode";
import { groupByEra, matchesFilter, SET_FILTERS, UNGROUPED, type SetFilter } from "@/lib/set-filters";
import { EmptyState, Icon, Pill, SearchField, SectionHeading } from "@/components/ui";
import { usePersisted } from "@/components/ui/usePersisted";
import SetPanel from "./SetPanel";

const FILTER_LABEL: Record<SetFilter, string> = {
  all: "All",
  started: "Started",
  incomplete: "Incomplete",
  complete: "Complete",
  sealed: "Sealed only",
};

const asView = (raw: unknown): ViewMode | null =>
  typeof raw === "string" && (VIEW_MODES as readonly string[]).includes(raw) ? (raw as ViewMode) : null;
const asFilter = (raw: unknown): SetFilter | null =>
  typeof raw === "string" && (SET_FILTERS as readonly string[]).includes(raw) ? (raw as SetFilter) : null;
const asClosed = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.every((x) => typeof x === "string") ? (raw as string[]) : null;

/**
 * How you look at the sets list: view, filter, search and which eras are folded.
 *
 * All four are local preferences held in localStorage, not query parameters — a filter should not be
 * a navigation, and a link you copy should not carry your habits. `?game=` stays in the URL because
 * the server fetches by it.
 *
 * Search filters in place rather than navigating, which is why it is here and not the palette: this
 * is "narrow what I am looking at", not "take me somewhere".
 */
export default function SetBrowser({
  sets, gameName, gameSlug, games,
}: {
  sets: SetCompletion[];
  gameName: string;
  gameSlug: string;
  games: { slug: string; name: string }[];
}) {
  const [view, setView] = usePersisted<ViewMode>("sets.view", "grid", asView);
  const [filter, setFilter] = usePersisted<SetFilter>("sets.filter", "all", asFilter);
  // Per game: an era name from one game means nothing in another, so folds must not leak across.
  const [closed, setClosed] = usePersisted<string[]>(`sets.closed.${gameSlug}`, [], asClosed);
  const [query, setQuery] = usePersisted<string>("sets.query", "", (r) => (typeof r === "string" ? r : null));

  const collapsed = useMemo(() => new Set(closed), [closed]);
  const toggle = useCallback(
    (series: string) => setClosed(closed.includes(series) ? closed.filter((s) => s !== series) : [...closed, series]),
    [closed, setClosed]
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupByEra(
      sets.filter(
        (s) =>
          matchesFilter(s, filter) &&
          // Code as well as name: "PRE" and "SV08" are how a set is actually referred to.
          (q === "" || s.name.toLowerCase().includes(q) || (s.code ?? "").toLowerCase().includes(q))
      )
    );
  }, [sets, filter, query]);

  const shown = groups.reduce((n, g) => n + g.sets.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        as="h1"
        title="Sets"
        caption={shown === sets.length ? `${sets.length} in ${gameName}` : `${shown} of ${sets.length} in ${gameName}`}
        trailing={
          <div className="flex gap-1.5">
            <Pill selected={view === "grid"} onClick={() => setView("grid")}>Grid</Pill>
            <Pill selected={view === "list"} onClick={() => setView("list")}>List</Pill>
          </div>
        }
      />

      <SearchField value={query} onChange={setQuery} placeholder="Filter sets by name or code…" />

      <div className="flex flex-wrap gap-1.5">
        {games.map((g) => (
          // Game IS a navigation — the server fetches by it — so it stays a link.
          <Pill key={g.slug} href={`/sets/${g.slug}`} selected={g.slug === gameSlug}>
            {g.name}
          </Pill>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SET_FILTERS.map((f) => (
          <Pill key={f} selected={f === filter} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]}
          </Pill>
        ))}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body={
            query.trim() !== ""
              ? `No set in ${gameName} matches “${query.trim()}”.`
              : filter === "all"
                ? "The nightly ingest fills this in."
                : "No set in this game matches that filter."
          }
        />
      ) : (
        groups.map((g) => {
          const isClosed = collapsed.has(g.series);
          return (
            <div key={g.series} className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => toggle(g.series)}
                aria-expanded={!isClosed}
                className="flex items-center gap-2 border-b border-hairline pb-1.5 text-left text-ink hover:text-accent"
              >
                <Icon name={isClosed ? "chevron-right" : "chevron-down"} size="md" />
                <span className="font-display text-title">{g.series}</span>
                <span className="num text-caption text-dim">
                  {g.sets.length} set{g.sets.length === 1 ? "" : "s"}
                  {g.totalCards > 0 && ` · ${g.ownedCards} / ${g.totalCards}`}
                </span>
              </button>
              {!isClosed &&
                (view === "grid" ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {g.sets.map((s) => <SetPanel key={s.id} set={s} view={view} gameSlug={gameSlug} />)}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {g.sets.map((s) => <SetPanel key={s.id} set={s} view={view} gameSlug={gameSlug} />)}
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
