import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("history");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createPortfolio, addItem, deletePortfolio, getCardHolders } from "@/lib/portfolios";
import { RANGES, RANGE_CAPTION, parseRange, rangeStart, chartFrom, withLivePoint, getPrintingHistory, getPortfolioHistory, seriesStats, HISTORY_EPOCH } from "@/lib/history";

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
beforeAll(async () => { seed = await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("ranges", () => {
  it("parses known ranges and falls back to 30d", () => {
    for (const r of RANGES) expect(parseRange(r)).toBe(r);
    expect(parseRange("1w")).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
    expect(parseRange(["7d"])).toBe("30d");
  });
  it("computes the inclusive start date in UTC", () => {
    expect(rangeStart("7d", "2026-09-07")).toBe("2026-08-31");
    expect(rangeStart("30d", "2026-09-07")).toBe("2026-08-08");
    expect(rangeStart("90d", "2026-09-07")).toBe("2026-06-09");
    expect(rangeStart("1y", "2026-09-07")).toBe("2025-09-07");
    expect(rangeStart("all", "2026-09-07")).toBe(HISTORY_EPOCH);
    expect(rangeStart("7d", "2026-03-03")).toBe("2026-02-24"); // crosses a month boundary
  });
  it("anchors the All chart to the first point and has prose captions", () => {
    const pts = [{ date: "2026-08-17", value: 1 }, { date: "2026-09-07", value: 2 }];
    expect(chartFrom("all", HISTORY_EPOCH, pts, "2026-09-07")).toBe("2026-08-17");
    expect(chartFrom("all", HISTORY_EPOCH, [], "2026-09-07")).toBe("2026-09-07");
    expect(chartFrom("30d", "2026-08-08", pts, "2026-09-07")).toBe("2026-08-08");
    expect(RANGE_CAPTION.all).toBe("all time");
    expect(RANGE_CAPTION["30d"]).toBe("past 30 days");
  });
});

describe("withLivePoint", () => {
  it("appends today's value to an empty or stale series, never duplicates today's row", () => {
    expect(withLivePoint([], "2026-09-07", 42)).toEqual([{ date: "2026-09-07", value: 42 }]);
    expect(withLivePoint([{ date: "2026-09-06", value: 40 }], "2026-09-07", 42)).toEqual([
      { date: "2026-09-06", value: 40 }, { date: "2026-09-07", value: 42 },
    ]);
    const done = [{ date: "2026-09-07", value: 40 }];
    expect(withLivePoint(done, "2026-09-07", 42)).toEqual(done);
  });
});

describe("getPrintingHistory", () => {
  it("starts with the carried-in value at `from`, then every change inside the window", async () => {
    // seed: umbreon 2026-07-01 → 1100, 2026-09-01 → 1465
    expect(await getPrintingHistory(seed.printings.umbreonHolo, "2026-08-08", "2026-09-07")).toEqual([
      { date: "2026-08-08", value: 1100 },
      { date: "2026-09-01", value: 1465 },
    ]);
  });
  it("has no carry-in when the window starts before the first snapshot", async () => {
    expect(await getPrintingHistory(seed.printings.umbreonHolo, "2026-06-01", "2026-09-07")).toEqual([
      { date: "2026-07-01", value: 1100 },
      { date: "2026-09-01", value: 1465 },
    ]);
  });
  it("does not duplicate a snapshot that falls exactly on `from`", async () => {
    expect(await getPrintingHistory(seed.printings.umbreonHolo, "2026-07-01", "2026-08-01")).toEqual([{ date: "2026-07-01", value: 1100 }]);
  });
  it("keeps null markets as gaps and returns [] for an unknown printing", async () => {
    const c = await db();
    await c.execute("INSERT INTO price_snapshots (printing_id, date, market) VALUES (2, '2026-08-01', 0.2), (2, '2026-08-15', NULL), (2, '2026-09-01', 0.25)");
    expect(await getPrintingHistory(seed.printings.pikachuNormal, "2026-07-01", "2026-09-07")).toEqual([
      { date: "2026-08-01", value: 0.2 }, { date: "2026-08-15", value: null }, { date: "2026-09-01", value: 0.25 },
    ]);
    expect(await getPrintingHistory(99999, "2026-01-01", "2026-09-07")).toEqual([]);
  });
});

describe("getPortfolioHistory", () => {
  it("returns the owner's rows in the window and nothing for another user", async () => {
    const p = await createPortfolio("u1", "Main");
    const c = await db();
    await c.execute({ sql: "INSERT INTO portfolio_history (portfolio_id, date, total_value) VALUES (?, '2026-09-05', 100), (?, '2026-09-06', 120), (?, '2026-09-07', 110)", args: [p.id, p.id, p.id] });
    expect(await getPortfolioHistory("u1", p.id, "2026-09-06", "2026-09-07")).toEqual([
      { date: "2026-09-06", value: 120 }, { date: "2026-09-07", value: 110 },
    ]);
    expect(await getPortfolioHistory("u2", p.id, "2026-09-01", "2026-09-07")).toEqual([]);
  });
  it("deleting the binder removes its history and share link", async () => {
    const p = await createPortfolio("u1", "Temp");
    const c = await db();
    await c.execute({ sql: "INSERT INTO portfolio_history (portfolio_id, date, total_value) VALUES (?, '2026-09-07', 5)", args: [p.id] });
    await c.execute({ sql: "INSERT INTO share_links (portfolio_id, token) VALUES (?, 'tok')", args: [p.id] });
    expect(await deletePortfolio("u1", p.id)).toBe(true);
    expect((await c.execute({ sql: "SELECT COUNT(*) AS n FROM portfolio_history WHERE portfolio_id = ?", args: [p.id] })).rows[0].n).toBe(0);
    expect((await c.execute({ sql: "SELECT COUNT(*) AS n FROM share_links WHERE portfolio_id = ?", args: [p.id] })).rows[0].n).toBe(0);
  });
});

describe("seriesStats", () => {
  it("ignores nulls and reports low/high/first/last/change", () => {
    expect(seriesStats([{ date: "a", value: 10 }, { date: "b", value: null }, { date: "c", value: 15 }])).toEqual({
      low: 10, high: 15, first: 10, last: 15, change: { amount: 5, ratio: 0.5 },
    });
    expect(seriesStats([{ date: "a", value: 7 }])).toEqual({ low: 7, high: 7, first: 7, last: 7, change: null });
    expect(seriesStats([])).toBeNull();
    expect(seriesStats([{ date: "a", value: 0 }, { date: "b", value: 3 }])?.change).toEqual({ amount: 3, ratio: null });
  });
});

describe("getCardHolders", () => {
  it("lists the user's binders holding any printing of the card, most copies first", async () => {
    const a = await createPortfolio("u3", "A"), b = await createPortfolio("u3", "B");
    await addItem("u3", a.id, { printingId: seed.printings.pikachuNormal, quantity: 1, condition: "NM" });
    await addItem("u3", b.id, { printingId: seed.printings.pikachuNormal, quantity: 2, condition: "NM" });
    await addItem("u3", b.id, { printingId: seed.printings.pikachuReverse, quantity: 1, condition: "LP" });
    expect(await getCardHolders("u3", seed.cards.pikachu)).toEqual([
      { portfolioId: b.id, name: "B", quantity: 3 }, { portfolioId: a.id, name: "A", quantity: 1 },
    ]);
    expect(await getCardHolders("someone-else", seed.cards.pikachu)).toEqual([]);
  });
});
