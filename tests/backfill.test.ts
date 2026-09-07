// tests/backfill.test.ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("backfill");

import { db, closeDb } from "@/lib/db";
import { ensureGame, upsertSets, upsertProducts } from "@/ingest/catalog";
import { replayDay, collectGroupPrices } from "@/ingest/backfill";

beforeAll(async () => {
  await ensureGame({ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" });
  await upsertSets(3, [{ groupId: 604, name: "Scarlet & Violet" }]);
  await upsertProducts(3, 604, [{ productId: 450101, name: "Pikachu" }]);
});

afterAll(() => {
  closeDb();
  tmp.clean();
});

describe("replayDay", () => {
  it("replays a day's group price files through write-on-change", async () => {
    const r1 = await replayDay("2024-02-08", [
      { groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 1.0 }] },
    ]);
    expect(r1.written).toBe(1);

    // unchanged next day -> no new snapshot
    const r2 = await replayDay("2024-02-09", [
      { groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 1.0 }] },
    ]);
    expect(r2.written).toBe(0);

    // changed -> snapshot
    const r3 = await replayDay("2024-02-10", [
      { groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 2.0 }] },
    ]);
    expect(r3.written).toBe(1);

    const c = await db();
    expect(Number((await c.execute("SELECT COUNT(*) AS n FROM price_snapshots")).rows[0].n)).toBe(2);
  });

  it("reuses a per-group index cache across days", async () => {
    const cache = new Map();
    await replayDay("2024-03-01", [{ groupId: 604, prices: [{ productId: 450101, subTypeName: "Normal", marketPrice: 5 }] }], cache);
    expect(cache.has(604)).toBe(true);
    const idx = cache.get(604)!;
    await replayDay("2024-03-02", [{ groupId: 604, prices: [{ productId: 450101, subTypeName: "Normal", marketPrice: 5 }] }], cache);
    expect(cache.get(604)).toBe(idx); // same object reused
  });
});

describe("collectGroupPrices", () => {
  it("finds price files by shape and takes the group id from the parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "hitstreak-bf-fixture-"));
    mkdirSync(join(root, "2024-02-08", "3", "604"), { recursive: true });
    writeFileSync(
      join(root, "2024-02-08", "3", "604", "prices"),
      JSON.stringify({ results: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 1.0 }] })
    );
    // a products file must be ignored (no subTypeName), as must non-JSON
    writeFileSync(join(root, "2024-02-08", "3", "604", "products"), JSON.stringify({ results: [{ productId: 450101, name: "Pikachu" }] }));
    writeFileSync(join(root, "README.txt"), "not json");

    const groups = collectGroupPrices(root);
    expect(groups).toEqual([{ groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 1.0 }] }]);
    rmSync(root, { recursive: true, force: true });
  });
});
