import { describe, it, expect } from "vitest";
import { defaultZone, isSingleCardZone, SINGLE_CARD_ZONES } from "@/lib/decks/zone";

const attrs = (a: Record<string, string>) => ({ attrs: a });

describe("defaultZone", () => {
  it("puts every Pokémon card in the main deck", () => {
    expect(defaultZone("pokemon", attrs({ "Card Type": "Fire", HP: "120", Stage: "Basic" }))).toBe("main");
    expect(defaultZone("pokemon", attrs({ "Card Type": "Trainer - Item" }))).toBe("main");
    expect(defaultZone("pokemon", attrs({}))).toBe("main");
  });

  it("routes a One Piece Leader to the Leader slot and everything else to the main deck", () => {
    expect(defaultZone("one-piece", attrs({ CardType: "Leader", Color: "Red" }))).toBe("leader");
    expect(defaultZone("one-piece", attrs({ CardType: "Character", Color: "Blue" }))).toBe("main");
    expect(defaultZone("one-piece", attrs({}))).toBe("main");
  });

  it("reads the Riftbound zone off `Card Type`", () => {
    expect(defaultZone("riftbound", attrs({ "Card Type": "Legend" }))).toBe("legend");
    expect(defaultZone("riftbound", attrs({ "Card Type": "Rune" }))).toBe("rune");
    expect(defaultZone("riftbound", attrs({ "Card Type": "Battlefield" }))).toBe("battlefield");
    expect(defaultZone("riftbound", attrs({ "Card Type": "Champion Unit" }))).toBe("champion");
    expect(defaultZone("riftbound", attrs({ "Card Type": "Unit" }))).toBe("main");
    // A token still lands where its type says; the validator rejects it there.
    expect(defaultZone("riftbound", attrs({ "Card Type": "Gear;Battlefield;Token" }))).toBe("battlefield");
    expect(defaultZone("riftbound", attrs({}))).toBe("main");
  });
});

describe("isSingleCardZone", () => {
  it("is true for the one-card zones only", () => {
    expect(SINGLE_CARD_ZONES).toEqual(["leader", "legend", "champion"]);
    for (const z of ["leader", "legend", "champion"] as const) expect(isSingleCardZone(z)).toBe(true);
    for (const z of ["main", "rune", "battlefield"] as const) expect(isSingleCardZone(z)).toBe(false);
  });
});
