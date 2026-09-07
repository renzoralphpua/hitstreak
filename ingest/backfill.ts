// Replays tcgcsv daily price archives (2024-02-08 onward) through the same
// write-on-change path as the daily ingest. Run ONCE, oldest date first,
// ideally right after the first daily catalog sync.
//
// Usage: npx tsx ingest/backfill.ts 2024-02-08 2026-09-04
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestPrices, resolveGroupIndex, type GroupIndex } from "./prices";
import type { TcgcsvPrice } from "./tcgcsv";
import { closeDb } from "@/lib/db";

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
}

export async function replayDay(
  date: string,
  groups: GroupPrices[],
  cache: GroupIndexCache = new Map()
): Promise<ReplayResult> {
  const total: ReplayResult = { written: 0, unchanged: 0, skippedNoCard: 0, skippedWrongGroup: 0 };
  for (const g of groups) {
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

/** Walk an extracted archive dir; collect price files per group.
 *  Path-shape-agnostic: any JSON file whose parsed body has results[].subTypeName
 *  counts as a group price file; groupId comes from the parent directory name. */
export function collectGroupPrices(root: string): GroupPrices[] {
  const out: GroupPrices[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
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
      out.push({ groupId, prices: results });
    }
  };
  walk(root);
  return out;
}

function* dateRange(from: string, to: string): Generator<string> {
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

async function downloadAndExtract(date: string): Promise<string | null> {
  const url = `https://tcgcsv.com/archive/tcgplayer/prices-${date}.ppmd.7z`;
  const res = await fetch(url, {
    headers: { "User-Agent": "hitstreak-ingest/1.0 (github.com/renzoralphpua/hitstreak)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 404) return null; // day missing from archive; skip
  if (!res.ok) throw new Error(`archive ${date} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), `hitstreak-bf-${date}-`));
  const archivePath = join(dir, "prices.7z");
  writeFileSync(archivePath, buf);
  execFileSync("7z", ["x", archivePath, `-o${dir}/x`, "-y"], { stdio: "ignore" });
  return join(dir, "x");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("ingest/backfill.ts");
if (isMain) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    console.error("usage: tsx ingest/backfill.ts <from YYYY-MM-DD> <to YYYY-MM-DD>");
    process.exit(2);
  }
  void (async () => {
    const cache: GroupIndexCache = new Map();
    const started = Date.now();
    for (const date of dateRange(from, to)) {
      const extracted = await downloadAndExtract(date);
      if (!extracted) {
        console.log(`[${date}] no archive, skipped`);
        continue;
      }
      try {
        const groups = collectGroupPrices(extracted);
        // A throw here leaves the day PARTIALLY applied (earlier groups committed). It is logged
        // and the loop stops so the operator re-runs from this date; re-runs repair.
        const r = await replayDay(date, groups, cache);
        console.log(`[${date}] groups=${groups.length} written=${r.written} unchanged=${r.unchanged} skippedNoCard=${r.skippedNoCard} skippedWrongGroup=${r.skippedWrongGroup} elapsed=${Math.round((Date.now() - started) / 60000)}m`);
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
