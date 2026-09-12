// Replays tcgcsv daily price archives (2024-02-08 onward) through the same
// write-on-change path as the daily ingest. Run ONCE, oldest date first,
// ideally right after the first daily catalog sync.
//
// Usage: npx tsx ingest/backfill.ts 2024-02-08 2026-09-04
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestPrices, isCalendarDate, resolveGroupIndex, type GroupIndex } from "./prices";
import type { TcgcsvPrice } from "./tcgcsv";
import { GAMES } from "./catalog";
import { closeDb, db } from "@/lib/db";

export interface GroupPrices {
  groupId: number;
  prices: TcgcsvPrice[];
}

/** Per-group catalog lookups are identical across the ~900 replayed days; cache them.
 *  ingestPrices mutates a passed index when it creates printings, so the cache stays valid. */
export type GroupIndexCache = Map<number, GroupIndex>;

export interface ReplayResult {
  written: number;
  unchanged: number;
  skippedNoCard: number;
  skippedWrongGroup: number;
  skippedUnknownGroup: number; // groupId not in the catalog (`sets`) at all — skipped without touching the DB
}

export async function replayDay(
  date: string,
  groups: GroupPrices[],
  cache: GroupIndexCache = new Map(),
  knownGroupIds?: ReadonlySet<number>
): Promise<ReplayResult> {
  const total: ReplayResult = {
    written: 0,
    unchanged: 0,
    skippedNoCard: 0,
    skippedWrongGroup: 0,
    skippedUnknownGroup: 0,
  };
  for (const g of groups) {
    if (knownGroupIds && !knownGroupIds.has(g.groupId)) {
      total.skippedUnknownGroup++;
      continue;
    }
    let index = cache.get(g.groupId);
    if (!index) {
      index = await resolveGroupIndex(g.groupId);
      cache.set(g.groupId, index);
    }
    const r = await ingestPrices(g.groupId, g.prices, date, index);
    total.written += r.written;
    total.unchanged += r.unchanged;
    total.skippedNoCard += r.skippedNoCard;
    total.skippedWrongGroup += r.skippedWrongGroup;
  }
  return total;
}

/** All group ids already known to the catalog (`sets.tcgplayer_group_id`). Used to
 *  skip archive groups the catalog sync hasn't seeded yet, without touching the DB. */
export async function loadKnownGroupIds(): Promise<Set<number>> {
  const c = await db();
  const rows = (await c.execute("SELECT tcgplayer_group_id AS id FROM sets")).rows;
  return new Set(rows.map((r) => Number(r.id)));
}

/**
 * Walk an extracted archive dir; collect price files per group.
 *
 * Verified archive layout: `<root>/<date>/<categoryId>/<groupId>/prices` (a bare
 * filename, no extension). Every one of TCGplayer's ~92 categories is present in
 * the daily archive (~6,566 files/day total), but `GAMES` (ingest/catalog.ts)
 * only tracks a handful (currently 3, 68, 89). When `categoryIds` is given, this
 * prunes untracked category subtrees at the `<categoryId>` level (depth 1 under
 * `root`, i.e. one level under `<date>`) instead of parsing and discarding
 * thousands of files per day.
 *
 * Pruning only ever fires on a directory name that parses as an integer at that
 * depth. A non-integer name at depth 1 is an unexpected shape and is walked
 * anyway (fail open) — silently dropping data because of a layout surprise
 * would be worse than doing a bit of extra work.
 *
 * Below the category level this stays path-shape-agnostic: any JSON file whose
 * parsed body has results[].subTypeName counts as a group price file; groupId
 * comes from the parent directory name.
 */
export function collectGroupPrices(root: string, categoryIds?: ReadonlySet<number>): GroupPrices[] {
  // Keyed by groupId (Map preserves first-seen insertion order) so that two
  // files under the same group directory — which does happen in the archive —
  // merge into one entry instead of the second silently shadowing the first.
  const byGroup = new Map<number, GroupPrices>();
  const walk = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (depth === 1 && categoryIds) {
          const categoryId = Number(entry);
          if (Number.isInteger(categoryId) && !categoryIds.has(categoryId)) continue; // untracked category, prune
        }
        walk(p, depth + 1);
        continue;
      }
      let body: { results?: TcgcsvPrice[] };
      try {
        body = JSON.parse(readFileSync(p, "utf8"));
      } catch {
        continue; // not JSON
      }
      const results = body.results;
      if (!Array.isArray(results) || results.length === 0) continue;
      if (typeof results[0]?.subTypeName !== "string") continue; // not a prices file
      // tcgcsv archives lay out .../<categoryId>/<groupId>/prices — the group id is the parent dir.
      const parent = dir.split(/[\\/]/).pop() ?? "";
      const groupId = Number(parent);
      if (!Number.isInteger(groupId)) continue;
      const existing = byGroup.get(groupId);
      if (existing) existing.prices = existing.prices.concat(results);
      else byGroup.set(groupId, { groupId, prices: results });
    }
  };
  walk(root, 0);
  return [...byGroup.values()];
}

