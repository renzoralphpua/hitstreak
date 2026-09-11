// Grouping and filtering for /sets, kept out of the page so both are testable without a database
// and without React. Nothing here touches lib/db.
import type { SetCompletion } from "@/lib/catalog";

/** Sets with no `series` are TCGplayer product groups rather than sets in the game's own sense. */
export const UNGROUPED = "Promos & products";

export const SET_FILTERS = ["all", "started", "incomplete", "complete", "sealed"] as const;
export type SetFilter = (typeof SET_FILTERS)[number];

export function parseSetFilter(raw: string | string[] | undefined): SetFilter {
  return typeof raw === "string" && (SET_FILTERS as readonly string[]).includes(raw) ? (raw as SetFilter) : "all";
}

/** A set with no numbered cards is sealed-only — there is nothing to complete, so completion
 *  filters must not silently swallow it, and "complete" must not claim 0 of 0 is finished. */
const isSealedOnly = (s: SetCompletion) => s.totalCards === 0;

export function matchesFilter(s: SetCompletion, filter: SetFilter): boolean {
  switch (filter) {
    case "started":
      return !isSealedOnly(s) && s.ownedCards > 0;
    case "incomplete":
      return !isSealedOnly(s) && s.ownedCards < s.totalCards;
    case "complete":
      return !isSealedOnly(s) && s.ownedCards === s.totalCards;
    case "sealed":
      return isSealedOnly(s);
    default:
      return true;
  }
}

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
