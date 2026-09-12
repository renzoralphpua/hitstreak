// Server-only by construction: `next/headers` throws anywhere a request is not in scope, so a
// client component importing this fails loudly rather than silently rendering the wrong currency.
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { CURRENCY_COOKIE, isCurrencyCode, USD_DISPLAY, type CurrencyCode, type Display } from "@/lib/currency";

/**
 * The currency this request should render in.
 *
 * Server-side so the FIRST paint is already in the reader's currency — a page that renders dollars
 * and then swaps to pesos on hydration is a worse experience than one that never offered the choice.
 * `cache()` makes it one cookie read and one query per request no matter how many components ask.
 *
 * Falls back to dollars whenever anything is missing or unreadable: an unknown code, a currency with
 * no stored rate, a rate feed that has never run. Showing a converted figure at a guessed rate would
 * be worse than showing the currency the data is actually in.
 */
export const getDisplay = cache(async (): Promise<Display> => {
  const raw = await currencyCookie();
  if (!isCurrencyCode(raw) || raw === "USD") return USD_DISPLAY;
  return rateFor(raw);
});

/** `cookies()` throws outside a request scope — a component rendered in a test, or anywhere there is
 *  no reader to have a preference. That is not an error condition; it is "nobody chose", which is
 *  dollars. */
async function currencyCookie(): Promise<string | undefined> {
  try {
    return (await cookies()).get(CURRENCY_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

async function rateFor(code: CurrencyCode): Promise<Display> {
  try {
    const c = await db();
    const row = (await c.execute({ sql: "SELECT rate, date FROM fx_rates WHERE code = ?", args: [code] })).rows[0];
    if (!row || row.rate == null) return USD_DISPLAY;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) return USD_DISPLAY;
    return { code, rate, asOf: String(row.date) };
  } catch {
    // A money figure is not worth failing a page render over.
    return USD_DISPLAY;
  }
}

/** Every currency we hold a rate for, so the switcher can say which ones are actually available. */
export async function availableRates(): Promise<Map<CurrencyCode, { rate: number; date: string }>> {
  const out = new Map<CurrencyCode, { rate: number; date: string }>();
  try {
    const c = await db();
    for (const r of (await c.execute("SELECT code, rate, date FROM fx_rates")).rows) {
      const code = String(r.code);
      if (isCurrencyCode(code)) out.set(code, { rate: Number(r.rate), date: String(r.date) });
    }
  } catch {
    // An empty map means "only dollars", which the switcher renders honestly.
  }
  return out;
}
