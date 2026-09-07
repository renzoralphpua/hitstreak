import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("catalog-read");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createPortfolio, addItem } from "@/lib/portfolios";
import { searchCards, listGames, listSetsWithCompletion, getSetDetail, getCardDetail, thirtyDayChange } from "@/lib/catalog";

const U = "user_1";
let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
beforeAll(async () => {
  seed = await seedMiniCatalog();
  const p = await createPortfolio(U, "Main");
  await addItem(U, p.id, { printingId: seed.printings.umbreonHolo, quantity: 1, condition: "NM" });
  await addItem(U, p.id, { printingId: seed.printings.pikachuNormal, quantity: 2, condition: "NM" });
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("searchCards", () => {
  it("matches name prefix/substring case-insensitively, returns printings with prices, optional game filter", async () => {
    const r = await searchCards("pika");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cardId: seed.cards.pikachu, name: "Pikachu", setName: "Prismatic Evolutions", gameSlug: "pokemon" });
    expect(r[0].printings.map((p) => [p.subtype, p.market])).toEqual([["Normal", 0.25], ["Reverse Holofoil", 1.1]]);
    expect(await searchCards("SHANKS", { gameSlug: "pokemon" })).toHaveLength(0);
    expect(await searchCards("shanks", { gameSlug: "one-piece" })).toHaveLength(1);
    expect(await searchCards("161/131")).toHaveLength(1); // number match
    expect(await searchCards("a")).toHaveLength(0);        // too short → no results
  });
});

describe("sets", () => {
  it("lists games and sets with completion for the user", async () => {
    expect((await listGames()).map((g) => g.slug)).toEqual(["pokemon", "one-piece"]);
    const sets = await listSetsWithCompletion(U, "pokemon");
    expect(sets).toHaveLength(1);
    // cards with a number count toward completion (sealed products don't): Umbreon + Pikachu = 2 total, both owned
    expect(sets[0]).toMatchObject({ id: seed.sets.prismatic, name: "Prismatic Evolutions", totalCards: 2, ownedCards: 2 });
  });
  it("set detail lists numbered cards with owned quantity and cheapest printing price", async () => {
    const d = await getSetDetail(U, seed.sets.prismatic);
    if (!d) throw new Error("expected set detail");
    expect(d.set.name).toBe("Prismatic Evolutions");
    expect(d.cards.map((c) => [c.name, c.ownedQuantity, c.lowestMarket])).toEqual([
      ["Pikachu", 2, 0.25], ["Umbreon ex", 1, 1465],
    ]); // sorted by number: 025 before 161
    expect(d.stats.totalCards).toBe(2);
    expect(d.stats.ownedCards).toBe(2);
    expect(d.stats.setValue).toBeCloseTo(1465.25);
    expect(d.stats.missingCost).toBe(0);
  });
});

describe("card detail", () => {
  it("returns printings with price, 30-day change, and the user's copies", async () => {
    const d = await getCardDetail(U, seed.cards.umbreon, "2026-09-07");
    expect(d?.card).toMatchObject({ name: "Umbreon ex", number: "161/131", rarity: "Special Illustration Rare", setName: "Prismatic Evolutions" });
    expect(d?.printings[0]).toMatchObject({ subtype: "Holofoil", market: 1465, owned: 1 });
    expect(d?.printings[0].change30d).toMatchObject({ amount: 365, ratio: 365 / 1100 });
    expect(await getCardDetail(U, 99999)).toBeNull();
  });
  it("thirtyDayChange carries forward the last snapshot before the cutoff", async () => {
    expect(await thirtyDayChange(seed.printings.shanksNormal, "2026-09-07")).toMatchObject({ amount: 204.3 - 210, ratio: (204.3 - 210) / 210 });
    expect(await thirtyDayChange(seed.printings.pikachuNormal, "2026-09-07")).toBeNull(); // no history
  });
});
