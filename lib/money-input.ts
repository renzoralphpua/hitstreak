// The other half of the display-currency switcher: money coming IN.
//
// Rendering converts USD to the reader's currency. An input has to do the reverse, or the app
// silently records the wrong number — type 8500 while looking at pesos and it stores $8,500, which
// then renders back as ₱532,858. That is not a rounding problem, it is a factor of 62.
//
// The stored value is always USD, exactly as it is for prices from TCGplayer. Only the field the
// person types into speaks their currency.
import { currencyLocale, type Display } from "@/lib/currency";

/**
 * What a typed amount means in USD.
 *
 * Returns null for anything that is not a usable number, so a caller can tell "they left it blank"
 * from "they meant zero" — clearing a cost basis and recording a free card are different facts.
 */
export function toUsd(typed: string | number | null | undefined, display: Display): number | null {
  if (typed == null) return null;
  // Trim first: Number(" ") is 0, so a field holding only spaces would record a card as free.
  const raw = typeof typed === "number" ? typed : typed.trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // rate is guaranteed > 0 by lib/currency and the fx ingest, but a division by a bad rate would
  // produce Infinity and store it, so this refuses rather than trusts.
  if (!Number.isFinite(display.rate) || display.rate <= 0) return n;
  return n / display.rate;
}

/** How many decimal places this currency actually uses — 2 for most, 0 for JPY, KRW and IDR. */
function digits(display: Display): number {
  // `maximumFractionDigits` is optional in the resolved options type; every real implementation
  // supplies it for a currency format, and 2 is the right answer if one ever does not.
  return (
    new Intl.NumberFormat(currencyLocale(display.code), {
      style: "currency",
      currency: display.code,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/**
 * A stored USD amount as an input VALUE in the display currency.
 *
 * Plain digits, no symbol and no grouping separators: this fills a `type="number"` field, which
 * rejects "₱8,500.00" and would silently render empty. Rounded to the currency's own precision, so
 * editing a lot and saving it unchanged does not nudge the figure.
 */
export function fromUsd(usd: number | null | undefined, display: Display): string {
  if (usd == null || !Number.isFinite(usd)) return "";
  const converted = usd * display.rate;
  return converted.toFixed(digits(display));
}

/**
 * The currency to name on a money field's label, or null when there is nothing worth saying.
 *
 * Dollars are the default and labelling every field "(USD)" is noise; any other currency has to be
 * stated, because the number typed means something different depending on it.
 */
export const inputCurrency = (display: Display): string | null =>
  display.code === "USD" ? null : display.code;

/** A placeholder for a money field: the amount, in display currency, with no symbol or grouping. */
export const placeholderAmount = (usd: number | null | undefined, display: Display): string =>
  fromUsd(usd, display) || "0.00";
