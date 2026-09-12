// Grouping for /sets, kept out of the page so it is testable without a database and without
// React. Nothing here touches lib/db.
import type { SetCompletion } from "@/lib/catalog";

/** Sets with no `series` are TCGplayer product groups rather than sets in the game's own sense. */
export const UNGROUPED = "Promos & products";

// There is deliberately NO completion filter here. /sets is a CATALOG — sets are how a game groups
// its cards — and filtering a catalog by "started / incomplete / complete" answers a question nobody
// asked while browsing it. "Sealed only" was worse: it classified a SET by something every set
// contains, because sealed products live inside their set (cards.number IS NULL), not beside it.
// Completion still SHOWS on each tile. It is information, not a way to slice the list.

/**
 * True when grouping has nothing to say: every set landed in the single ungrouped bucket.
 *
 * That is the shape for a game we have no era data for at all — One Piece and Riftbound, where no
 * source publishes one. A lone foldable "Promos & products" heading over the whole catalog is a
 * label that distinguishes nothing and a fold whose only move is to hide everything, so the caller
 * should render the sets flat instead.
 */
export const isUngroupedOnly = (groups: SetGroup[]): boolean =>
  groups.length === 1 && groups[0].series === UNGROUPED;

export interface SetGroup {
  /** The era's name, or `UNGROUPED`. */
  series: string;
  /** Higher is newer; null for the ungrouped bucket, which always sorts last. */
  rank: number | null;
  sets: SetCompletion[];
  ownedCards: number;
  totalCards: number;
}

/**
 * Groups sets by era, newest era first, with the ungrouped bucket last however many it holds.
 *
 * Ordering comes from `seriesRank`, not from release dates: 19 Pokémon sets carry the ingest date
 * rather than a real release, which would otherwise sort Base Set above Mega Evolution. Within an
 * era the input order is preserved — the query already sorts by release date.
 */
export function groupByEra(sets: SetCompletion[]): SetGroup[] {
  const groups = new Map<string, SetGroup>();
  for (const s of sets) {
    const series = s.series ?? UNGROUPED;
    let g = groups.get(series);
    if (!g) {
      g = { series, rank: s.series == null ? null : s.seriesRank, sets: [], ownedCards: 0, totalCards: 0 };
      groups.set(series, g);
    }
    g.sets.push(s);
    g.ownedCards += s.ownedCards;
    g.totalCards += s.totalCards;
  }
  return [...groups.values()].sort((a, b) => {
    if (a.rank == null) return 1;
    if (b.rank == null) return -1;
    return b.rank - a.rank;
  });
}

/**
 * Which eras are folded shut, read from the URL as a comma-separated list.
 *
 * Collapsed rather than expanded state is stored because the useful default is "everything open",
 * and an empty parameter should mean exactly that rather than "everything shut".
 */
export function parseCollapsed(raw: string | string[] | undefined): Set<string> {
  if (typeof raw !== "string" || raw.trim() === "") return new Set();
  return new Set(raw.split(",").map((s) => decodeURIComponent(s.trim())).filter(Boolean));
}

export function toggleCollapsed(collapsed: Set<string>, series: string): string {
  const next = new Set(collapsed);
  if (!next.delete(series)) next.add(series);
  return [...next].map(encodeURIComponent).join(",");
}
