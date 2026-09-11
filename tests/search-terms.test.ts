// People search the way they talk — "SIR", "alt art", "rev holo" — while the catalog stores
// "Special Illustration Rare", "Alternate Art" and "Reverse Holofoil". And the two games disagree:
// Pokémon spells rarities out, One Piece uses codes.
import { describe, it, expect } from "vitest";
import { tokenize, likeTerm, MAX_TOKENS } from "@/lib/search-terms";

const termsFor = (q: string) => tokenize(q).map((t) => t.terms);

describe("tokenize", () => {
  it("expands an abbreviation to what the catalog actually stores", () => {
    expect(termsFor("sir")[0]).toContain("Special Illustration Rare");
    expect(termsFor("ir")[0]).toContain("Illustration Rare");
    expect(termsFor("ur")[0]).toContain("Ultra Rare");
  });

  it("keeps the short code too, because One Piece really does store it", () => {
    // Pokémon has "Secret Rare"; One Piece has "SR". One query has to be able to hit either.
    expect(termsFor("sr")[0]).toEqual(expect.arrayContaining(["Secret Rare", "SR"]));
    expect(termsFor("sec")[0]).toEqual(expect.arrayContaining(["Secret Rare", "SEC"]));
  });

  it("always keeps the raw word, so a literal spelling still works", () => {
    expect(termsFor("holofoil")[0]).toContain("holofoil");
    expect(termsFor("charizard")[0]).toEqual(["charizard"]);
  });

  it("treats a known two-word phrase as one term rather than splitting it", () => {
    // Split, "art" alone would match half the catalog and "alt" would match nothing useful.
    const t = tokenize("alt art");
    expect(t).toHaveLength(1);
    expect(t[0].terms).toContain("Alternate Art");
  });

  it("keeps an unknown phrase as separate tokens, so every word has to match", () => {
    const t = tokenize("charizard sir");
    expect(t).toHaveLength(2);
    expect(t[0].terms).toEqual(["charizard"]);
    expect(t[1].terms).toContain("Special Illustration Rare");
  });

  it("caps how much work one query can ask for", () => {
    expect(tokenize("a b c d e f g h i j")).toHaveLength(MAX_TOKENS);
  });

  it("is empty for a query with nothing in it", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("    ")).toEqual([]);
  });
});

describe("likeTerm", () => {
  it("wraps for a substring match", () => {
    expect(likeTerm("zard")).toBe("%zard%");
  });

  it("escapes the LIKE wildcards so a typed % is a literal percent", () => {
    expect(likeTerm("100%")).toBe("%100\\%%");
    expect(likeTerm("a_b")).toBe("%a\\_b%");
    expect(likeTerm("back\\slash")).toBe("%back\\\\slash%");
  });
});
