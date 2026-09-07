// lib/history.ts
// Read side of price/value history for charts. price_snapshots is write-on-change (a row exists
// only on days the price CHANGED), so a series over [from, to] is the carry-in point — the latest
// snapshot at or before `from`, re-dated to `from` — plus every change inside the window. Readers
// step each value forward to the next point (LineChart draws a step line).
import { db } from "@/lib/db";

export const RANGES = ["7d", "30d", "90d", "1y", "all"] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_LABEL: Record<Range, string> = { "7d": "7D", "30d": "30D", "90d": "90D", "1y": "1Y", all: "All" };
/** Prose form for PriceDelta captions and chart labels ("past All" is not a phrase). */
export const RANGE_CAPTION: Record<Range, string> = { "7d": "past 7 days", "30d": "past 30 days", "90d": "past 90 days", "1y": "past year", all: "all time" };
export const DEFAULT_RANGE: Range = "30d";
/** First day of the tcgcsv archive — nothing older can exist. */
export const HISTORY_EPOCH = "2024-02-08";

const RANGE_DAYS: Record<Exclude<Range, "all">, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** A `?range=` value, or the default for anything else (arrays, junk, missing). */
export function parseRange(raw: unknown): Range {
  return typeof raw === "string" && (RANGES as readonly string[]).includes(raw) ? (raw as Range) : DEFAULT_RANGE;
}

/** Inclusive start date (YYYY-MM-DD, UTC arithmetic) for a range ending on `to`. */
export function rangeStart(range: Range, to: string): string {
  if (range === "all") return HISTORY_EPOCH;
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - RANGE_DAYS[range]);
  return d.toISOString().slice(0, 10);
}

export interface Point { date: string; value: number | null }

/** Where the chart's x-axis starts. Fixed ranges use the range start; "All" starts at the first
 *  point — portfolio_history begins the first night the nightly runs and a printing's snapshots
 *  begin at its release — so the data fills the width instead of huddling at the right edge of a
 *  2024→today axis. `today` covers an empty series. */
export function chartFrom(range: Range, from: string, points: Point[], today: string): string {
  return range === "all" ? (points[0]?.date ?? today) : from;
}

/** `points` plus tonight's live value as a final `today` point, unless the nightly has already
 *  written today's row (a brand-new binder has no materialized rows yet but should still chart). */
export function withLivePoint(points: Point[], today: string, value: number): Point[] {
  const last = points[points.length - 1];
  return last && last.date >= today ? points : [...points, { date: today, value }];
}

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

/** Nightly-materialized binder value (one row per day). Ownership is checked through
 *  portfolios.user_id like every other portfolio read; the share page passes the owner's id. */
export async function getPortfolioHistory(userId: string, portfolioId: number, from: string, to: string): Promise<Point[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT ph.date, ph.total_value FROM portfolio_history ph
          JOIN portfolios po ON po.id = ph.portfolio_id AND po.user_id = ?
          WHERE ph.portfolio_id = ? AND ph.date >= ? AND ph.date <= ? ORDER BY ph.date`,
    args: [userId, portfolioId, from, to],
  });
  return r.rows.map((x) => ({ date: String(x.date), value: Number(x.total_value) }));
}

export interface SeriesStats { low: number; high: number; first: number; last: number; change: { amount: number; ratio: number | null } | null }

/** Low/high/first/last over the non-null values; `change` is last − first (null with one point,
 *  ratio null when first is 0). `null` when nothing is priced. */
export function seriesStats(points: Point[]): SeriesStats | null {
  const v = points.map((p) => p.value).filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  const first = v[0], last = v[v.length - 1];
  const change = v.length < 2 ? null : { amount: last - first, ratio: first === 0 ? null : (last - first) / first };
  return { low: Math.min(...v), high: Math.max(...v), first, last, change };
}
