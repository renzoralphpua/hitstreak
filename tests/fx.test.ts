// The FX feed. Rates are display-only, so the bar is "never show a converted figure at a rate we do
// not actually have" — every case here is a way a lax parser would invent one.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("fx");
import { db, closeDb } from "@/lib/db";
import { fetchRates, ingestRates } from "@/ingest/fx";

afterAll(() => { closeDb(); tmp.clean(); });
beforeAll(async () => { await db(); });

const feed = (rates: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ result: "success", time_last_update_unix: 1789171200, rates, ...over }),
  })) as unknown as typeof fetch;

describe("fetchRates", () => {
  it("keeps only the currencies the switcher offers", async () => {
    const { rates } = await fetchRates(feed({ PHP: 62.7, EUR: 0.86, ZWL: 322, XPF: 103 }));
    expect([...rates.keys()].sort()).toEqual(["EUR", "PHP"]);
  });

  it("never stores a rate for USD", async () => {
    // It is 1 by definition; a stored row could disagree with itself after a bad feed day.
    const { rates } = await fetchRates(feed({ USD: 1.02, PHP: 62.7 }));
    expect(rates.has("USD" as never)).toBe(false);
  });

  it("drops a rate that is zero, negative or not a number", async () => {
    const { rates } = await fetchRates(
      feed({ PHP: 0, EUR: -1, JPY: "153.7", GBP: null, CAD: Number.NaN, AUD: 1.5 })
    );
    // A zero would pass a truthiness check and then multiply every price to nothing.
    expect([...rates.keys()]).toEqual(["AUD"]);
  });

  it("dates the rates from the FEED's own timestamp, not ours", async () => {
    const { date } = await fetchRates(feed({ PHP: 62.7 }));
    expect(date).toBe("2026-09-12");
  });

  it("throws on a non-OK response rather than returning nothing", async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(fetchRates(bad)).rejects.toThrow(/503/);
  });

  it("throws when the feed reports its own failure with a 200", async () => {
    await expect(fetchRates(feed({ PHP: 62.7 }, { result: "error" }))).rejects.toThrow(/error/);
  });
});

describe("ingestRates", () => {
  it("writes the rates and reports what the feed did not carry", async () => {
    const r = await ingestRates(feed({ PHP: 62.7, EUR: 0.86 }));
    expect(r.written).toBe(2);
    expect(r.date).toBe("2026-09-12");
    expect(r.skipped).toContain("JPY");
    expect(r.skipped).not.toContain("PHP");

    const c = await db();
    const row = (await c.execute({ sql: "SELECT rate, date FROM fx_rates WHERE code = ?", args: ["PHP"] })).rows[0];
    expect(Number(row.rate)).toBeCloseTo(62.7);
    expect(String(row.date)).toBe("2026-09-12");
  });

  it("is idempotent — a second run updates in place rather than duplicating", async () => {
    await ingestRates(feed({ PHP: 63.9 }, { time_last_update_unix: 1789257600 }));
    const c = await db();
    const rows = (await c.execute({ sql: "SELECT rate, date FROM fx_rates WHERE code = ?", args: ["PHP"] })).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rate)).toBeCloseTo(63.9);
    expect(String(rows[0].date)).toBe("2026-09-13");
  });

  it("leaves a currency the feed dropped at its last known rate", async () => {
    // Vanishing mid-session would silently switch a reader back to dollars; a stale rate that admits
    // its date is the better failure.
    await ingestRates(feed({ PHP: 64.0 }));
    const c = await db();
    const eur = (await c.execute({ sql: "SELECT rate FROM fx_rates WHERE code = ?", args: ["EUR"] })).rows[0];
    expect(Number(eur.rate)).toBeCloseTo(0.86);
  });

  it("writes nothing at all when the feed carries nothing we offer", async () => {
    const before = (await (await db()).execute("SELECT COUNT(*) n FROM fx_rates")).rows[0].n;
    const r = await ingestRates(feed({ ZWL: 322 }));
    expect(r.written).toBe(0);
    const after = (await (await db()).execute("SELECT COUNT(*) n FROM fx_rates")).rows[0].n;
    expect(after).toBe(before);
  });
});
