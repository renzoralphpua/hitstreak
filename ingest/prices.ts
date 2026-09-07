// Write-on-change price ingestion, order-independent: for date D a snapshot is
// written only when the tuple differs from the most recent snapshot dated
// BEFORE D. latest_prices is only advanced when D >= its current date, so the
// daily job and the historical backfill can run in any order.
import { db } from "@/lib/db";
import type { TcgcsvPrice } from "./tcgcsv";

export interface IngestPriceResult {
  written: number;
  unchanged: number;
  skippedNoCard: number;
}

type Tuple = { market: number | null; low: number | null; mid: number | null; high: number | null };

const norm = (v: number | null | undefined): number | null => (v == null ? null : v);
const sameTuple = (a: Tuple, b: Tuple) =>
  a.market === b.market && a.low === b.low && a.mid === b.mid && a.high === b.high;
const tupleOf = (r: Record<string, unknown>): Tuple => ({
  market: r.market as number | null,
  low: r.low as number | null,
  mid: r.mid as number | null,
  high: r.high as number | null,
});

const CHUNK = 200;

export async function ingestPrices(
  groupId: number,
  prices: TcgcsvPrice[],
  date: string // YYYY-MM-DD (UTC)
): Promise<IngestPriceResult> {
  const c = await db();
  const result: IngestPriceResult = { written: 0, unchanged: 0, skippedNoCard: 0 };
  if (prices.length === 0) return result;

  // 1. productId -> card id for this group.
  const cardRows = (await c.execute({
    sql: `SELECT cards.id AS id, cards.tcgplayer_product_id AS pid
          FROM cards JOIN sets ON sets.id = cards.set_id
          WHERE sets.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  const cardByProduct = new Map<number, number>();
  for (const r of cardRows) cardByProduct.set(Number(r.pid), Number(r.id));

  const wanted = prices.filter((p) => cardByProduct.has(p.productId));
  result.skippedNoCard = prices.length - wanted.length;
  if (wanted.length === 0) return result;

  // 2. Ensure printings exist for every (card, subtype) we have a price for.
  for (let i = 0; i < wanted.length; i += CHUNK) {
    await c.batch(
      wanted.slice(i, i + CHUNK).map((p) => ({
        sql: "INSERT INTO printings (card_id, subtype) VALUES (?, ?) ON CONFLICT(card_id, subtype) DO NOTHING",
        args: [cardByProduct.get(p.productId)!, p.subTypeName],
      })),
      "write"
    );
  }

  // 3. printing ids for this group, keyed by "productId|subtype".
  const printingRows = (await c.execute({
    sql: `SELECT printings.id AS id, cards.tcgplayer_product_id AS pid, printings.subtype AS subtype
          FROM printings
          JOIN cards ON cards.id = printings.card_id
          JOIN sets ON sets.id = cards.set_id
          WHERE sets.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  const printingId = new Map<string, number>();
  for (const r of printingRows) printingId.set(`${r.pid}|${r.subtype}`, Number(r.id));

  // 4. For each printing in this group: the most recent snapshot strictly BEFORE `date`.
  const prevRows = (await c.execute({
    sql: `SELECT ps.printing_id AS printing_id, ps.market, ps.low, ps.mid, ps.high
          FROM price_snapshots ps
          JOIN (
            SELECT s.printing_id, MAX(s.date) AS d
            FROM price_snapshots s
            JOIN printings p ON p.id = s.printing_id
            JOIN cards ca ON ca.id = p.card_id
            JOIN sets se ON se.id = ca.set_id
            WHERE se.tcgplayer_group_id = ? AND s.date < ?
            GROUP BY s.printing_id
          ) m ON m.printing_id = ps.printing_id AND m.d = ps.date`,
    args: [groupId, date],
  })).rows;
  const prevByPrinting = new Map<number, Tuple>();
  for (const r of prevRows) prevByPrinting.set(Number(r.printing_id), tupleOf(r));

  // 5. Current latest date per printing (to decide whether `date` advances it).
  const latestRows = (await c.execute({
    sql: `SELECT lp.printing_id AS printing_id, lp.date AS date
          FROM latest_prices lp
          JOIN printings p ON p.id = lp.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          WHERE se.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  const latestDate = new Map<number, string>();
  for (const r of latestRows) latestDate.set(Number(r.printing_id), String(r.date));

  // 6. Diff and build statements.
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  for (const p of wanted) {
    const id = printingId.get(`${p.productId}|${p.subTypeName}`);
    if (id === undefined) continue; // defensive; step 2 guarantees existence
    const next: Tuple = { market: norm(p.marketPrice), low: norm(p.lowPrice), mid: norm(p.midPrice), high: norm(p.highPrice) };
    const prev = prevByPrinting.get(id);
    const advancesLatest = !latestDate.has(id) || date >= latestDate.get(id)!;

    if (prev && sameTuple(prev, next)) {
      result.unchanged++;
    } else {
      result.written++;
      stmts.push({
        sql: `INSERT INTO price_snapshots (printing_id, date, market, low, mid, high)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(printing_id, date) DO UPDATE SET
                market = excluded.market, low = excluded.low, mid = excluded.mid, high = excluded.high`,
        args: [id, date, next.market, next.low, next.mid, next.high],
      });
    }

    if (advancesLatest) {
      stmts.push({
        sql: `INSERT INTO latest_prices (printing_id, date, market, low, mid, high)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(printing_id) DO UPDATE SET
                date = excluded.date, market = excluded.market, low = excluded.low,
                mid = excluded.mid, high = excluded.high`,
        args: [id, date, next.market, next.low, next.mid, next.high],
      });
    }
  }

  for (let i = 0; i < stmts.length; i += CHUNK) {
    await c.batch(stmts.slice(i, i + CHUNK), "write");
  }
  return result;
}
