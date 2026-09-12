// Daily FX rates for the display-currency switcher.
//
// open.er-api.com's free tier: no API key, USD base, one request a day is plenty. Rates are stored,
// never fetched on a page load — a currency toggle must not put a third-party host on the critical
// path of rendering a collection.
//
// Only the currencies the switcher offers are kept. The feed carries 160-odd; storing the rest would
// be rows nothing can ever read.
import { db } from "@/lib/db";
import { CURRENCIES, type CurrencyCode } from "@/lib/currency";

const ENDPOINT = "https://open.er-api.com/v6/latest/USD";

interface FeedResponse {
  result?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

export interface FxResult {
  /** Rates written. Zero means the feed answered but carried nothing we offer. */
  written: number;
  /** The feed's own day, as YYYY-MM-DD. */
  date: string;
  skipped: string[];
}

/** The day the feed published, from its own timestamp rather than ours — a run just after midnight
 *  in one timezone should not label yesterday's rates with today's date. */
const feedDate = (unix: number | undefined): string =>
  new Date((unix ?? Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10);

export async function fetchRates(fetchImpl: typeof fetch = fetch): Promise<{ date: string; rates: Map<CurrencyCode, number> }> {
  const res = await fetchImpl(ENDPOINT);
  if (!res.ok) throw new Error(`fx: HTTP ${res.status}`);
  const body = (await res.json()) as FeedResponse;
  if (body.result && body.result !== "success") throw new Error(`fx: feed said "${body.result}"`);
  const feed = body.rates ?? {};

  const rates = new Map<CurrencyCode, number>();
  for (const { code } of CURRENCIES) {
    if (code === "USD") continue; // 1 by definition; storing it invites a row that disagrees
    const v = feed[code];
    // A zero or negative rate would pass a naive truthiness check and then divide the app by nothing.
    if (typeof v === "number" && Number.isFinite(v) && v > 0) rates.set(code, v);
  }
  return { date: feedDate(body.time_last_update_unix), rates };
}

/** Fetch and store. Rewrites every row it gets; a currency the feed drops keeps its last known rate
 *  rather than vanishing mid-session, and its stored date is what admits it is stale. */
export async function ingestRates(fetchImpl: typeof fetch = fetch): Promise<FxResult> {
  const { date, rates } = await fetchRates(fetchImpl);
  const c = await db();
  const offered = CURRENCIES.filter((x) => x.code !== "USD").map((x) => x.code);

  if (rates.size > 0) {
    await c.batch(
      [...rates].map(([code, rate]) => ({
        sql: `INSERT INTO fx_rates (code, rate, date) VALUES (?, ?, ?)
              ON CONFLICT(code) DO UPDATE SET rate = excluded.rate, date = excluded.date`,
        args: [code, rate, date],
      })),
      "write"
    );
  }
  return { written: rates.size, date, skipped: offered.filter((code) => !rates.has(code)) };
}
