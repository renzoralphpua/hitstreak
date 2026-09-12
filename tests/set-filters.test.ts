// Grouping for /sets. Pure functions on purpose — the interesting behaviour is which
// era a set lands in and in what order, and none of that needs a database or React to check.
import { describe, it, expect } from "vitest";
import type { SetCompletion } from "@/lib/catalog";
import {
  groupByEra, isUngroupedOnly, parseCollapsed, toggleCollapsed, UNGROUPED,
} from "@/lib/set-filters";

const set = (over: Partial<SetCompletion>): SetCompletion => ({
  id: 1, slug: "prismatic-evolutions", name: "Prismatic Evolutions", code: "PRE", releaseDate: "2025-01-17",
  totalCards: 100, ownedCards: 40, totalSealed: 6, ownedSealed: 1,
  series: "Scarlet & Violet", seriesRank: 15,
  logoUrl: null, symbolUrl: null, ...over,
});

describe("groupByEra", () => {
  it("orders eras newest first by rank, never by release date", () => {
    // Base Set's newest member carries the ingest date (2026) because 19 sets have no real release,
    // so a date-based sort would put it above Mega Evolution. Rank is what stops that.
    const groups = groupByEra([
      set({ id: 1, name: "Base Set", series: "Base", seriesRank: 0, releaseDate: "2026-09-06" }),
      set({ id: 2, name: "Pitch Black", series: "Mega Evolution", seriesRank: 16, releaseDate: "2026-07-17" }),
      set({ id: 3, name: "Prismatic Evolutions", series: "Scarlet & Violet", seriesRank: 15 }),
    ]);
    expect(groups.map((g) => g.series)).toEqual(["Mega Evolution", "Scarlet & Violet", "Base"]);
  });

  it("gathers sets with no era last, however many there are", () => {
    const groups = groupByEra([
      set({ id: 1, series: null, seriesRank: null, name: "Battle Academy" }),
      set({ id: 2, series: null, seriesRank: null, name: "Blister Exclusives" }),
      set({ id: 3, series: "Mega Evolution", seriesRank: 16 }),
    ]);
    expect(groups.map((g) => g.series)).toEqual(["Mega Evolution", UNGROUPED]);
    expect(groups[1].sets).toHaveLength(2);
  });

  it("totals completion per era so a folded section still says where you are", () => {
    const [g] = groupByEra([
      set({ id: 1, totalCards: 100, ownedCards: 40 }),
      set({ id: 2, totalCards: 50, ownedCards: 10 }),
    ]);
    expect([g.ownedCards, g.totalCards]).toEqual([50, 150]);
  });

  it("keeps the query's order within an era", () => {
    const groups = groupByEra([set({ id: 1, name: "B" }), set({ id: 2, name: "A" })]);
    expect(groups[0].sets.map((s) => s.name)).toEqual(["B", "A"]);
  });
});

describe("isUngroupedOnly", () => {
  it("is true when a game has no era data at all", () => {
    // One Piece and Riftbound: no source publishes a series, so everything lands in one bucket and
    // the heading would name nothing. /sets renders these flat, with no fold.
    const groups = groupByEra([
      set({ id: 1, name: "OP01: Romance Dawn", series: null, seriesRank: null }),
      set({ id: 2, name: "OP02: Paramount War", series: null, seriesRank: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(isUngroupedOnly(groups)).toBe(true);
  });

  it("is false as soon as ONE era exists to contrast with", () => {
    const groups = groupByEra([
      set({ id: 1, series: null, seriesRank: null }),
      set({ id: 2, series: "Mega Evolution", seriesRank: 16 }),
    ]);
    expect(isUngroupedOnly(groups)).toBe(false);
  });

  it("is false for a single REAL era — that heading still says something", () => {
    expect(isUngroupedOnly(groupByEra([set({ id: 1, series: "XY", seriesRank: 9 })]))).toBe(false);
  });

  it("is false for nothing at all, so an empty state is never mistaken for a flat list", () => {
    expect(isUngroupedOnly([])).toBe(false);
  });
});

describe("collapsed state", () => {
  it("reads an empty parameter as everything open, not everything shut", () => {
    expect(parseCollapsed(undefined).size).toBe(0);
    expect(parseCollapsed("").size).toBe(0);
    expect(parseCollapsed("   ").size).toBe(0);
  });

  it("round-trips an era name that needs encoding", () => {
    const encoded = toggleCollapsed(new Set(), "Scarlet & Violet");
    expect(parseCollapsed(encoded).has("Scarlet & Violet")).toBe(true);
  });

  it("toggles one era without disturbing the others", () => {
    const open = parseCollapsed(toggleCollapsed(new Set(["XY", "Base"]), "Base"));
    expect([...open].sort()).toEqual(["XY"]);
    const shut = parseCollapsed(toggleCollapsed(open, "Neo"));
    expect([...shut].sort()).toEqual(["Neo", "XY"]);
  });
});
