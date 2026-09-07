// Daily ingest orchestrator. Archive raw responses first, then upsert catalog,
// then write-on-change prices. Games are isolated: one failure doesn't stop the rest.
import { createTcgcsvClient, type TcgcsvClient } from "./tcgcsv";
import { ensureGame, upsertSets, upsertProducts, GAMES, type GameSeed } from "./catalog";
import { ingestPrices } from "./prices";
import { rawArchiverFromEnv, type RawArchiver } from "./r2";
import { closeDb } from "@/lib/db";

export interface DailyIngestOptions {
  client: TcgcsvClient;
  archiver: RawArchiver;
  date: string; // YYYY-MM-DD UTC
  games: GameSeed[];
  requireArchiver?: boolean; // CLI sets this from CI so a misconfigured secret fails loudly; tests leave it off
}

export interface GameSummary {
  slug: string;
  sets: number;
  cards: number;
  written: number;
  unchanged: number;
  skippedNoCard: number;
  skippedWrongGroup: number;
}

export interface DailySummary {
  perGame: GameSummary[];
  failures: { slug: string; error: string }[];
}

export async function runDailyIngest(opts: DailyIngestOptions): Promise<DailySummary> {
  const summary: DailySummary = { perGame: [], failures: [] };
  // Archive-first is the #1 risk mitigation; a silently disabled archiver in CI would defeat it.
  console.log(`R2 raw archiving: ${opts.archiver.enabled ? "enabled" : "DISABLED"}`);
  if (!opts.archiver.enabled && opts.requireArchiver) {
    throw new Error("R2 archiving is disabled but required for this run — check the R2_* secrets");
  }

  for (const game of opts.games) {
    try {
      await ensureGame(game);
      const cat = game.tcgplayerCategoryId;

      const groups = await opts.client.fetchGroups(cat);
      await opts.archiver.putRaw(opts.date, cat, "groups", { results: groups });
      await upsertSets(cat, groups);

      const g: GameSummary = {
        slug: game.slug, sets: groups.length, cards: 0, written: 0, unchanged: 0, skippedNoCard: 0, skippedWrongGroup: 0,
      };

      for (const group of groups) {
        const products = await opts.client.fetchProducts(cat, group.groupId);
        await opts.archiver.putRaw(opts.date, cat, `${group.groupId}-products`, { results: products });
        await upsertProducts(cat, group.groupId, products);
        g.cards += products.length;

        const prices = await opts.client.fetchPrices(cat, group.groupId);
        await opts.archiver.putRaw(opts.date, cat, `${group.groupId}-prices`, { results: prices });
        if (prices.length === 0 && products.length > 0) {
          console.warn(`[${game.slug}] group ${group.groupId} returned 0 prices for ${products.length} products — suspicious`);
        }
        const r = await ingestPrices(group.groupId, prices, opts.date);
        g.written += r.written;
        g.unchanged += r.unchanged;
        g.skippedNoCard += r.skippedNoCard;
        g.skippedWrongGroup += r.skippedWrongGroup;
      }

      summary.perGame.push(g);
      console.log(`[${game.slug}] sets=${g.sets} cards=${g.cards} priceWrites=${g.written} unchanged=${g.unchanged} skippedNoCard=${g.skippedNoCard} skippedWrongGroup=${g.skippedWrongGroup}`);
      if (g.skippedWrongGroup > 0) console.warn(`[${game.slug}] ${g.skippedWrongGroup} prices belong to products catalogued under another group (catalog drift)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.failures.push({ slug: game.slug, error: msg });
      console.error(`[${game.slug}] FAILED: ${msg}`);
    }
  }

  return summary;
}

// CLI entry: npx tsx ingest/daily.ts
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("ingest/daily.ts");
if (isMain) {
  const date = new Date().toISOString().slice(0, 10); // UTC date; never a locale date
  runDailyIngest({
    client: createTcgcsvClient({}),
    archiver: rawArchiverFromEnv(),
    date,
    games: GAMES,
    requireArchiver: Boolean(process.env.CI),
  })
    .then((s) => {
      closeDb();
      if (s.failures.length > 0) process.exit(1);
    })
    .catch((e) => {
      console.error(e);
      closeDb();
      process.exit(1);
    });
}
