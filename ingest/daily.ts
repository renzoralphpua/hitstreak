// Daily ingest orchestrator. Archive raw responses first, then upsert catalog,
// then write-on-change prices. Failures are isolated at two levels: one game's
// failure doesn't stop the rest, and one group's failure doesn't stop its game
// (up to a consecutive-failure breaker, so a systemic outage still aborts fast).
// Every GameSummary is pushed before its work starts and mutated in place, so a
// game that dies midway still reports what it completed.
import { createTcgcsvClient, type TcgcsvClient } from "./tcgcsv";
import { ensureGame, upsertSets, upsertProducts, GAMES, type GameSeed } from "./catalog";
import { ingestPrices } from "./prices";
import { rawArchiverFromEnv, type RawArchiver } from "./r2";
import { closeDb } from "@/lib/db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CONSECUTIVE_GROUP_FAILURES = 5; // a run of failures this long is an outage, not bad data
const HEARTBEAT_GROUPS = 50; // progress line cadence, so a stalled run is visible in CI logs
const ZERO_PRICE_IDS_LOGGED = 20; // the summary line names the first N; the rest live in the JSON summary

export interface DailyIngestOptions {
  client: TcgcsvClient;
  archiver: RawArchiver;
  date: string; // YYYY-MM-DD UTC
  games: GameSeed[];
  requireArchiver?: boolean; // CLI sets this from CI so a misconfigured secret fails loudly; tests leave it off
  deadlineAt?: number; // epoch ms; checked before each group so a long run stops itself before the CI timeout kills it
}

export interface GameSummary {
  slug: string;
  sets: number;
  cards: number;
  written: number;
  unchanged: number;
  skippedNoCard: number;
  skippedWrongGroup: number;
  groupsOk: number;
  failedGroups: number[];
  zeroPriceGroups: number[]; // groups that returned 0 prices for >0 products — suspicious
  elapsedMs: number;
}

export interface DailySummary {
  date: string;
  perGame: GameSummary[];
  failures: { slug: string; error: string }[];
  elapsedMs: number;
}

