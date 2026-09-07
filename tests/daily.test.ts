import { describe, it, expect, afterAll, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("daily");

import { db, closeDb } from "@/lib/db";
import { runDailyIngest } from "@/ingest/daily";
import { createRawArchiver, type RawArchiver } from "@/ingest/r2";
import type { TcgcsvClient } from "@/ingest/tcgcsv";

afterAll(() => {
  closeDb();
  tmp.clean();
});

const noArchiver = () => createRawArchiver({ s3: null, bucket: undefined });

function stubClient(overrides: Partial<TcgcsvClient> = {}): TcgcsvClient {
  return {
    fetchGroups: vi.fn().mockResolvedValue([{ groupId: 604, name: "Test Set" }]),
    fetchProducts: vi.fn().mockResolvedValue([{ productId: 1, name: "Card A" }]),
    fetchPrices: vi.fn().mockResolvedValue([{ productId: 1, subTypeName: "Normal", marketPrice: 1.5 }]),
    ...overrides,
  } as TcgcsvClient;
}

// Tests share one file DB, so every stub derives its productIds from the groupId
// (cards.tcgplayer_product_id is globally unique) and each test owns its group ids.
function groupsClient(groupIds: number[], overrides: Partial<TcgcsvClient> = {}): TcgcsvClient {
  return stubClient({
    fetchGroups: vi.fn().mockResolvedValue(groupIds.map((groupId) => ({ groupId, name: `Set ${groupId}` }))),
    fetchProducts: vi.fn().mockImplementation((_cat: number, groupId: number) =>
      Promise.resolve([{ productId: groupId * 10 + 1, name: `Card ${groupId}` }])
    ),
    fetchPrices: vi.fn().mockImplementation((_cat: number, groupId: number) =>
      Promise.resolve([{ productId: groupId * 10 + 1, subTypeName: "Normal", marketPrice: 2.25 }])
    ),
    ...overrides,
  });
}

const countOf = async (sql: string): Promise<number> =>
  Number((await (await db()).execute(sql)).rows[0].n);

describe("runDailyIngest", () => {
  it("ingests all games and reports per-game summaries", async () => {
    const summary = await runDailyIngest({
      client: stubClient(),
      archiver: noArchiver(),
      date: "2026-09-05",
      games: [
        { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
        { tcgplayerCategoryId: 68, name: "One Piece Card Game", slug: "one-piece" },
      ],
    });
    expect(summary.failures).toEqual([]);
    expect(summary.perGame).toHaveLength(2);
    expect(summary.perGame[0]).toMatchObject({ slug: "pokemon", written: 1, groupsOk: 1, failedGroups: [] });

    // Scoped to this test's categories: the DB is shared with the tests below.
    expect(await countOf("SELECT COUNT(*) AS n FROM games WHERE tcgplayer_category_id IN (3, 68)")).toBe(2);
  });

  it("fails fast when archiving is required but disabled", async () => {
    await expect(
      runDailyIngest({
        client: stubClient(),
        archiver: noArchiver(),
        date: "2026-09-07",
        games: [{ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" }],
        requireArchiver: true,
      })
    ).rejects.toThrow(/R2 archiving is disabled/);
  });

  it("isolates a failing game and reports it", async () => {
    const failing = stubClient({
      fetchGroups: vi.fn().mockRejectedValue(new Error("tcgcsv down")),
    });
    const summary = await runDailyIngest({
      client: failing,
      archiver: noArchiver(),
      date: "2026-09-06",
      games: [
        { tcgplayerCategoryId: 89, name: "Riftbound", slug: "riftbound" },
        { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
      ],
    });
    expect(summary.failures).toHaveLength(2); // stub fails for both here
    expect(summary.failures[0]).toMatchObject({ slug: "riftbound" });
  });

  it("writes nothing when the groups archive fails (archive-first)", async () => {
    const archiver = { enabled: true, putRaw: vi.fn().mockRejectedValue(new Error("R2 down")) } as unknown as RawArchiver;
    const summary = await runDailyIngest({
      client: stubClient({ fetchGroups: vi.fn().mockResolvedValue([{ groupId: 999, name: "Archive Test" }]) }),
      archiver,
      date: "2026-09-08",
      games: [{ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" }],
    });
    expect(summary.failures[0]).toMatchObject({ slug: "pokemon" });
    expect(await countOf("SELECT COUNT(*) AS n FROM sets WHERE tcgplayer_group_id = 999")).toBe(0);
  });

  it("keeps ingesting the remaining games after one game fails", async () => {
    const summary = await runDailyIngest({
      client: stubClient({
        fetchGroups: vi.fn().mockImplementation((cat: number) =>
          cat === 89 ? Promise.reject(new Error("down")) : Promise.resolve([{ groupId: 604, name: "Test Set" }])
        ),
      }),
      archiver: noArchiver(),
      date: "2026-09-09",
      games: [
        { tcgplayerCategoryId: 89, name: "Riftbound", slug: "riftbound" },
        { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
      ],
    });
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatchObject({ slug: "riftbound" });

    const pokemon = summary.perGame.find((g) => g.slug === "pokemon");
    expect(pokemon).toBeDefined();
    expect(pokemon!.written + pokemon!.unchanged).toBeGreaterThanOrEqual(1);
  });

  it("isolates a failing group without failing its game", async () => {
    const summary = await runDailyIngest({
      client: groupsClient([701, 702, 703], {
        fetchProducts: vi.fn().mockImplementation((_cat: number, groupId: number) =>
          groupId === 702
            ? Promise.reject(new Error("products 502"))
            : Promise.resolve([{ productId: groupId * 10 + 1, name: `Card ${groupId}` }])
        ),
      }),
      archiver: noArchiver(),
      date: "2026-09-10",
      games: [{ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" }],
    });
    expect(summary.failures).toEqual([]);
    expect(summary.perGame[0].failedGroups).toEqual([702]);
    expect(summary.perGame[0].groupsOk).toBe(2);

    expect(await countOf(
      `SELECT COUNT(*) AS n FROM cards
       JOIN sets ON sets.id = cards.set_id
       WHERE sets.tcgplayer_group_id IN (701, 703)`
    )).toBe(2);
  });

  it("trips the breaker after consecutive group failures", async () => {
    const summary = await runDailyIngest({
      client: groupsClient([801, 802, 803, 804, 805, 806], {
        fetchProducts: vi.fn().mockRejectedValue(new Error("products 502")),
      }),
      archiver: noArchiver(),
      date: "2026-09-11",
      games: [{ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" }],
    });
    expect(summary.failures[0].error).toMatch(/consecutive group failures/);
    expect(summary.perGame[0].failedGroups).toHaveLength(5);
  });

  it("stops a game once the soft deadline has passed", async () => {
    const summary = await runDailyIngest({
      client: groupsClient([901]),
      archiver: noArchiver(),
      date: "2026-09-12",
      games: [{ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" }],
      deadlineAt: Date.now() - 1,
    });
    expect(summary.failures[0].error).toMatch(/deadline exceeded/);
    expect(summary.perGame[0].groupsOk).toBe(0);
  });

  it("rejects a malformed date before touching R2 or the DB", async () => {
    await expect(
      runDailyIngest({
        client: stubClient(),
        archiver: noArchiver(),
        date: "2026-9-7",
        games: [{ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" }],
      })
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});
