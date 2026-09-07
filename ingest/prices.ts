// Write-on-change price ingestion, order-independent.
//
// SEMANTICS
// - `price_snapshots` holds one row per printing per day the price tuple
//   (market, low, mid, high) CHANGED relative to the most recent snapshot
//   strictly before that day, plus the first observation. Readers carry each
//   row forward until the next one.
// - `latest_prices.date` is LAST SEEN (advanced on every appearance);
//   `MAX(price_snapshots.date)` is LAST CHANGED. A printing missing from a
//   day's feed keeps its carried value; its `latest_prices.date` stops
//   advancing, so the UI should show "as of <date>" when stale.
// - Tuples may be all-null (no listings). Valuations must treat a null market
//   as unpriceable, not zero.
// - INVARIANT: the `latest_prices` tuple always equals the most recent
//   snapshot's tuple. That is what lets the daily path and the oldest-first
//   backfill path read `latest_prices` as the diff base instead of scanning
//   history; only an out-of-order replay (`latest.date >= date`) pays for a
//   MAX-date scan.
//   The guarded `latest_prices` upsert alone does NOT hold that invariant up:
//   its `excluded.date >= latest_prices.date` guard (which exists so a slow
//   older write can never clobber a newer one) also refuses the tuple when
//   `latest.date > date`. Replaying a day inside the unchanged tail — i.e.
//   `date >= MAX(price_snapshots.date)` — rewrites or deletes the very newest
//   snapshot, so the refused tuple would be a stale one and the next day's
//   `prev` would be wrong (a fabricated change row, or a wrong current price).
//   So the out-of-order path also scans each printing's MAX snapshot date and,
//   when `date >= MAX`, repairs the tuple with an UPDATE — guarded against a
//   concurrently newer snapshot (see below) — that leaves `latest_prices.date`
//   (LAST SEEN) alone. When `date < MAX` the newest snapshot is untouched and
//   no repair is needed.
// - Re-runs are idempotent AND canonicalizing: replaying a day with corrected
//   data overwrites a wrong row, and DELETES a row that the correction makes
//   redundant (equal to the preceding snapshot). Without that delete, a bad
//   feed would leave an orphan spike in history that `latest_prices` denies.
//   Canonicalization is per-replayed-day only: it compares the replayed day
//   against the snapshot BEFORE it, never against the one after. So replaying
//   an older day with a corrected tuple can leave the FOLLOWING snapshot row
//   redundant (a 0-delta row). That is harmless for carry-forward reads, but
//   movers/streak queries derived from snapshot rows must tolerate 0-delta
//   rows rather than assume every row is a real change.
// - Statement chunks commit independently; a throw leaves earlier chunks
//   applied. That is safe because re-runs repair — but callers must not mark a
//   day complete on a throw.
//
// All date comparisons here are lexicographic on YYYY-MM-DD, which is why
// `date` is validated up front.
import { db } from "@/lib/db";
import type { Client } from "@libsql/client";
import type { TcgcsvPrice } from "./tcgcsv";

export interface IngestPriceResult {
  written: number; // snapshot upserts issued for this date (not necessarily new rows)
  unchanged: number; // tuple equal to the prior snapshot → no snapshot row for this date
  skippedNoCard: number; // productIds absent from the catalog entirely
  skippedWrongGroup: number; // productIds that exist in the catalog under a DIFFERENT group (catalog drift)
}

export interface GroupIndex {
  cardByProduct: Map<number, number>; // tcgplayer productId -> cards.id, for this group
  printingId: Map<string, number>; // `${productId}|${subtype}` -> printings.id, for this group
}

