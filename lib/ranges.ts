// lib/ranges.ts
// The db-free half of lib/history: the chart range vocabulary and the pure series helpers.
// RangePills and LineChart import from HERE, not lib/history — components/ui is re-exported into
// "use client" modules, and lib/history imports lib/db (→ @libsql/client), which must stay out of the
// client module graph. Nothing in this file may import lib/db (tests/ranges.test.ts enforces it).

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
