import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("portfolios");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import {
  listPortfolios, createPortfolio, renamePortfolio, deletePortfolio, getPortfolio,
  addItem, updateItem, removeItem, getPortfolioHoldings, getPortfolioSummary,
} from "@/lib/portfolios";

const U1 = "user_1", U2 = "user_2";
let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;

beforeAll(async () => { seed = await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("portfolios", () => {
  it("creates, lists (own only), renames, deletes", async () => {
    const a = await createPortfolio(U1, "Main Binder");
    await createPortfolio(U1, "OP Investments");
    await createPortfolio(U2, "Someone else");
    expect((await listPortfolios(U1)).map((p) => p.name)).toEqual(["Main Binder", "OP Investments"]);
    await renamePortfolio(U1, a.id, "Binder One");
    expect((await listPortfolios(U1))[0].name).toBe("Binder One");
    expect(await renamePortfolio(U2, a.id, "hijack")).toBe(false); // not the owner
    const b = (await listPortfolios(U1))[1];
    expect(await deletePortfolio(U1, b.id)).toBe(true);
    expect((await listPortfolios(U1)).length).toBe(1);
  });

  it("rejects blank or overlong names", async () => {
    await expect(createPortfolio(U1, "   ")).rejects.toThrow(/name/i);
    await expect(createPortfolio(U1, "x".repeat(81))).rejects.toThrow(/name/i);
  });

  it("adds items, merges same printing+condition, updates, removes", async () => {
    const [p] = await listPortfolios(U1);
    await addItem(U1, p.id, { printingId: seed.printings.umbreonHolo, quantity: 1, condition: "NM", acquiredPrice: 1100 });
    await addItem(U1, p.id, { printingId: seed.printings.pikachuNormal, quantity: 3, condition: "NM", acquiredPrice: 0.2 });
    await addItem(U1, p.id, { printingId: seed.printings.pikachuNormal, quantity: 2, condition: "NM" }); // merges → 5, keeps price
    await addItem(U1, p.id, { printingId: seed.printings.bundle, quantity: 1, condition: "NM" });       // unpriced
    const h = await getPortfolioHoldings(U1, p.id);
    expect(h.map((x) => [x.cardName, x.subtype, x.quantity])).toEqual([
      ["Umbreon ex", "Holofoil", 1], ["Pikachu", "Normal", 5], ["Booster Bundle", "Normal", 1],
    ]);
    const pika = h.find((x) => x.cardName === "Pikachu")!;
    expect(pika.acquiredPrice).toBe(0.2);
    expect(pika.market).toBe(0.25);
    expect(pika.value).toBeCloseTo(1.25);
    expect(pika.cost).toBeCloseTo(1.0);
    await updateItem(U1, pika.itemId, { quantity: 4, acquiredPrice: 0.3 });
    expect((await getPortfolioHoldings(U1, p.id)).find((x) => x.cardName === "Pikachu")!.quantity).toBe(4);
    expect(await removeItem(U2, pika.itemId)).toBe(false); // not the owner
    expect(await removeItem(U1, pika.itemId)).toBe(true);
    expect((await getPortfolioHoldings(U1, p.id)).length).toBe(2);
  });

  it("summarizes value, cost, gain, unpriced count", async () => {
    const [p] = await listPortfolios(U1);
    const s = await getPortfolioSummary(U1, p.id);
    expect(s.cards).toBe(2);           // 1 Umbreon + 1 bundle (quantities)
    expect(s.value).toBeCloseTo(1465);  // bundle has null market → excluded
    expect(s.cost).toBeCloseTo(1100);   // bundle has no acquired price
    expect(s.gain).toBeCloseTo(365);
    expect(s.unpriced).toBe(1);
  });

  it("rejects bad quantities and conditions", async () => {
    const [p] = await listPortfolios(U1);
    await expect(addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 0, condition: "NM" })).rejects.toThrow(/quantity/i);
    await expect(addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "MINTY" as never })).rejects.toThrow(/condition/i);
    await expect(addItem(U2, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "NM" })).rejects.toThrow(/portfolio/i);
  });

  it("deleting a portfolio removes its items", async () => {
    const p = await createPortfolio(U1, "Temp");
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "LP" });
    await deletePortfolio(U1, p.id);
    const c = await db();
    expect(Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM collection_items WHERE portfolio_id = ?", args: [p.id] })).rows[0].n)).toBe(0);
  });

  it("rejects adding an item for a printing that doesn't exist", async () => {
    const [p] = await listPortfolios(U1);
    const c = await db();
    const before = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM collection_items WHERE printing_id = ?", args: [999999] })).rows[0].n);
    await expect(addItem(U1, p.id, { printingId: 999999, quantity: 1, condition: "NM" })).rejects.toThrow(/printing/i);
    const after = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM collection_items WHERE printing_id = ?", args: [999999] })).rows[0].n);
    expect(after).toBe(before);
  });

  it("clamps merged quantity at 9999", async () => {
    const p = await createPortfolio(U1, "Clamp Test");
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 9998, condition: "NM" });
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 5, condition: "NM" });
    const h = await getPortfolioHoldings(U1, p.id);
    expect(h[0].quantity).toBe(9999);
  });

  it("rejects a malformed acquiredDate", async () => {
    const [p] = await listPortfolios(U1);
    await expect(
      addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "NM", acquiredDate: "09/07/2026" })
    ).rejects.toThrow(/date/i);
  });

  it("getPortfolio returns own portfolio, null for another user's", async () => {
    const [p] = await listPortfolios(U1);
    const own = await getPortfolio(U1, p.id);
    expect(own?.id).toBe(p.id);
    expect(await getPortfolio(U2, p.id)).toBeNull();
  });

  it("rejects a blank rename", async () => {
    const [p] = await listPortfolios(U1);
    await expect(renamePortfolio(U1, p.id, "   ")).rejects.toThrow(/name/i);
  });

  it("listPortfolios for an unknown user returns an empty array", async () => {
    expect(await listPortfolios("nobody")).toEqual([]);
  });

  it("getPortfolioHoldings scoped to the wrong user returns an empty array", async () => {
    const [p] = await listPortfolios(U1);
    expect(await getPortfolioHoldings(U2, p.id)).toEqual([]);
  });

  it("updateItem for an item not owned by the caller returns false", async () => {
    const [p] = await listPortfolios(U1);
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "HP" });
    const h = await getPortfolioHoldings(U1, p.id);
    const item = h.find((x) => x.condition === "HP")!;
    expect(await updateItem(U2, item.itemId, { quantity: 2 })).toBe(false);
  });
});
