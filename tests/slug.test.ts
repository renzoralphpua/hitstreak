// Readable set URLs. The set CODE cannot do this job — 320 sets share 281 codes and "PR" alone
// covers 22 of them — so the slug comes from the name, and uniqueness is scoped to the game because
// the route is /sets/<game>/<slug>.
import { describe, it, expect } from "vitest";
import { assignSlugs, isNumericId, toSlug, type Sluggable } from "@/lib/slug";

const s = (id: number, name: string, gameSlug = "pokemon", slug?: string | null): Sluggable => ({
  id, name, gameSlug, slug,
});

describe("toSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(toSlug("Prismatic Evolutions")).toBe("prismatic-evolutions");
    expect(toSlug("POP Series 1")).toBe("pop-series-1");
  });

  it("spells an ampersand out rather than dropping it", () => {
    // "Scarlet & Violet" and "Scarlet Violet" should not collapse into the same URL.
    expect(toSlug("Scarlet & Violet")).toBe("scarlet-and-violet");
  });

  it("folds accents instead of losing the letters", () => {
    expect(toSlug("Pokémon Café")).toBe("pokemon-cafe");
  });

  it("collapses punctuation and never leaves a trailing hyphen", () => {
    expect(toSlug("EX Trainer Kit 1: Latias & Latios")).toBe("ex-trainer-kit-1-latias-and-latios");
    expect(toSlug("Heroine's Edition!!")).toBe("heroine-s-edition");
    expect(toSlug("  spaced  out  ")).toBe("spaced-out");
  });

  it("truncates without leaving the cut mid-hyphen", () => {
    const long = toSlug("a very ".repeat(30));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("assignSlugs", () => {
  it("scopes uniqueness to the game, so the same name survives in both", () => {
    // "Unleashed" is a Pokémon set AND a Riftbound one. Neither should have to apologise: the game
    // is already in the path.
    const out = assignSlugs([s(1, "Unleashed", "pokemon"), s(2, "Unleashed", "riftbound")]);
    expect(out.get(1)).toBe("unleashed");
    expect(out.get(2)).toBe("unleashed");
  });

  it("falls back to the id when one game really does repeat a name", () => {
    const out = assignSlugs([s(1, "Promos", "pokemon"), s(2, "Promos", "pokemon")]);
    expect(out.get(1)).toBe("promos");
    expect(out.get(2)).toBe("promos-2");
  });

  it("never reassigns a slug that already exists", () => {
    // A slug in the database is a URL someone may have bookmarked.
    const sets = [s(1, "Renamed Set", "pokemon", "original-slug"), s(2, "New Set", "pokemon")];
    const out = assignSlugs(sets);
    expect(out.has(1)).toBe(false);
    expect(out.get(2)).toBe("new-set");
  });

  it("yields to a name already taken by an existing slug", () => {
    const out = assignSlugs([s(1, "Something Else", "pokemon", "new-set"), s(2, "New Set", "pokemon")]);
    expect(out.get(2)).toBe("new-set-2");
  });

  it("gives a name that slugs to nothing a usable fallback", () => {
    expect(assignSlugs([s(1, "!!!", "pokemon")]).get(1)).toBe("set-1");
  });

  it("is stable: running it again assigns nothing", () => {
    const sets = [s(1, "Base Set", "pokemon"), s(2, "Jungle", "pokemon")];
    const first = assignSlugs(sets);
    const applied = sets.map((x) => ({ ...x, slug: first.get(x.id) ?? x.slug }));
    expect(assignSlugs(applied).size).toBe(0);
  });
});

describe("isNumericId", () => {
  it("tells an old /sets/117 link from a slug", () => {
    expect(isNumericId("117")).toBe(true);
    expect(isNumericId("prismatic-evolutions")).toBe(false);
    expect(isNumericId("151")).toBe(true); // a set genuinely named "151" would need its id route
    expect(isNumericId("12a")).toBe(false);
  });
});