function* dateRange(from: string, to: string): Generator<string> {
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/**
 * The 7-Zip binary. The archives are PPMd-compressed .7z, which no Node or Python decoder on a
 * default install can read, so this is a real dependency.
 *
 * PATH first, then the standard Windows install locations: the official installer does NOT add
 * itself to PATH, so `winget install 7zip.7zip` leaves a perfectly good 7z.exe that a bare `7z`
 * cannot find. Cached, because this runs once per replayed day.
 */
let sevenZipPath: string | null = null;
export function sevenZip(): string {
  if (sevenZipPath) return sevenZipPath;
  const candidates = [
    "7z",
    // Forward slashes on purpose: Windows accepts them, and they survive every layer of
    // escaping between here and the shell.
    "C:/Program Files/7-Zip/7z.exe",
    "C:/Program Files (x86)/7-Zip/7z.exe",
    "/usr/bin/7z",
    "/usr/local/bin/7z",
    "/opt/homebrew/bin/7z",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["i"], { stdio: "ignore" });
      sevenZipPath = c;
      return c;
    } catch {
      /* not here; try the next */
    }
  }
  throw new Error(
    "7-Zip not found. The price archives are PPMd .7z and need it: `winget install 7zip.7zip`, " +
      "or put 7z on PATH."
  );
}

export async function downloadAndExtract(date: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const url = `https://tcgcsv.com/archive/tcgplayer/prices-${date}.ppmd.7z`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "hitstreak-ingest/1.0 (github.com/renzoralphpua/hitstreak)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 404) return null; // day missing from archive; skip
  if (!res.ok) {
    await res.text().catch(() => {}); // release the connection before throwing
    throw new Error(`archive ${date} -> ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), `hitstreak-bf-${date}-`));
  const archivePath = join(dir, "prices.7z");
  writeFileSync(archivePath, buf);
  try {
    execFileSync(sevenZip(), ["x", archivePath, `-o${dir}/x`, "-y"], { stdio: "ignore" });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`archive ${date}: 7z extraction failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return join(dir, "x");
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("ingest/backfill.ts");
if (isMain) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to || !isCalendarDate(from) || !isCalendarDate(to) || from > to) {
    console.error("usage: tsx ingest/backfill.ts <from YYYY-MM-DD> <to YYYY-MM-DD>");
    process.exit(2);
  }
  void (async () => {
    const cache: GroupIndexCache = new Map();
    const categoryIds = new Set(GAMES.map((g) => g.tcgplayerCategoryId));
    const knownGroupIds = await loadKnownGroupIds();
    const started = Date.now();
    for (const date of dateRange(from, to)) {
      const extracted = await downloadAndExtract(date);
      if (!extracted) {
        console.log(`[${date}] no archive, skipped`);
        continue;
      }
      try {
        const groups = collectGroupPrices(extracted, categoryIds);
        // A throw here leaves the day PARTIALLY applied (earlier groups committed). It is logged
        // and the loop stops so the operator re-runs from this date; re-runs repair.
        let r;
        try {
          r = await replayDay(date, groups, cache, knownGroupIds);
        } catch (e) {
          throw new Error(`[${date}] replay failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
        }
        console.log(`[${date}] groups=${groups.length} written=${r.written} unchanged=${r.unchanged} skippedNoCard=${r.skippedNoCard} skippedWrongGroup=${r.skippedWrongGroup} skippedUnknownGroup=${r.skippedUnknownGroup} elapsed=${Math.round((Date.now() - started) / 60000)}m`);
      } finally {
        rmSync(join(extracted, ".."), { recursive: true, force: true });
      }
    }
    closeDb();
  })().catch((e) => {
    console.error(e);
    closeDb();
    process.exitCode = 1;
  });
}
