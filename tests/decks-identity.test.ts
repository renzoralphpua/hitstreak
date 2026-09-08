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
  it("strips gallery / shiny-vault / promo numbers whose denominator or number carries letters", () => {
    expect(baseName("Pikachu - TG05/TG30")).toBe("Pikachu");          // Trainer Gallery
    expect(baseName("Mew - GG01/GG70")).toBe("Mew");                  // Galarian Gallery
    expect(baseName("Pikachu - SV040/SV122")).toBe("Pikachu");        // Shiny Vault
    expect(baseName("Cramorant - 226/S-P")).toBe("Cramorant");        // SWSH promo
    expect(baseName("Charizard - S1/S4 (Box Topper)")).toBe("Charizard");
    expect(baseName("Jangmo-o - 093/167")).toBe("Jangmo-o");          // hyphen inside the name itself
    expect(baseName("Great Tusk - 097/162 - 2024 (Sakuya O.)")).toBe("Great Tusk"); // World Championship reprint
    expect(baseName("Sceptile - 10/106(EX Emerald)")).toBe("Sceptile");            // no space before the parenthetical
  });
  it("strips slash-less promo numbers", () => {
    expect(baseName("Charizard ex - 054")).toBe("Charizard ex");
    expect(baseName("Meganium - 001")).toBe("Meganium");
    expect(baseName("Alakazam - 003 [Staff]")).toBe("Alakazam");
    expect(baseName("Drifloon - 005 (Cosmos Holo)")).toBe("Drifloon");
    expect(baseName("Haunter  - 027")).toBe("Haunter"); // double space before the dash, as in the catalog
  });
  it("leaves names alone when the dash is not followed by a printing number", () => {
    expect(baseName("Code Card - Scarlet & Violet Booster Box")).toBe("Code Card - Scarlet & Violet Booster Box");
    expect(baseName("Code Card - 151 Booster Pack")).toBe("Code Card - 151 Booster Pack");
    expect(baseName("Detective Pikachu Special Case File - 3 Pack Booster Blister")).toBe("Detective Pikachu Special Case File - 3 Pack Booster Blister");
  });
  it("leaves hyphens, periods, colons, and apostrophes inside names intact", () => {
    expect(baseName("Ho-Oh ex")).toBe("Ho-Oh ex");
    expect(baseName("Mr. Mime")).toBe("Mr. Mime");
    expect(baseName("Type: Null")).toBe("Type: Null");
    expect(baseName("Lillie's Clefairy ex")).toBe("Lillie's Clefairy ex");
    expect(baseName("Porygon-Z")).toBe("Porygon-Z");
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
    expect(identityKey("pokemon", { name: "Pikachu - TG05/TG30", attrs: {} })).toBe(identityKey("pokemon", { name: "Pikachu", attrs: {} }));
    expect(identityKey("pokemon", { name: "Charizard ex - 054", attrs: {} })).toBe(identityKey("pokemon", { name: "Charizard ex", attrs: {} }));
    expect(identityKey("riftbound", { name: "Akali, Deadly Weapon (Alternate Art)", attrs: {} })).toBe("name:akali, deadly weapon");
    expect(identityKey("one-piece", { name: "Loki (OP17-119) (Alternate Art)", attrs: { Number: "OP17-119" } })).toBe("num:OP17-119");
    expect(identityKey("one-piece", { name: "Nami", attrs: {} })).toBe("name:nami"); // no number → name fallback
  });
});
