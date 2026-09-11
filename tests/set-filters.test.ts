// Grouping and filtering for /sets. Pure functions on purpose — the interesting behaviour is which
// era a set lands in and in what order, and none of that needs a database or React to check.
import { describe, it, expect } from "vitest";
import type { SetCompletion } from "@/lib/catalog";
import {
  groupByEra, matchesFilter, parseCollapsed, parseSetFilter, toggleCollapsed, UNGROUPED,
} from "@/lib/set-filters";

const set = (over: Partial<SetCompletion>): SetCompletion => ({
  id: 1, slug: "prismatic-evolutions", name: "Prismatic Evolutions", code: "PRE", releaseDate: "2025-01-17",
  totalCards: 100, ownedCards: 40, series: "Scarlet & Violet", seriesRank: 15,
  logoUrl: null, symbolUrl: null, ...over,
});

describe("parseSetFilter", () => {
  it("accepts only the known filters", () => {
    expect(parseSetFilter(undefined)).toBe("all");
    expect(parseSetFilter("started")).toBe("started");
    expect(parseSetFilter("nonsense")).toBe("all");
    expect(parseSetFilter(["started", "complete"])).toBe("all"); // a repeated key is not a choice
  });
});

describe("matchesFilter", () => {
  const started = set({ ownedCards: 40 });
  const untouched = set({ ownedCards: 0 });
  const finished = set({ ownedCards: 100 });
  const sealed = set({ totalCards: 0, ownedCards: 0 });

  it("treats a sealed-only set as outside every completion filter", () => {
    // 0 of 0 is not "complete", and a product group is not a set you are part-way through.
    for (const f of ["started", "incomplete", "complete"] as const) {
      expect(matchesFilter(sealed, f), f).toBe(false);
    }
    expect(matchesFilter(sealed, "sealed")).toBe(true);
    expect(matchesFilter(sealed, "all")).toBe(true);
  });

  it("separates started, incomplete and complete", () => {
    expect(matchesFilter(started, "started")).toBe(true);
    expect(matchesFilter(untouched, "started")).toBe(false);
    expect(matchesFilter(started, "incomplete")).toBe(true);
    expect(matchesFilter(untouched, "incomplete")).toBe(true);   // untouched is still incomplete
    expect(matchesFilter(finished, "incomplete")).toBe(false);
    expect(matchesFilter(finished, "complete")).toBe(true);
    expect(matchesFilter(started, "complete")).toBe(false);
  });
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
