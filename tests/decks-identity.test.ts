import { describe, it, expect } from "vitest";
import { baseName, splitList, identityKey } from "@/lib/decks/identity";

describe("baseName", () => {
  it("strips printing suffixes and parentheticals", () => {
    expect(baseName("Rare Candy - 191/198")).toBe("Rare Candy");
    expect(baseName("Reversal Energy - 266/182")).toBe("Reversal Energy");
    expect(baseName("Double Turbo Energy - 151/172 (Cosmos Holo)")).toBe("Double Turbo Energy");
    expect(baseName("Double Turbo Energy (Secret)")).toBe("Double Turbo Energy");
    expect(baseName("Loki (OP17-119) (Alternate Art)")).toBe("Loki");
    expect(baseName("Akali, Deadly Weapon (Alternate Art)")).toBe("Akali, Deadly Weapon");
    expect(baseName("Charizard ex")).toBe("Charizard ex");
    expect(baseName("Monkey.D.Luffy")).toBe("Monkey.D.Luffy");
  });
});
describe("splitList", () => {
  it("splits ;-joined attrs", () => {
    expect(splitList("Green;Purple")).toEqual(["Green", "Purple"]);
    expect(splitList(" Fury ; Body ")).toEqual(["Fury", "Body"]);
    expect(splitList(undefined)).toEqual([]);
  });
});
describe("identityKey", () => {
  it("is by base name for Pokémon and Riftbound, by number for One Piece", () => {
    expect(identityKey("pokemon", { name: "Rare Candy - 191/198", attrs: {} })).toBe("name:rare candy");
    expect(identityKey("pokemon", { name: "Rare Candy", attrs: { Number: "191/198" } })).toBe("name:rare candy");
    expect(identityKey("riftbound", { name: "Akali, Deadly Weapon (Alternate Art)", attrs: {} })).toBe("name:akali, deadly weapon");
    expect(identityKey("one-piece", { name: "Loki (OP17-119) (Alternate Art)", attrs: { Number: "OP17-119" } })).toBe("num:OP17-119");
    expect(identityKey("one-piece", { name: "Nami", attrs: {} })).toBe("name:nami"); // no number → name fallback
  });
});
