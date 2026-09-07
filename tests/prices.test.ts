import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { useTmpDb } from "./helpers/tmpdb";

const tmp = useTmpDb("prices");

import { db, closeDb } from "@/lib/db";
import { ensureGame, upsertSets, upsertProducts } from "@/ingest/catalog";
import { ingestPrices } from "@/ingest/prices";

beforeAll(async () => {
  await ensureGame({ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" });
  await upsertSets(3, [{ groupId: 604, name: "Scarlet & Violet" }]);
  await upsertProducts(3, 604, [{ productId: 450101, name: "Pikachu" }]);
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
});
