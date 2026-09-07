// tests/backfill.test.ts
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("backfill");

import { db, closeDb } from "@/lib/db";
import { ensureGame, upsertSets, upsertProducts } from "@/ingest/catalog";
import { replayDay, collectGroupPrices, downloadAndExtract } from "@/ingest/backfill";

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

  it("skips a group not in knownGroupIds without touching the DB", async () => {
    const c = await db();
    const before = Number((await c.execute("SELECT COUNT(*) AS n FROM printings")).rows[0].n);

    const r = await replayDay(
      "2024-04-01",
      [
        // "Holofoil" for 450101/604 already exists (created in the first test above),
        // so this contributes no new printing row — isolating the assertion below to 9999.
        { groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 3 }] },
        { groupId: 9999, prices: [{ productId: 1, subTypeName: "Normal", marketPrice: 1 }] },
      ],
      new Map(),
      new Set([604])
    );
    expect(r.skippedUnknownGroup).toBe(1);

    const after = Number((await c.execute("SELECT COUNT(*) AS n FROM printings")).rows[0].n);
    expect(after).toBe(before); // group 9999 was skipped before any resolveGroupIndex/ingestPrices call
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

  it("prunes untracked category subtrees when categoryIds is given, but fails open on a non-integer category dir", () => {
    const root = mkdtempSync(join(tmpdir(), "hitstreak-bf-fixture2-"));
    const priceBody = (productId: number) =>
      JSON.stringify({ results: [{ productId, subTypeName: "Holofoil", marketPrice: 1.0 }] });

    // tracked category 3, group 604 -> kept
    mkdirSync(join(root, "2024-02-08", "3", "604"), { recursive: true });
    writeFileSync(join(root, "2024-02-08", "3", "604", "prices"), priceBody(1));

    // untracked category 2, group 999 -> pruned (never even parsed)
    mkdirSync(join(root, "2024-02-08", "2", "999"), { recursive: true });
    writeFileSync(join(root, "2024-02-08", "2", "999", "prices"), priceBody(2));

    // non-integer dir name at the category depth -> fails open, still walked
    mkdirSync(join(root, "2024-02-08", "misc", "777"), { recursive: true });
    writeFileSync(join(root, "2024-02-08", "misc", "777", "prices"), priceBody(3));

    const groups = collectGroupPrices(root, new Set([3]));
    const groupIds = groups.map((g) => g.groupId).sort((a, b) => a - b);
    expect(groupIds).toEqual([604, 777]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("downloadAndExtract", () => {
  it("returns null on a 404 (day missing from the archive)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const result = await downloadAndExtract("2024-02-08", fetchImpl);
    expect(result).toBeNull();
  });

  it("drains the body and rejects with the date and status on a non-OK response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("server error", { status: 500 }));
    await expect(downloadAndExtract("2024-02-08", fetchImpl)).rejects.toThrow(/archive 2024-02-08 -> 500/);
  });
});
