import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("prices");

import { db, closeDb } from "@/lib/db";
import { ensureGame, upsertSets, upsertProducts } from "@/ingest/catalog";
import { ingestPrices, resolveGroupIndex } from "@/ingest/prices";

beforeAll(async () => {
  await ensureGame({ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" });
  await upsertSets(3, [{ groupId: 604, name: "Scarlet & Violet" }]);
  await upsertProducts(604, [{ productId: 450101, name: "Pikachu" }]);
});

afterAll(() => {
  closeDb();
  tmp.clean();
});

const P1 = { productId: 450101, subTypeName: "Holofoil", marketPrice: 2.5, lowPrice: 1.0, midPrice: 2.0, highPrice: 9.9 };

async function counts() {
  const c = await db();
  return {
    snapshots: Number((await c.execute("SELECT COUNT(*) AS n FROM price_snapshots")).rows[0].n),
    printings: Number((await c.execute("SELECT COUNT(*) AS n FROM printings")).rows[0].n),
  };
}

// printings.id for a (productId, subtype) pair — never assume autoincrement ordering.
async function printingIdFor(productId: number, subtype: string): Promise<number> {
  const c = await db();
  const row = (await c.execute({
    sql: `SELECT p.id AS id FROM printings p
          JOIN cards ca ON ca.id = p.card_id
          WHERE ca.tcgplayer_product_id = ? AND p.subtype = ?`,
    args: [productId, subtype],
  })).rows[0];
  return Number(row.id);
}

// The value a reader would carry forward for `date`: the latest snapshot at or before it.
async function carriedMarket(printingId: number, date: string): Promise<number | null> {
  const c = await db();
  const row = (await c.execute({
    sql: `SELECT market FROM price_snapshots WHERE printing_id = ? AND date <= ? ORDER BY date DESC LIMIT 1`,
    args: [printingId, date],
  })).rows[0];
  return row === undefined ? null : (row.market as number | null);
}

async function snapshotAt(printingId: number, date: string) {
  const c = await db();
  return (await c.execute({
    sql: "SELECT market FROM price_snapshots WHERE printing_id = ? AND date = ?",
    args: [printingId, date],
  })).rows[0];
}

async function latestFor(printingId: number) {
  const c = await db();
  return (await c.execute({
    sql: "SELECT date, market FROM latest_prices WHERE printing_id = ?",
    args: [printingId],
  })).rows[0];
}

// Every snapshot day for a printing, oldest first, as [date, market] pairs.
async function timeline(printingId: number): Promise<[string, number | null][]> {
  const c = await db();
  const rows = (await c.execute({
    sql: "SELECT date, market FROM price_snapshots WHERE printing_id = ? ORDER BY date",
    args: [printingId],
  })).rows;
  return rows.map((r) => [String(r.date), r.market as number | null]);
}

describe("ingestPrices (write-on-change)", () => {
  it("creates the printing and writes the first snapshot", async () => {
    const res = await ingestPrices(604, [P1], "2026-09-01");
    expect(res).toMatchObject({ written: 1, unchanged: 0, skippedNoCard: 0 });
    expect(await counts()).toEqual({ snapshots: 1, printings: 1 });
  });

  it("skips when the price is unchanged on a later day", async () => {
    const res = await ingestPrices(604, [P1], "2026-09-02");
    expect(res).toMatchObject({ written: 0, unchanged: 1 });
    expect((await counts()).snapshots).toBe(1);
    // but latest_prices moves to the new date
    const c = await db();
    expect((await c.execute("SELECT date FROM latest_prices")).rows[0].date).toBe("2026-09-02");
  });

  it("writes a snapshot when the price changes", async () => {
    const res = await ingestPrices(604, [{ ...P1, marketPrice: 3.0 }], "2026-09-03");
    expect(res).toMatchObject({ written: 1, unchanged: 0 });
    expect((await counts()).snapshots).toBe(2);
  });

  it("is idempotent for the same date (re-run upserts the same row, no dupes)", async () => {
    // Re-running D diffs against the snapshot BEFORE D (2.5), so 3.0 still counts as a write,
    // but ON CONFLICT keeps exactly one row for (printing, D). Idempotency = row count.
    const res = await ingestPrices(604, [{ ...P1, marketPrice: 3.0 }], "2026-09-03");
    expect(res).toMatchObject({ written: 1, unchanged: 0 });
    expect((await counts()).snapshots).toBe(2);
  });

  it("counts prices for unknown products as skipped", async () => {
    const res = await ingestPrices(604, [{ productId: 999999, subTypeName: "Normal", marketPrice: 1 }], "2026-09-03");
    expect(res).toMatchObject({ written: 0, skippedNoCard: 1 });
  });

  it("treats a second subtype as a distinct printing", async () => {
    await ingestPrices(604, [{ ...P1, subTypeName: "Reverse Holofoil", marketPrice: 0.5 }], "2026-09-03");
    expect((await counts()).printings).toBe(2);
  });

  it("replaying an OLDER date diffs against the snapshot before it and leaves latest untouched", async () => {
    // history so far for Holofoil: 2026-09-01 @2.5, 2026-09-03 @3.0; latest = 2026-09-03 @3.0
    const c = await db();
    const before = (await c.execute("SELECT date, market FROM latest_prices WHERE printing_id = 1")).rows[0];
    expect(before).toMatchObject({ date: "2026-09-03", market: 3.0 });

    // 2026-08-20 has no earlier snapshot -> written
    const r1 = await ingestPrices(604, [{ ...P1, marketPrice: 2.5 }], "2026-08-20");
    expect(r1).toMatchObject({ written: 1 });
    // 2026-08-25 equals the 2026-08-20 snapshot (2.5) -> unchanged, even though latest is 3.0
    const r2 = await ingestPrices(604, [{ ...P1, marketPrice: 2.5 }], "2026-08-25");
    expect(r2).toMatchObject({ written: 0, unchanged: 1 });

    const after = (await c.execute("SELECT date, market FROM latest_prices WHERE printing_id = 1")).rows[0];
    expect(after).toMatchObject({ date: "2026-09-03", market: 3.0 }); // untouched by older replays
  });

  it("a corrected re-run that matches the previous day DELETES the wrong row (no orphan snapshot)", async () => {
    const p1 = await printingIdFor(450101, "Holofoil");

    // A bad feed lands 20 on 2026-10-01.
    const bad = await ingestPrices(604, [{ ...P1, marketPrice: 20 }], "2026-10-01");
    expect(bad).toMatchObject({ written: 1 });
    expect(await snapshotAt(p1, "2026-10-01")).toMatchObject({ market: 20 });

    // The corrected feed says the price never moved: it equals the snapshot before 10-01.
    const c = await db();
    const priorRow = (await c.execute({
      sql: `SELECT market, low, mid, high FROM price_snapshots
            WHERE printing_id = ? AND date < ? ORDER BY date DESC LIMIT 1`,
      args: [p1, "2026-10-01"],
    })).rows[0];
    const priorMarket = priorRow.market as number;

    const fixed = await ingestPrices(
      604,
      [{ ...P1, marketPrice: priorMarket, lowPrice: priorRow.low as number, midPrice: priorRow.mid as number, highPrice: priorRow.high as number }],
      "2026-10-01"
    );
    expect(fixed).toMatchObject({ unchanged: 1, written: 0 });

    // The redundant row is gone and latest agrees with the most recent snapshot's tuple.
    expect(await snapshotAt(p1, "2026-10-01")).toBeUndefined();
    expect(await latestFor(p1)).toMatchObject({ date: "2026-10-01", market: priorMarket });
  });

  it("handles an all-null tuple (no listings) as a real, comparable value", async () => {
    await upsertProducts(604, [{ productId: 450102, name: "Null Card" }]);
    const noPrices = { productId: 450102, subTypeName: "Normal" };

    expect(await ingestPrices(604, [noPrices], "2026-02-01")).toMatchObject({ written: 1 });
    expect(await ingestPrices(604, [noPrices], "2026-02-02")).toMatchObject({ unchanged: 1, written: 0 });

    const p = await printingIdFor(450102, "Normal");
    expect((await latestFor(p))!.market).toBeNull();
  });

  it("a middle insert equal to its LATER neighbour is still written (history stays reconstructible)", async () => {
    await upsertProducts(604, [{ productId: 450103, name: "Middle Card" }]);
    const key = { productId: 450103, subTypeName: "Normal" };

    await ingestPrices(604, [{ ...key, marketPrice: 1 }], "2026-01-01");
    await ingestPrices(604, [{ ...key, marketPrice: 5 }], "2026-01-10");
    // 2026-01-05 equals 01-10 but differs from 01-01, so it must be written.
    expect(await ingestPrices(604, [{ ...key, marketPrice: 5 }], "2026-01-05")).toMatchObject({ written: 1 });

    const p = await printingIdFor(450103, "Normal");
    expect(await carriedMarket(p, "2026-01-01")).toBe(1);
    expect(await carriedMarket(p, "2026-01-05")).toBe(5);
    expect(await carriedMarket(p, "2026-01-10")).toBe(5);
    expect(await carriedMarket(p, "2026-01-15")).toBe(5);
  });

  it("a stale latest write is dropped by the SQL guard, not by JS bookkeeping", async () => {
    const p1 = await printingIdFor(450101, "Holofoil");

    await ingestPrices(604, [{ ...P1, marketPrice: 7 }], "2026-11-05");
    expect(await latestFor(p1)).toMatchObject({ date: "2026-11-05", market: 7 });

    // An out-of-order older day still records history but must not move latest back.
    await ingestPrices(604, [{ ...P1, marketPrice: 6 }], "2026-11-04");
    expect(await snapshotAt(p1, "2026-11-04")).toMatchObject({ market: 6 });
    expect(await latestFor(p1)).toMatchObject({ date: "2026-11-05", market: 7 });
  });

  it("distinguishes catalog drift (product in another group) from an unknown product", async () => {
    await upsertSets(3, [{ groupId: 605, name: "Other Set" }]);
    await upsertProducts(605, [{ productId: 777, name: "Elsewhere" }]);

    const res = await ingestPrices(
      604,
      [
        { productId: 777, subTypeName: "Normal", marketPrice: 1 },
        { productId: 999999, subTypeName: "Normal", marketPrice: 1 },
      ],
      "2026-05-01"
    );
    expect(res).toMatchObject({ skippedWrongGroup: 1, skippedNoCard: 1, written: 0 });
  });

  it("dedupes duplicate keys within one call (last wins)", async () => {
    await upsertProducts(604, [{ productId: 450104, name: "Dupe Card" }]);
    const res = await ingestPrices(
      604,
      [
        { productId: 450104, subTypeName: "Normal", marketPrice: 7 },
        { productId: 450104, subTypeName: "Normal", marketPrice: 8 },
      ],
      "2026-06-01"
    );
    expect(res).toMatchObject({ written: 1 });
    const p = await printingIdFor(450104, "Normal");
    expect(await snapshotAt(p, "2026-06-01")).toMatchObject({ market: 8 });
  });

  it("rejects a date that is not YYYY-MM-DD", async () => {
    await expect(ingestPrices(604, [P1], "2026-9-7")).rejects.toThrow(/YYYY-MM-DD/);
    await expect(ingestPrices(604, [P1], "2026-09-07T00:00:00Z")).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("normalizes a numeric string price instead of comparing it as a string", async () => {
    // 2026-08-22 sits between the 08-20 @2.5 snapshot and 09-01, so prev is 2.5.
    const res = await ingestPrices(
      604,
      [{ ...P1, marketPrice: "2.5" as unknown as number }],
      "2026-08-22"
    );
    expect(res).toMatchObject({ unchanged: 1, written: 0 });
  });

  it("normalizes a blank price string to null, not zero", async () => {
    await upsertProducts(604, [{ productId: 450105, name: "Blank Price" }]);
    const res = await ingestPrices(
      604,
      [{ productId: 450105, subTypeName: "Normal", marketPrice: "" as unknown as number }],
      "2026-07-01"
    );
    expect(res).toMatchObject({ written: 1, unchanged: 0 });

    const p = await printingIdFor(450105, "Normal");
    const c = await db();
    const row = (await c.execute({
      sql: "SELECT market FROM latest_prices WHERE printing_id = ?",
      args: [p],
    })).rows[0];
    expect(row.market).toBeNull();
  });

  it("mutates a hoisted GroupIndex when it creates printings", async () => {
    const idx = await resolveGroupIndex(604);
    expect(idx.printingId.has("450101|Etched")).toBe(false);

    const etched = { productId: 450101, subTypeName: "Etched", marketPrice: 4.25 };
    expect(await ingestPrices(604, [etched], "2026-03-01", idx)).toMatchObject({ written: 1 });
    expect(idx.printingId.has("450101|Etched")).toBe(true);

    // The reused index must still resolve the printing on the next day.
    expect(await ingestPrices(604, [etched], "2026-03-02", idx)).toMatchObject({ unchanged: 1, written: 0 });
  });

  it("re-running the newest snapshot day repairs the latest tuple (no fabricated movement next day)", async () => {
    await upsertProducts(604, [{ productId: 450201, name: "Replay Tail A" }]);
    const key = { productId: 450201, subTypeName: "Normal" };

    expect(await ingestPrices(604, [{ ...key, marketPrice: 10 }], "2026-12-01")).toMatchObject({ written: 1 });
    expect(await ingestPrices(604, [{ ...key, marketPrice: 10 }], "2026-12-02")).toMatchObject({ written: 0, unchanged: 1 });

    const p = await printingIdFor(450201, "Normal");
    expect(await latestFor(p)).toMatchObject({ date: "2026-12-02", market: 10 });

    // Corrected re-run of 12-01 rewrites the NEWEST snapshot while latest.date stays 12-02.
    expect(await ingestPrices(604, [{ ...key, marketPrice: 99 }], "2026-12-01")).toMatchObject({ written: 1 });
    expect(await snapshotAt(p, "2026-12-01")).toMatchObject({ market: 99 });
    expect(await latestFor(p)).toMatchObject({ date: "2026-12-02", market: 99 });

    // With the tuple repaired, the next real day at 99 is genuinely unchanged.
    expect(await ingestPrices(604, [{ ...key, marketPrice: 99 }], "2026-12-03")).toMatchObject({ written: 0, unchanged: 1 });
    expect(await timeline(p)).toEqual([["2026-12-01", 99]]);
  });

  it("a canonicalizing delete of the newest snapshot repairs the latest tuple (current price stays right)", async () => {
    await upsertProducts(604, [{ productId: 450202, name: "Replay Tail B" }]);
    const key = { productId: 450202, subTypeName: "Normal" };

    expect(await ingestPrices(604, [{ ...key, marketPrice: 5 }], "2027-01-01")).toMatchObject({ written: 1 });
    expect(await ingestPrices(604, [{ ...key, marketPrice: 7 }], "2027-01-02")).toMatchObject({ written: 1 });
    expect(await ingestPrices(604, [{ ...key, marketPrice: 7 }], "2027-01-03")).toMatchObject({ written: 0, unchanged: 1 });

    const p = await printingIdFor(450202, "Normal");
    expect(await timeline(p)).toEqual([["2027-01-01", 5], ["2027-01-02", 7]]);
    expect(await latestFor(p)).toMatchObject({ date: "2027-01-03", market: 7 });

    // The 01-02 spike was bad: the correction equals 01-01, so that row is deleted.
    expect(await ingestPrices(604, [{ ...key, marketPrice: 5 }], "2027-01-02")).toMatchObject({ written: 0, unchanged: 1 });
    expect(await timeline(p)).toEqual([["2027-01-01", 5]]);
    expect(await latestFor(p)).toMatchObject({ date: "2027-01-03", market: 5 });
  });

  it("refreshes a hoisted GroupIndex's cards when a product is added to the same group later", async () => {
    const idx = await resolveGroupIndex(604);
    await upsertProducts(604, [{ productId: 450301, name: "Late Card" }]);
    expect(idx.cardByProduct.has(450301)).toBe(false);

    const res = await ingestPrices(
      604,
      [{ productId: 450301, subTypeName: "Normal", marketPrice: 1 }],
      "2026-06-01",
      idx
    );
    expect(res).toMatchObject({ written: 1, skippedWrongGroup: 0, skippedNoCard: 0 });
    expect(idx.cardByProduct.has(450301)).toBe(true);
  });

  it("rejects a syntactically well-formed but impossible date", async () => {
    await expect(ingestPrices(604, [P1], "2026-13-45")).rejects.toThrow(/YYYY-MM-DD/);
    await expect(ingestPrices(604, [P1], "2026-02-30")).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("normalizes a bigint price the same as a number", async () => {
    await upsertProducts(604, [{ productId: 450302, name: "Bigint Price" }]);
    const key = { productId: 450302, subTypeName: "Normal" };

    // libsql hands integer columns back as bigint; a bigint must not read as a change.
    expect(
      await ingestPrices(604, [{ ...key, marketPrice: BigInt(12) as unknown as number }], "2027-02-01")
    ).toMatchObject({ written: 1 });
    // 12 (number) must compare equal to the stored bigint-derived value.
    expect(await ingestPrices(604, [{ ...key, marketPrice: 12 }], "2027-02-02")).toMatchObject({
      written: 0,
      unchanged: 1,
    });

    const p = await printingIdFor(450302, "Normal");
    expect(await latestFor(p)).toMatchObject({ market: 12 });
  });

  it("handles more printings than the statement chunk size in one call", async () => {
    const products = Array.from({ length: 201 }, (_, i) => ({ productId: 900000 + i, name: `Bulk ${i}` }));
    await upsertProducts(604, products);

    const res = await ingestPrices(
      604,
      products.map((p) => ({ productId: p.productId, subTypeName: "Normal", marketPrice: 1 + p.productId % 3 })),
      "2026-04-01"
    );
    expect(res).toMatchObject({ written: 201, unchanged: 0, skippedNoCard: 0 });

    const c = await db();
    const n = Number((await c.execute(`SELECT COUNT(*) AS n FROM latest_prices lp
      JOIN printings p ON p.id = lp.printing_id
      JOIN cards ca ON ca.id = p.card_id
      WHERE ca.tcgplayer_product_id >= 900000`)).rows[0].n);
    expect(n).toBe(201);
  });

  it("a replay strictly between maxDate and latest.date is blocked by the upsert guard, so the repair is the only writer of the tuple", async () => {
    await upsertProducts(604, [{ productId: 450106, name: "Tail Replay" }]);
    const key = { productId: 450106, subTypeName: "Normal" };

    expect(await ingestPrices(604, [{ ...key, marketPrice: 10 }], "2028-01-01")).toMatchObject({ written: 1 });
    const p = await printingIdFor(450106, "Normal");
    expect(await ingestPrices(604, [{ ...key, marketPrice: 10 }], "2028-01-02")).toMatchObject({ written: 0, unchanged: 1 });
    expect(await ingestPrices(604, [{ ...key, marketPrice: 10 }], "2028-01-05")).toMatchObject({ written: 0, unchanged: 1 });
    expect(await latestFor(p)).toMatchObject({ date: "2028-01-05", market: 10 });

    // 2028-01-01 < 2028-01-03 < 2028-01-05: the upsert guard refuses the tuple
    // (excluded.date < latest_prices.date), so the repair UPDATE is the only
    // writer that can bring latest_prices back in line with the newest snapshot.
    expect(await ingestPrices(604, [{ ...key, marketPrice: 40 }], "2028-01-03")).toMatchObject({ written: 1 });
    expect(await latestFor(p)).toMatchObject({ date: "2028-01-05", market: 40 });

    // Proves the invariant held: the next day's `prev` came from the repaired
    // latest tuple (40), so an unchanged feed at 40 is genuinely unchanged.
    expect(await ingestPrices(604, [{ ...key, marketPrice: 40 }], "2028-01-06")).toMatchObject({ written: 0, unchanged: 1 });
    expect(await timeline(p)).toEqual([["2028-01-01", 10], ["2028-01-03", 40]]);
  });

  it("a newer snapshot already visible at scan time skips the repair (pre-filter); the SQL guard covers the in-flight race and is not exercisable single-threaded", async () => {
    await upsertProducts(604, [{ productId: 450107, name: "Concurrent Repair" }]);
    const c = await db();

    // Establish snapshots {2029-01-01=10}, latest {2029-01-01, 10}.
    expect(
      await ingestPrices(604, [{ productId: 450107, subTypeName: "Normal", marketPrice: 10 }], "2029-01-01")
    ).toMatchObject({ written: 1 });
    const p = await printingIdFor(450107, "Normal");
    expect(await latestFor(p)).toMatchObject({ date: "2029-01-01", market: 10 });

    // Simulate a concurrent in-order run that already committed a newer snapshot.
    await c.execute({
      sql: "INSERT INTO price_snapshots (printing_id, date, market, low, mid, high) VALUES (?, ?, ?, ?, ?, ?)",
      args: [p, "2029-01-09", 50, null, null, null],
    });
    await c.execute({
      sql: "UPDATE latest_prices SET date = ?, market = ?, low = NULL, mid = NULL, high = NULL WHERE printing_id = ?",
      args: ["2029-01-09", 50, p],
    });

    // Replaying 2029-01-05: the upsert guard blocks it (01-05 < latest.date
    // 01-09), and the pre-filter (maxSnapshotDate 01-09 > date 01-05) already
    // skips the repair entirely. The NOT EXISTS guard is defensive for a commit
    // landing between this call's scan and its batch, but is not exercisable here.
    expect(
      await ingestPrices(604, [{ productId: 450107, subTypeName: "Normal", marketPrice: 30 }], "2029-01-05")
    ).toMatchObject({ written: 1 });

    expect(await latestFor(p)).toMatchObject({ date: "2029-01-09", market: 50 });
    expect(await timeline(p)).toEqual([
      ["2029-01-01", 10],
      ["2029-01-05", 30],
      ["2029-01-09", 50],
    ]);
  });
});
