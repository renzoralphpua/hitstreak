import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("alerts");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { evaluateAlert, createAlert, listAlerts, deleteAlert, getAlertCard, MAX_ALERTS_PER_USER } from "@/lib/alerts";

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
beforeAll(async () => { seed = await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("evaluateAlert", () => {
  const above = { direction: "above" as const, threshold: 100 };
  const below = { direction: "below" as const, threshold: 100 };
  it("fires an armed alert on an inclusive crossing", () => {
    expect(evaluateAlert({ ...above, armed: true }, 100)).toBe("fire");
    expect(evaluateAlert({ ...above, armed: true }, 150)).toBe("fire");
    expect(evaluateAlert({ ...above, armed: true }, 99.99)).toBe("none");
    expect(evaluateAlert({ ...below, armed: true }, 100)).toBe("fire");
    expect(evaluateAlert({ ...below, armed: true }, 60)).toBe("fire");
    expect(evaluateAlert({ ...below, armed: true }, 100.01)).toBe("none");
  });
  it("re-arms a fired alert only once the price is strictly back over the line", () => {
    expect(evaluateAlert({ ...above, armed: false }, 150)).toBe("none");
    expect(evaluateAlert({ ...above, armed: false }, 100)).toBe("none");
    expect(evaluateAlert({ ...above, armed: false }, 99)).toBe("rearm");
    expect(evaluateAlert({ ...below, armed: false }, 100)).toBe("none");
    expect(evaluateAlert({ ...below, armed: false }, 101)).toBe("rearm");
  });
  it("does nothing without a price", () => {
    expect(evaluateAlert({ ...above, armed: true }, null)).toBe("none");
    expect(evaluateAlert({ ...below, armed: false }, NaN)).toBe("none");
  });
});

describe("alerts data layer", () => {
  it("creates, lists (with card, price and 30-day change) and deletes the user's alerts", async () => {
    const id = await createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1450 });
    // asOf pinned (like tests/catalog-read.test.ts): the seed's snapshots are 2026-07-01 / 2026-09-01,
    // so a real-clock 30-day window would change the expected change30d after 2026-09-30.
    const list = await listAlerts("u1", "2026-09-07");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id, printingId: seed.printings.umbreonHolo, cardName: "Umbreon ex", setName: "Prismatic Evolutions", subtype: "Holofoil",
      direction: "above", threshold: 1450, armed: true, lastFiredAt: null, market: 1465,
    });
    expect(list[0].change30d).toEqual({ amount: 365, ratio: 365 / 1100 });
    expect(await listAlerts("u2")).toEqual([]);
    expect(await deleteAlert("u2", id)).toBe(false);
    expect(await deleteAlert("u1", id)).toBe(true);
    expect(await listAlerts("u1")).toEqual([]);
  });
  it("validates direction, threshold and printing", async () => {
    await expect(createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "sideways", threshold: 1 })).rejects.toThrow(/direction/i);
    await expect(createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 0 })).rejects.toThrow(/threshold/i);
    await expect(createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: NaN })).rejects.toThrow(/threshold/i);
    await expect(createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 2_000_000 })).rejects.toThrow(/threshold/i);
    await expect(createAlert("u1", { printingId: 99999, direction: "above", threshold: 1 })).rejects.toThrow(/printing/i);
  });
  it("caps alerts per user", async () => {
    for (let i = 0; i < MAX_ALERTS_PER_USER; i++) await createAlert("capped", { printingId: seed.printings.pikachuNormal, direction: "below", threshold: 1 + i });
    await expect(createAlert("capped", { printingId: seed.printings.pikachuNormal, direction: "below", threshold: 0.5 })).rejects.toThrow(/at most/i);
  });
  it("orders triggered alerts before watching ones", async () => {
    const a = await createAlert("u4", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1 });
    const b = await createAlert("u4", { printingId: seed.printings.shanksNormal, direction: "below", threshold: 1 });
    const { db } = await import("@/lib/db");
    await (await db()).execute({ sql: "UPDATE price_alerts SET armed = 0, last_fired_at = '2026-09-07T21:06:00Z', last_fired_price = 1465 WHERE id = ?", args: [b] });
    expect((await listAlerts("u4")).map((x) => x.id)).toEqual([b, a]);
  });
  it("getAlertCard resolves a printing to its card with all printings for the form", async () => {
    const card = await getAlertCard("u1", seed.printings.pikachuReverse);
    expect(card).toMatchObject({ printingId: seed.printings.pikachuReverse, name: "Pikachu", subtitle: "Prismatic Evolutions · 025/131" });
    expect(card!.printings.map((p) => p.subtype)).toEqual(["Normal", "Reverse Holofoil"]);
    expect(await getAlertCard("u1", 99999)).toBeNull();
  });
});
