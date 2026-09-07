import { describe, it, expect, afterAll, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("daily");

import { db, closeDb } from "@/lib/db";
import { runDailyIngest } from "@/ingest/daily";
import { createRawArchiver } from "@/ingest/r2";
import type { TcgcsvClient } from "@/ingest/tcgcsv";

afterAll(() => {
  closeDb();
  tmp.clean();
});

function stubClient(overrides: Partial<TcgcsvClient> = {}): TcgcsvClient {
  return {
    fetchGroups: vi.fn().mockResolvedValue([{ groupId: 604, name: "Test Set" }]),
    fetchProducts: vi.fn().mockResolvedValue([{ productId: 1, name: "Card A" }]),
    fetchPrices: vi.fn().mockResolvedValue([{ productId: 1, subTypeName: "Normal", marketPrice: 1.5 }]),
    ...overrides,
  } as TcgcsvClient;
}

describe("runDailyIngest", () => {
  it("ingests all games and reports per-game summaries", async () => {
    const summary = await runDailyIngest({
      client: stubClient(),
      archiver: createRawArchiver({ s3: null, bucket: undefined }),
      date: "2026-09-05",
      games: [
        { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
        { tcgplayerCategoryId: 68, name: "One Piece Card Game", slug: "one-piece" },
      ],
    });
    expect(summary.failures).toEqual([]);
    expect(summary.perGame).toHaveLength(2);
    expect(summary.perGame[0]).toMatchObject({ slug: "pokemon", written: 1 });

    const c = await db();
    expect(Number((await c.execute("SELECT COUNT(*) AS n FROM games")).rows[0].n)).toBe(2);
  });

  it("fails fast when archiving is required but disabled", async () => {
    await expect(
      runDailyIngest({
        client: stubClient(),
        archiver: createRawArchiver({ s3: null, bucket: undefined }),
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
      archiver: createRawArchiver({ s3: null, bucket: undefined }),
      date: "2026-09-06",
      games: [
        { tcgplayerCategoryId: 89, name: "Riftbound", slug: "riftbound" },
        { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
      ],
    });
    expect(summary.failures).toHaveLength(2); // stub fails for both here
    expect(summary.failures[0]).toMatchObject({ slug: "riftbound" });
  });
});
