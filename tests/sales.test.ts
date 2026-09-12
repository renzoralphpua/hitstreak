// Selling. The design claim under test: a sale DRAWS DOWN a lot rather than deleting it, so the
// acquisition survives as history, ownership everywhere drops, and realised profit is fixed on the
// day it happened.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("sales");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import {
  createCollection, addItem, getCollectionHoldings, getCollectionSummary, getOwnedCounts, updateItem,
} from "@/lib/collections";
import { sellLot, unsell, listSales, realisedFor, realisedAsOf, realisedOf } from "@/lib/sales";

const U = "user_1", OTHER = "user_2";
let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
let collectionId: number;
let lotId: number;

beforeAll(async () => {
  seed = await seedMiniCatalog();
  collectionId = (await createCollection(U, "Table Stock")).id;
  // Four Umbreon at $1,100 each — the lot everything below sells from.
  await addItem(U, collectionId, {
    printingId: seed.printings.umbreonHolo, quantity: 4, condition: "NM", acquiredPrice: 1100, acquiredDate: "2026-08-01",
  });
  lotId = (await getCollectionHoldings(U, collectionId))[0].lots[0].itemId;
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("sellLot", () => {
  it("refuses to sell more than the lot holds", async () => {
    await expect(sellLot(U, { itemId: lotId, quantity: 5, unitPrice: 1500 })).rejects.toThrow(/only hold 4/);
  });

  it("refuses a lot that is not yours, without saying whether it exists", async () => {
    await expect(sellLot(OTHER, { itemId: lotId, quantity: 1, unitPrice: 1500 })).rejects.toThrow(/not found/);
  });

  it("rejects a nonsense quantity or price", async () => {
    await expect(sellLot(U, { itemId: lotId, quantity: 0, unitPrice: 10 })).rejects.toThrow(/whole number/);
    await expect(sellLot(U, { itemId: lotId, quantity: 1.5, unitPrice: 10 })).rejects.toThrow(/whole number/);
    await expect(sellLot(U, { itemId: lotId, quantity: 1, unitPrice: -1 })).rejects.toThrow(/zero or more/);
    await expect(sellLot(U, { itemId: lotId, quantity: 1, unitPrice: 10, soldDate: "yesterday" })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("draws the lot down instead of deleting it", async () => {
    await sellLot(U, { itemId: lotId, quantity: 1, unitPrice: 1500, soldDate: "2026-09-01", venue: "Manila Card Con" });

    const holdings = await getCollectionHoldings(U, collectionId);
    // The holding is still there, with one fewer copy — not gone, and not a hole in the record.
    expect(holdings).toHaveLength(1);
    expect(holdings[0].quantity).toBe(3);
    expect(holdings[0].lots).toHaveLength(1);
  });

  it("drops what you own everywhere, not just in the collection", async () => {
    const owned = await getOwnedCounts(U, [seed.cards.umbreon]);
    expect(owned.get(seed.cards.umbreon)).toBe(3);
    expect((await getCollectionSummary(U, collectionId)).cards).toBe(3);
  });

  it("bases cost on what the copies that LEFT cost, not the whole lot", async () => {
    const [sale] = await listSales(U, collectionId);
    expect(sale.unitCost).toBe(1100);
    expect(realisedOf(sale)).toEqual({ proceeds: 1500, cost: 1100, gain: 400 });
    expect(sale.venue).toBe("Manila Card Con");
  });

  it("takes fees off the proceeds", async () => {
    const r = realisedOf({ quantity: 2, unitPrice: 100, fees: 15, unitCost: 60 });
    expect(r).toEqual({ proceeds: 185, cost: 120, gain: 65 });
  });

  it("FREEZES the cost basis at the moment of sale", async () => {
    // Realised profit is a fact about a day that has passed. Editing what the lot cost afterwards
    // must not rewrite what you made on a sale that already happened.
    await updateItem(U, collectionId, lotId, { quantity: 3, acquiredPrice: 5, acquiredDate: "2026-08-01" });
    const [sale] = await listSales(U, collectionId);
    expect(sale.unitCost).toBe(1100);
    expect(realisedOf(sale).gain).toBe(400);
    await updateItem(U, collectionId, lotId, { quantity: 3, acquiredPrice: 1100, acquiredDate: "2026-08-01" });
  });

  it("lets the lot be sold out entirely, and keeps it visible when it is", async () => {
    await sellLot(U, { itemId: lotId, quantity: 3, unitPrice: 1600, soldDate: "2026-09-05" });
    const holdings = await getCollectionHoldings(U, collectionId);
    expect(holdings.every((h) => h.quantity === 0) || holdings.length === 0).toBe(true);
    // Nothing is owned any more...
    expect((await getOwnedCounts(U, [seed.cards.umbreon])).get(seed.cards.umbreon) ?? 0).toBe(0);
    // ...but the sales are still on the books.
    expect(await listSales(U, collectionId)).toHaveLength(2);
  });

  it("refuses to sell from a lot with nothing left", async () => {
    await expect(sellLot(U, { itemId: lotId, quantity: 1, unitPrice: 10 })).rejects.toThrow(/already sold/);
  });
});

describe("realisedFor", () => {
  it("adds up what the collection actually made", async () => {
    const r = await realisedFor(U, collectionId);
    expect(r.quantity).toBe(4);
    expect(r.proceeds).toBe(1500 + 3 * 1600);
    expect(r.cost).toBe(4 * 1100);
    expect(r.gain).toBe(r.proceeds - r.cost);
    expect(r.uncostedQuantity).toBe(0);
  });

  it("counts a sale with no cost basis apart rather than calling its profit zero", async () => {
    const free = (await createCollection(U, "Found In A Box")).id;
    await addItem(U, free, { printingId: seed.printings.pikachuNormal, quantity: 1, condition: "NM" });
    const lot = (await getCollectionHoldings(U, free))[0].lots[0].itemId;
    await sellLot(U, { itemId: lot, quantity: 1, unitPrice: 20, soldDate: "2026-09-06" });

    const r = await realisedFor(U, free);
    expect(r.proceeds).toBe(20);
    // "I made $20" and "I made $20 on something that cost an unknown amount" are different claims.
    expect(r.cost).toBe(0);
    expect(r.gain).toBe(0);
    expect(r.uncostedQuantity).toBe(1);
  });
});

describe("realisedAsOf", () => {
  it("counts only sales up to the date, so history does not see the future", async () => {
    expect((await realisedAsOf("2026-08-31")).get(collectionId) ?? 0).toBe(0);
    expect((await realisedAsOf("2026-09-01")).get(collectionId)).toBe(1500);
    expect((await realisedAsOf("2026-09-30")).get(collectionId)).toBe(1500 + 3 * 1600);
  });

  it("is what stops a sale reading as a price crash", async () => {
    // The day of the big sale, held value drops by three Umbreon — but proceeds appear the same day,
    // so a chart plotting held + realised is continuous across it.
    const before = (await realisedAsOf("2026-09-04")).get(collectionId) ?? 0;
    const after = (await realisedAsOf("2026-09-05")).get(collectionId) ?? 0;
    expect(after - before).toBe(3 * 1600);
  });
});

describe("unsell", () => {
  it("puts the copies back, because the lot never went anywhere", async () => {
    const [newest] = await listSales(U, collectionId);
    expect(await unsell(U, newest.id)).toBe(true);
    const owned = await getOwnedCounts(U, [seed.cards.umbreon]);
    expect(owned.get(seed.cards.umbreon)).toBe(newest.quantity);
  });

  it("will not undo someone else's sale", async () => {
    const [any] = await listSales(U, collectionId);
    expect(await unsell(OTHER, any.id)).toBe(false);
  });
});
