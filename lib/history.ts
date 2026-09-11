// lib/history.ts
// Read side of price/value history for charts. price_snapshots is write-on-change (a row exists
// only on days the price CHANGED), so a series over [from, to] is the carry-in point — the latest
// snapshot at or before `from`, re-dated to `from` — plus every change inside the window. Readers
// step each value forward to the next point (LineChart draws a step line).
// The range vocabulary and the pure series helpers live in lib/ranges.ts (db-free, so the chart
// primitives can import them from client-reachable code) and are re-exported here for the pages.
import { db } from "@/lib/db";
import type { Point } from "./ranges";

export * from "./ranges";

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export async function getPrintingHistory(printingId: number, from: string, to: string): Promise<Point[]> {
  const c = await db();
  const [carryIn, inside] = await Promise.all([
    c.execute({ sql: "SELECT market FROM price_snapshots WHERE printing_id = ? AND date <= ? ORDER BY date DESC LIMIT 1", args: [printingId, from] }),
    c.execute({ sql: "SELECT date, market FROM price_snapshots WHERE printing_id = ? AND date > ? AND date <= ? ORDER BY date", args: [printingId, from, to] }),
  ]);
  const points: Point[] = [];
  if (carryIn.rows.length > 0) points.push({ date: from, value: num(carryIn.rows[0].market) });
  for (const r of inside.rows) points.push({ date: String(r.date), value: num(r.market) });
  return points;
}

/** Nightly-materialized collection value (one row per day). Ownership is checked through
 *  collections.user_id like every other collection read; the share page passes the owner's id. */
export async function getCollectionHistory(userId: string, collectionId: number, from: string, to: string): Promise<Point[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT ph.date, ph.total_value FROM collection_history ph
          JOIN collections po ON po.id = ph.collection_id AND po.user_id = ?
          WHERE ph.collection_id = ? AND ph.date >= ? AND ph.date <= ? ORDER BY ph.date`,
    args: [userId, collectionId, from, to],
  });
  return r.rows.map((x) => ({ date: String(x.date), value: Number(x.total_value) }));
}
