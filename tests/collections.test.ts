import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("collections");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import {
  listCollections, createCollection, renameCollection, deleteCollection, getCollection,
  addItem, updateItem, removeItem, decrementHolding, removeHolding, getCollectionHoldings, getCollectionSummary,
} from "@/lib/collections";

const U1 = "user_1", U2 = "user_2";
let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;

beforeAll(async () => { seed = await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("collections", () => {
  it("creates, lists (own only), renames, deletes", async () => {
    const a = await createCollection(U1, "Main Collection");
    await createCollection(U1, "OP Investments");
    await createCollection(U2, "Someone else");
    expect((await listCollections(U1)).map((p) => p.name)).toEqual(["Main Collection", "OP Investments"]);
    await renameCollection(U1, a.id, "Collection One");
    expect((await listCollections(U1))[0].name).toBe("Collection One");
    expect(await renameCollection(U2, a.id, "hijack")).toBe(false); // not the owner
    const b = (await listCollections(U1))[1];
    expect(await deleteCollection(U1, b.id)).toBe(true);
    expect((await listCollections(U1)).length).toBe(1);
  });

  it("rejects blank or overlong names", async () => {
    await expect(createCollection(U1, "   ")).rejects.toThrow(/name/i);
    await expect(createCollection(U1, "x".repeat(81))).rejects.toThrow(/name/i);
  });

  it("keeps each acquisition as its own lot, folded into one holding for display", async () => {
    const [p] = await listCollections(U1);
    await addItem(U1, p.id, { printingId: seed.printings.umbreonHolo, quantity: 1, condition: "NM", acquiredPrice: 1100 });
    await addItem(U1, p.id, { printingId: seed.printings.pikachuNormal, quantity: 3, condition: "NM", acquiredPrice: 0.2 });
    // A second purchase of the same printing+condition at a DIFFERENT price. This used to merge
    // into the row above and keep 0.2, understating cost; it is now its own lot.
    await addItem(U1, p.id, { printingId: seed.printings.pikachuNormal, quantity: 2, condition: "NM", acquiredPrice: 0.5 });
    await addItem(U1, p.id, { printingId: seed.printings.bundle, quantity: 1, condition: "NM" });       // unpriced
    const h = await getCollectionHoldings(U1, p.id);
    expect(h.map((x) => [x.cardName, x.subtype, x.quantity])).toEqual([
      ["Umbreon ex", "Holofoil", 1], ["Pikachu", "Normal", 5], ["Booster Bundle", "Normal", 1],
    ]);
    const pika = h.find((x) => x.cardName === "Pikachu")!;
    expect(pika.lots.length).toBe(2);
    expect(pika.lots.map((l) => [l.quantity, l.acquiredPrice])).toEqual([[2, 0.5], [3, 0.2]]); // newest first
    expect(pika.market).toBe(0.25);
    expect(pika.value).toBeCloseTo(1.25);
    expect(pika.cost).toBeCloseTo(1.6);  // 3 × 0.2 + 2 × 0.5 — NOT 5 × 0.2
    expect(pika.uncostedQuantity).toBe(0);

    // updateItem and removeItem still address ONE lot by id.
    const newest = pika.lots[0].itemId;
    await updateItem(U1, newest, { quantity: 1, acquiredPrice: 0.6 });
    const afterEdit = (await getCollectionHoldings(U1, p.id)).find((x) => x.cardName === "Pikachu")!;
    expect(afterEdit.quantity).toBe(4);
    expect(afterEdit.cost).toBeCloseTo(1.2);  // 3 × 0.2 + 1 × 0.6
    expect(await removeItem(U2, newest)).toBe(false); // not the owner
    expect(await removeItem(U1, newest)).toBe(true);
    const afterRemove = (await getCollectionHoldings(U1, p.id)).find((x) => x.cardName === "Pikachu")!;
    expect(afterRemove.lots.length).toBe(1);
    expect(afterRemove.quantity).toBe(3);
  });

  it("counts copies with no recorded price instead of pricing them at zero", async () => {
    const p = await createCollection(U1, "Partly costed");
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 2, condition: "NM", acquiredPrice: 10 });
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 3, condition: "NM" }); // pulled, no price
    const [h] = await getCollectionHoldings(U1, p.id);
    expect(h.quantity).toBe(5);
    expect(h.cost).toBeCloseTo(20);       // the priced lot only, not 5 × anything
    expect(h.uncostedQuantity).toBe(3);   // so the UI can say the gain is overstated
  });

  it("decrementHolding takes a copy off the newest lot and drops the lot when it empties", async () => {
    const p = await createCollection(U1, "Stepper");
    const pr = seed.printings.shanksNormal;
    await addItem(U1, p.id, { printingId: pr, quantity: 2, condition: "NM", acquiredPrice: 10 });
    await addItem(U1, p.id, { printingId: pr, quantity: 1, condition: "NM", acquiredPrice: 40 });
    expect(await decrementHolding(U1, p.id, pr, "NM")).toBe(true);   // newest lot held 1 → gone
    expect((await getCollectionHoldings(U1, p.id))[0].lots.map((l) => [l.quantity, l.acquiredPrice])).toEqual([[2, 10]]);
    expect(await decrementHolding(U1, p.id, pr, "NM")).toBe(true);   // 2 → 1
    expect((await getCollectionHoldings(U1, p.id))[0].quantity).toBe(1);
    await expect(decrementHolding(U2, p.id, pr, "NM")).rejects.toThrow(/collection/i);
  });

  it("removeHolding deletes every lot of that printing and condition", async () => {
    const p = await createCollection(U1, "Remove all");
    const pr = seed.printings.shanksNormal;
    await addItem(U1, p.id, { printingId: pr, quantity: 2, condition: "NM", acquiredPrice: 10 });
    await addItem(U1, p.id, { printingId: pr, quantity: 1, condition: "NM", acquiredPrice: 40 });
    await addItem(U1, p.id, { printingId: pr, quantity: 1, condition: "LP", acquiredPrice: 5 });
    expect(await removeHolding(U1, p.id, pr, "NM")).toBe(true);
    expect((await getCollectionHoldings(U1, p.id)).map((x) => [x.condition, x.quantity])).toEqual([["LP", 1]]);
    expect(await removeHolding(U1, p.id, pr, "NM")).toBe(false);  // already gone
  });

  it("summarizes value, cost, gain, unpriced count", async () => {
    const [p] = await listCollections(U1);
    const s = await getCollectionSummary(U1, p.id);
    // Cards and sealed are counted apart: the bundle has no card number, and "5 cards" would have
    // claimed you own five cards when one of them is a box.
    expect(s.cards).toBe(4);           // 1 Umbreon + 3 Pikachu (quantities)
    expect(s.sealed).toBe(1);          // the bundle
    expect(s.value).toBeCloseTo(1465.75); // + 3 × 0.25 Pikachu; bundle has null market → excluded
    expect(s.cost).toBeCloseTo(1100.6); // 1100 Umbreon + 3 × 0.2 Pikachu; bundle has no price
    expect(s.gain).toBeCloseTo(365.15);
    expect(s.unpriced).toBe(1);
  });

  it("rejects bad quantities and conditions", async () => {
    const [p] = await listCollections(U1);
    await expect(addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 0, condition: "NM" })).rejects.toThrow(/quantity/i);
    await expect(addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "MINTY" as never })).rejects.toThrow(/condition/i);
    await expect(addItem(U2, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "NM" })).rejects.toThrow(/collection/i);
  });

  it("deleting a collection removes its items", async () => {
    const p = await createCollection(U1, "Temp");
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "LP" });
    await deleteCollection(U1, p.id);
    const c = await db();
    expect(Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?", args: [p.id] })).rows[0].n)).toBe(0);
  });

  it("rejects adding an item for a printing that doesn't exist", async () => {
    const [p] = await listCollections(U1);
    const c = await db();
    const before = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM collection_items WHERE printing_id = ?", args: [999999] })).rows[0].n);
    await expect(addItem(U1, p.id, { printingId: 999999, quantity: 1, condition: "NM" })).rejects.toThrow(/printing/i);
    const after = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM collection_items WHERE printing_id = ?", args: [999999] })).rows[0].n);
    expect(after).toBe(before);
  });

  it("refuses to take a holding past 9999 copies across its lots, rather than silently clamping", async () => {
    const p = await createCollection(U1, "Clamp Test");
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 9998, condition: "NM" });
    await expect(
      addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 5, condition: "NM" })
    ).rejects.toThrow(/9999/);
    // The rejected lot was never written, so the holding is untouched.
    expect((await getCollectionHoldings(U1, p.id))[0].quantity).toBe(9998);
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "NM" });
    expect((await getCollectionHoldings(U1, p.id))[0].quantity).toBe(9999);
  });

  it("rejects a malformed acquiredDate", async () => {
    const [p] = await listCollections(U1);
    await expect(
      addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "NM", acquiredDate: "09/07/2026" })
    ).rejects.toThrow(/date/i);
  });

  it("getCollection returns own collection, null for another user's", async () => {
    const [p] = await listCollections(U1);
    const own = await getCollection(U1, p.id);
    expect(own?.id).toBe(p.id);
    expect(await getCollection(U2, p.id)).toBeNull();
  });

  it("rejects a blank rename", async () => {
    const [p] = await listCollections(U1);
    await expect(renameCollection(U1, p.id, "   ")).rejects.toThrow(/name/i);
  });

  it("listCollections for an unknown user returns an empty array", async () => {
    expect(await listCollections("nobody")).toEqual([]);
  });

  it("getCollectionHoldings scoped to the wrong user returns an empty array", async () => {
    const [p] = await listCollections(U1);
    expect(await getCollectionHoldings(U2, p.id)).toEqual([]);
  });

  it("updateItem for an item not owned by the caller returns false", async () => {
    const [p] = await listCollections(U1);
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "HP" });
    const h = await getCollectionHoldings(U1, p.id);
    const item = h.find((x) => x.condition === "HP")!;
    expect(await updateItem(U2, item.lots[0].itemId, { quantity: 2 })).toBe(false);
  });
});
