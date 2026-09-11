import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-gap");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { createCollection, addItem } from "@/lib/collections";
import { loadOwnedByKey, analyzeGap } from "@/lib/decks/gap";
import type { DeckDetail } from "@/lib/decks/data";

let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
const U = "u1";
const line = (over: Partial<DeckDetail["cards"][number]> & { cardId: number }): DeckDetail["cards"][number] => ({
  zone: "main", quantity: 1, name: "x", setName: "s", number: null, rarity: null, imageUrl: null, attrs: {}, market: null, ...over,
});
const deck = (cards: DeckDetail["cards"], gameSlug: DeckDetail["gameSlug"] = "pokemon"): DeckDetail => ({
  id: 1, gameSlug, gameName: "g", name: "d", archetype: null, tier: null, format: null, sourceNote: null, isMeta: true, isDraft: false, updatedAt: "", cardCount: 0, cards,
});

beforeAll(async () => {
  await seedMiniCatalog();
  f = await seedDeckFixtures();
  const a = await createCollection(U, "A"), b = await createCollection(U, "B");
  await addItem(U, a.id, { printingId: f.printings.rareCandySvi, quantity: 2, condition: "NM" }); // Rare Candy (SVI reprint, "Rare Candy - 191/198")
  await addItem(U, b.id, { printingId: f.printings.rareCandyObf, quantity: 1, condition: "LP" }); // Rare Candy (OBF)
  await addItem(U, a.id, { printingId: f.printings.namiAlt, quantity: 3, condition: "NM" });      // Nami alt art
  await createCollection("other", "Not mine").then((p) => addItem("other", p.id, { printingId: f.printings.charizardEx, quantity: 4, condition: "NM" })); // Charizard ex, someone else's
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("loadOwnedByKey", () => {
  it("aggregates the user's copies across all collections by identity key", async () => {
    const owned = await loadOwnedByKey(U, "pokemon");
    expect(owned.get("name:rare candy")).toBe(3);
    expect(owned.get("name:charizard ex")).toBeUndefined();
    expect((await loadOwnedByKey(U, "one-piece")).get("num:OP01-016")).toBe(3);
  });
  it("is scoped to the game: One Piece holdings do not leak into a Pokémon map", async () => {
    const owned = await loadOwnedByKey(U, "pokemon");
    expect(owned.has("num:OP01-016")).toBe(false);
    expect(owned.has("name:nami")).toBe(false);
    expect(await loadOwnedByKey("nobody", "pokemon")).toEqual(new Map());
  });
});

describe("analyzeGap", () => {
  it("allocates owned copies to lines in order and prices the missing ones from the line's market", async () => {
    const owned = await loadOwnedByKey(U, "pokemon");
    const g = analyzeGap(deck([
      line({ cardId: f.cards.charizardEx, name: "Charizard ex", quantity: 3, market: 18.9 }),
      line({ cardId: f.cards.rareCandyObf, name: "Rare Candy", quantity: 4, market: 1.6 }),
      line({ cardId: f.cards.fireEnergy, name: "Basic Fire Energy", quantity: 10, market: null }),
    ]), owned);
    expect(g.lines.map((l) => [l.owned, l.missing, l.missingCost])).toEqual([[0, 3, 56.7], [3, 1, 1.6], [0, 10, null]]);
    expect(g).toMatchObject({ total: 17, owned: 3, missing: 14, missingCost: 58.3, unpricedMissing: 10 });
  });
  it("shares one identity's copies across two lines (e.g. Riftbound champion + main copies)", async () => {
    const owned = new Map([["name:renekton, rampager", 2]]);
    const g = analyzeGap(deck([
      line({ cardId: f.cards.renektonChampion, name: "Renekton, Rampager", zone: "champion", quantity: 1, market: 12 }),
      line({ cardId: f.cards.renektonChampion, name: "Renekton, Rampager", zone: "main", quantity: 2, market: 12 }),
    ], "riftbound"), owned);
    expect(g.lines.map((l) => [l.owned, l.missing])).toEqual([[1, 0], [1, 1]]);
    expect(g.missingCost).toBe(12);
  });
  it("counts One Piece alt arts as the same card", async () => {
    const owned = await loadOwnedByKey(U, "one-piece");
    const g = analyzeGap(deck([line({ cardId: f.cards.nami, name: "Nami", quantity: 4, attrs: { Number: "OP01-016" }, market: 2.5 })], "one-piece"), owned);
    expect(g.lines[0]).toMatchObject({ owned: 3, missing: 1, missingCost: 2.5 });
  });
  it("does not mutate the owned map and reports a fully owned deck as complete", () => {
    const owned = new Map([["name:rare candy", 4]]);
    const g = analyzeGap(deck([line({ cardId: f.cards.rareCandyObf, name: "Rare Candy - 191/198", quantity: 4, market: 1.6 })]), owned);
    expect(owned.get("name:rare candy")).toBe(4);
    expect(g).toMatchObject({ total: 4, owned: 4, missing: 0, missingCost: 0, unpricedMissing: 0 });
    expect(g.lines[0]).toMatchObject({ key: "name:rare candy", missingCost: 0 });
  });
});