export async function runDailyIngest(opts: DailyIngestOptions): Promise<DailySummary> {
  // Validated here, not just at the CLI, so a bad date can never reach an R2 key or a snapshot row.
  if (!DATE_RE.test(opts.date)) {
    throw new Error(`runDailyIngest: date must be YYYY-MM-DD, got ${opts.date}`);
  }

  const startedAt = Date.now();
  const summary: DailySummary = { date: opts.date, perGame: [], failures: [], elapsedMs: 0 };
  // Archive-first is the #1 risk mitigation; a silently disabled archiver in CI would defeat it.
  console.log(`R2 raw archiving: ${opts.archiver.enabled ? "enabled" : "DISABLED"}`);
  if (!opts.archiver.enabled && opts.requireArchiver) {
    throw new Error("R2 archiving is disabled but required for this run — check the R2_* secrets");
  }

  for (const game of opts.games) {
    const gameStartedAt = Date.now();
    // Declared and published BEFORE any work so partial progress survives a mid-game failure.
    const g: GameSummary = {
      slug: game.slug, sets: 0, cards: 0, written: 0, unchanged: 0, skippedNoCard: 0, skippedWrongGroup: 0,
      groupsOk: 0, failedGroups: [], zeroPriceGroups: [], elapsedMs: 0,
    };
    summary.perGame.push(g);

    try {
      await ensureGame(game);
      const cat = game.tcgplayerCategoryId;

      const groups = await opts.client.fetchGroups(cat);
      g.sets = groups.length;
      await opts.archiver.putRaw(opts.date, cat, "groups", { results: groups });
      await upsertSets(cat, groups);

      let consecutiveFailures = 0;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        // Checked before the first group too, so once the deadline passes the
        // remaining games fail fast instead of each starting fresh work.
        if (opts.deadlineAt && Date.now() > opts.deadlineAt) {
          throw new Error(`deadline exceeded after ${g.groupsOk}/${groups.length} groups`);
        }
        if (i > 0 && i % HEARTBEAT_GROUPS === 0) {
          const mins = Math.round((Date.now() - gameStartedAt) / 60_000);
          console.log(`[${game.slug}] ${i}/${groups.length} groups, ${mins}m elapsed`);
        }

        // One group's failure is data-shaped, not run-shaped: record it and move on.
        try {
          const products = await opts.client.fetchProducts(cat, group.groupId);
          await opts.archiver.putRaw(opts.date, cat, `${group.groupId}-products`, { results: products });
          await upsertProducts(cat, group.groupId, products);
          g.cards += products.length;

          const prices = await opts.client.fetchPrices(cat, group.groupId);
          await opts.archiver.putRaw(opts.date, cat, `${group.groupId}-prices`, { results: prices });
          if (prices.length === 0 && products.length > 0) g.zeroPriceGroups.push(group.groupId);
          const r = await ingestPrices(group.groupId, prices, opts.date);
          g.written += r.written;
          g.unchanged += r.unchanged;
          g.skippedNoCard += r.skippedNoCard;
          g.skippedWrongGroup += r.skippedWrongGroup;

          g.groupsOk++;
          consecutiveFailures = 0;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          g.failedGroups.push(group.groupId);
          console.error(`[${game.slug}] group ${group.groupId} FAILED: ${msg}`);
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_GROUP_FAILURES) {
            throw new Error(`${consecutiveFailures} consecutive group failures — aborting ${game.slug}`);
          }
        }
      }

      g.elapsedMs = Date.now() - gameStartedAt;
      console.log(
        `[${game.slug}] sets=${g.sets} groupsOk=${g.groupsOk} failedGroups=${g.failedGroups.length} cards=${g.cards}` +
        ` priceWrites=${g.written} unchanged=${g.unchanged} skippedNoCard=${g.skippedNoCard}` +
        ` skippedWrongGroup=${g.skippedWrongGroup} zeroPriceGroups=${formatIds(g.zeroPriceGroups)}` +
        ` elapsedMs=${g.elapsedMs}`
      );
      if (g.skippedWrongGroup > 0) console.warn(`[${game.slug}] ${g.skippedWrongGroup} prices belong to products catalogued under another group (catalog drift)`);
    } catch (e) {
      g.elapsedMs = Date.now() - gameStartedAt;
      const msg = e instanceof Error ? e.message : String(e);
      summary.failures.push({ slug: game.slug, error: msg });
      console.error(`[${game.slug}] FAILED: ${msg}`);
    }
  }

  summary.elapsedMs = Date.now() - startedAt;
  return summary;
}

// `N` alone when there is nothing to name, else `N [id, id, …]` capped so one bad
// day's thousands of ids cannot bury the summary line.
function formatIds(ids: number[]): string {
  if (ids.length === 0) return "0";
  const head = ids.slice(0, ZERO_PRICE_IDS_LOGGED).join(", ");
  return `${ids.length} [${head}${ids.length > ZERO_PRICE_IDS_LOGGED ? ", …" : ""}]`;
}

// CLI entry: npx tsx ingest/daily.ts [YYYY-MM-DD]
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("ingest/daily.ts");
if (isMain) {
  const argDate = process.argv[2] ?? process.env.INGEST_DATE;
  if (argDate !== undefined && !DATE_RE.test(argDate)) {
    console.error("usage: tsx ingest/daily.ts [YYYY-MM-DD]");
    process.exit(2);
  }
  const date = argDate ?? new Date().toISOString().slice(0, 10); // UTC date; never a locale date
  void runDailyIngest({
    client: createTcgcsvClient({}),
    archiver: rawArchiverFromEnv(),
    date,
    games: GAMES,
    requireArchiver: Boolean(process.env.CI),
    deadlineAt: Date.now() + 50 * 60_000, // headroom under the scheduled job's own timeout
  })
    .then((s) => {
      closeDb();
      // Greppable single line: CI can diff yesterday's counts without scraping the log.
      console.log(`DAILY_SUMMARY ${JSON.stringify(s)}`);
      // exitCode, not exit(): let stdout/stderr drain. Any failed group is a
      // real gap in the day's data, so it fails the run just like a failed game.
      if (s.failures.length > 0 || s.perGame.some((p) => p.failedGroups.length > 0)) process.exitCode = 1;
    })
    .catch((e) => {
      console.error(e);
      closeDb();
      process.exitCode = 1;
    });
}