type Tuple = { market: number | null; low: number | null; mid: number | null; high: number | null };
type Stmt = { sql: string; args: (string | number | null)[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STMT_CHUNK = 200; // statements per write batch
const IN_CHUNK = 500; // bound parameters per IN (...) list

// A numeric string from the feed must never defeat === equality silently.
// A blank/whitespace string means "unpriceable", not zero — Number("") === 0
// would otherwise turn a missing price into a real (and wrong) price of 0.
// `bigint` shows up because libsql hands back integer columns as bigint, and a
// bigint never === a number, which would fake a change on every read-back.
const norm = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const sameTuple = (a: Tuple, b: Tuple) =>
  a.market === b.market && a.low === b.low && a.mid === b.mid && a.high === b.high;

// Routed through `norm` so a DB value is normalized exactly like a feed value —
// otherwise the two sides of `sameTuple` would not be comparable.
const tupleOf = (r: Record<string, unknown>): Tuple => ({
  market: norm(r.market),
  low: norm(r.low),
  mid: norm(r.mid),
  high: norm(r.high),
});

// The regex alone accepts 2026-13-45. The UTC round-trip also rejects any date
// the calendar does not have, so lexicographic comparison never sorts a
// nonsense date into the middle of a real timeline.
const isCalendarDate = (date: string): boolean => {
  if (!DATE_RE.test(date)) return false;
  const t = Date.parse(date + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date;
};

const keyOf = (productId: number, subtype: string) => `${productId}|${subtype}`;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (n: number) => new Array(n).fill("?").join(", ");

async function loadCardsInto(c: Client, groupId: number, into: Map<number, number>): Promise<void> {
  const rows = (await c.execute({
    sql: `SELECT cards.id AS id, cards.tcgplayer_product_id AS pid
          FROM cards JOIN sets ON sets.id = cards.set_id
          WHERE sets.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  into.clear();
  for (const r of rows) into.set(Number(r.pid), Number(r.id));
}

async function loadPrintingsInto(c: Client, groupId: number, into: Map<string, number>): Promise<void> {
  const rows = (await c.execute({
    sql: `SELECT printings.id AS id, cards.tcgplayer_product_id AS pid, printings.subtype AS subtype
          FROM printings
          JOIN cards ON cards.id = printings.card_id
          JOIN sets ON sets.id = cards.set_id
          WHERE sets.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  into.clear();
  for (const r of rows) into.set(keyOf(Number(r.pid), String(r.subtype)), Number(r.id));
}

/**
 * Catalog lookups for one group. The backfill hoists this out of its 900-day
 * loop and passes the same object back into every `ingestPrices` call.
 */
export async function resolveGroupIndex(groupId: number): Promise<GroupIndex> {
  const c = await db();
  const cardByProduct = new Map<number, number>();
  await loadCardsInto(c, groupId, cardByProduct);

  const printingId = new Map<string, number>();
  await loadPrintingsInto(c, groupId, printingId);
  return { cardByProduct, printingId };
}

export async function ingestPrices(
  groupId: number,
  prices: TcgcsvPrice[],
  date: string, // YYYY-MM-DD (UTC)
  index?: GroupIndex
): Promise<IngestPriceResult> {
  if (!isCalendarDate(date)) throw new Error(`ingestPrices: date must be YYYY-MM-DD, got ${date}`);

  const result: IngestPriceResult = { written: 0, unchanged: 0, skippedNoCard: 0, skippedWrongGroup: 0 };
  if (prices.length === 0) return result;

  // Dedupe before any counting: a feed can repeat a (product, subtype) pair, and
  // two statements for the same row in one batch would double-count `written`.
  const byKey = new Map<string, TcgcsvPrice>();
  for (const p of prices) byKey.set(keyOf(p.productId, p.subTypeName), p); // last wins
  const deduped = [...byKey.values()];

  const c = await db();
  // When the caller hoisted an index we mutate it in place, so its cache stays valid.
  const idx = index ?? (await resolveGroupIndex(groupId));

  const wanted: TcgcsvPrice[] = [];
  const skipped: TcgcsvPrice[] = [];
  const partition = () => {
    wanted.length = 0;
    skipped.length = 0;
    for (const p of deduped) (idx.cardByProduct.has(p.productId) ? wanted : skipped).push(p);
  };
  partition();

  // A hoisted index caches `cardByProduct` from whenever it was built, so a card
  // added to THIS group afterwards would look like catalog drift. Before we
  // conclude anything is skippable, reload the group's cards into the index
  // (mutating it, like the printings reload) and re-partition. This reload runs
  // on every call where anything is skipped; it is cheap because skips are rare
  // when the catalog includes every product in the feed.
  if (skipped.length > 0) {
    await loadCardsInto(c, groupId, idx.cardByProduct);
    partition();
  }

  // Classify skips: a product that exists under a different group is catalog
  // drift (actionable) rather than an unknown product (routine).
  if (skipped.length > 0) {
    const unknownIds = [...new Set(skipped.map((p) => p.productId))];
    const elsewhere = new Set<number>();
    for (const ids of chunks(unknownIds, IN_CHUNK)) {
      const rows = (await c.execute({
        sql: `SELECT tcgplayer_product_id AS pid FROM cards WHERE tcgplayer_product_id IN (${placeholders(ids.length)})`,
        args: ids,
      })).rows;
      for (const r of rows) elsewhere.add(Number(r.pid));
    }
    for (const p of skipped) {
      if (elsewhere.has(p.productId)) result.skippedWrongGroup++;
      else result.skippedNoCard++;
    }
  }
  if (wanted.length === 0) return result;

  // Create only the printings the index does not already know about; the steady
  // state is zero inserts, so no per-row INSERT … ON CONFLICT on every run.
  const missing = wanted.filter((p) => !idx.printingId.has(keyOf(p.productId, p.subTypeName)));
  if (missing.length > 0) {
    for (const part of chunks(missing, STMT_CHUNK)) {
      await c.batch(
        part.map((p) => ({
          sql: "INSERT INTO printings (card_id, subtype) VALUES (?, ?) ON CONFLICT(card_id, subtype) DO NOTHING",
          args: [idx.cardByProduct.get(p.productId)!, p.subTypeName],
        })),
        "write"
      );
    }
    await loadPrintingsInto(c, groupId, idx.printingId);
  }

  const targets: { id: number; next: Tuple }[] = [];
  for (const p of wanted) {
    const id = idx.printingId.get(keyOf(p.productId, p.subTypeName));
    if (id === undefined) continue; // defensive; the insert above guarantees existence
    targets.push({
      id,
      next: {
        market: norm(p.marketPrice),
        low: norm(p.lowPrice),
        mid: norm(p.midPrice),
        high: norm(p.highPrice),
      },
    });
  }
  if (targets.length === 0) return result;

  // One query for the whole group's current prices. By the invariant, a latest
  // row dated before `date` IS the most recent snapshot before `date`.
  const latestRows = (await c.execute({
    sql: `SELECT lp.printing_id AS printing_id, lp.date AS date, lp.market, lp.low, lp.mid, lp.high
          FROM latest_prices lp
          JOIN printings p ON p.id = lp.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          WHERE se.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  const latest = new Map<number, { date: string; tuple: Tuple }>();
  for (const r of latestRows) latest.set(Number(r.printing_id), { date: String(r.date), tuple: tupleOf(r) });

  const prevByPrinting = new Map<number, Tuple>();
  const needScan: number[] = [];
  for (const t of targets) {
    const l = latest.get(t.id);
    if (l === undefined) continue; // no history at all → prev stays undefined
    if (l.date < date) prevByPrinting.set(t.id, l.tuple);
    else needScan.push(t.id); // out-of-order replay: latest is at or after `date`
  }

  // Only the replayed printings pay for a history scan: the tuple immediately
  // before `date` (the diff base) and the newest snapshot date over ALL dates
  // (which says whether this replay lands on the newest snapshot — see the
  // invariant note in the header).
  const outOfOrder = new Set(needScan);
  const maxSnapshotDate = new Map<number, string>();
  for (const ids of chunks(needScan, IN_CHUNK)) {
    const rows = (await c.execute({
      sql: `SELECT ps.printing_id AS printing_id, ps.market, ps.low, ps.mid, ps.high
            FROM price_snapshots ps
            JOIN (
              SELECT s.printing_id AS printing_id, MAX(s.date) AS d
              FROM price_snapshots s
              WHERE s.printing_id IN (${placeholders(ids.length)}) AND s.date < ?
              GROUP BY s.printing_id
            ) m ON m.printing_id = ps.printing_id AND m.d = ps.date`,
      args: [...ids, date],
    })).rows;
    for (const r of rows) prevByPrinting.set(Number(r.printing_id), tupleOf(r));

    const maxRows = (await c.execute({
      sql: `SELECT printing_id, MAX(date) AS d FROM price_snapshots
            WHERE printing_id IN (${placeholders(ids.length)})
            GROUP BY printing_id`,
      args: ids,
    })).rows;
    for (const r of maxRows) {
      if (r.d != null) maxSnapshotDate.set(Number(r.printing_id), String(r.d));
    }
  }

  // Which printings already have a row AT `date` — a re-run must be able to
  // delete one that the corrected tuple makes redundant.
  const existsAtDate = new Set<number>();
  for (const r of (await c.execute({
    sql: `SELECT ps.printing_id AS printing_id
          FROM price_snapshots ps
          JOIN printings p ON p.id = ps.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          WHERE se.tcgplayer_group_id = ? AND ps.date = ?`,
    args: [groupId, date],
  })).rows) {
    existsAtDate.add(Number(r.printing_id));
  }

  // One unit per printing so a printing's statements never straddle a chunk
  // boundary (chunks commit independently).
  const units: Stmt[][] = [];
  for (const { id, next } of targets) {
    const unit: Stmt[] = [];
    const prev = prevByPrinting.get(id);
    const tupleArgs = [id, date, next.market, next.low, next.mid, next.high];
    let wroteSnapshot: boolean;

    if (prev !== undefined && sameTuple(prev, next)) {
      wroteSnapshot = false;
      result.unchanged++;
      if (existsAtDate.has(id)) {
        // Canonicalize: this day carried a value the correction says never changed.
        unit.push({ sql: "DELETE FROM price_snapshots WHERE printing_id = ? AND date = ?", args: [id, date] });
      }
    } else {
      wroteSnapshot = true;
      result.written++;
      unit.push({
        sql: `INSERT INTO price_snapshots (printing_id, date, market, low, mid, high)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(printing_id, date) DO UPDATE SET
                market = excluded.market, low = excluded.low, mid = excluded.mid, high = excluded.high`,
        args: tupleArgs,
      });
    }

    // Always offered; the guard is in SQL so a concurrent newer write can never
    // be clobbered by a slow older one.
    unit.push({
      sql: `INSERT INTO latest_prices (printing_id, date, market, low, mid, high)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(printing_id) DO UPDATE SET
              date = excluded.date, market = excluded.market, low = excluded.low,
              mid = excluded.mid, high = excluded.high
            WHERE excluded.date >= latest_prices.date`,
      args: tupleArgs,
    });

    // On the out-of-order path the guard above may have refused the tuple
    // (`latest.date > date`) even though this call just changed the NEWEST
    // snapshot. Repair the tuple — never the date — so the invariant holds.
    // The repair's own SQL guard (NOT EXISTS a newer snapshot) closes the
    // read-then-write race with a concurrent in-order run: if another run
    // commits a newer snapshot for this printing between our MAX(date) read
    // above and this batch's commit, the repair becomes a no-op instead of
    // overwriting that newer tuple.
    if (outOfOrder.has(id)) {
      const maxDate = maxSnapshotDate.get(id);
      // `date >= maxDate` (or no snapshots at all) means the row we just wrote
      // or deleted was the newest one; anything older leaves the newest intact.
      if (maxDate === undefined || date >= maxDate) {
        // After this unit, the newest snapshot is the one we wrote, or — if we
        // wrote nothing (and possibly deleted this day's row) — `prev`.
        // `unchanged` implies `prev` is defined, so this is never undefined.
        const newest = wroteSnapshot ? next : prev;
        if (newest !== undefined) {
          unit.push({
            sql: `UPDATE latest_prices SET market = ?, low = ?, mid = ?, high = ?
                  WHERE printing_id = ?
                    AND NOT EXISTS (
                      SELECT 1 FROM price_snapshots
                      WHERE printing_id = latest_prices.printing_id AND date > ?
                    )`,
            args: [newest.market, newest.low, newest.mid, newest.high, id, date],
          });
        }
      }
    }
    units.push(unit);
  }

  let batch: Stmt[] = [];
  for (const unit of units) {
    if (batch.length > 0 && batch.length + unit.length > STMT_CHUNK) {
      await c.batch(batch, "write");
      batch = [];
    }
    batch.push(...unit);
  }
  if (batch.length > 0) await c.batch(batch, "write");

  return result;
}
