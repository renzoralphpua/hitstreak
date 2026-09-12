// Money is stored as REAL US dollars and rounded at display (spec §5). Uses a true minus sign (U+2212).
//
// A `display` converts at render — see lib/currency.ts for why that is display-only. Omitting it
// means dollars, which is what every non-UI caller (alert emails, tests) wants.
import { currencyLocale, USD_DISPLAY, type Display } from "@/lib/currency";

type Opts = { compact?: boolean; display?: Display };

// Intl.NumberFormat is expensive to construct and these are hit on every row of a 200-card grid.
const cache = new Map<string, Intl.NumberFormat>();
function nf(display: Display, compact: boolean): Intl.NumberFormat {
  const key = `${display.code}:${compact}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(currencyLocale(display.code), {
      style: "currency",
      currency: display.code,
      // `maximumFractionDigits: 0` alone throws when it lands below the currency's own minimum, so
      // the minimum has to come down with it. JPY, KRW and IDR have no minor unit and ignore both.
      ...(compact ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    });
    cache.set(key, f);
  }
  return f;
}

const convert = (v: number, display: Display) => v * display.rate;

export function formatMoney(v: number | null | undefined, opts: Opts = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const display = opts.display ?? USD_DISPLAY;
  return nf(display, opts.compact === true).format(convert(v, display));
}

/**
 * The Collection money style splits the minor unit off so it can be dimmed.
 *
 * Built from `formatToParts`, not by searching for a ".", because these locales disagree about
 * everything that matters here: half use a comma as the decimal separator, and several put the
 * symbol AFTER the number — de-DE renders `1.262,86 €`, where slicing from the separator to the end
 * would dim the euro sign along with the cents. Hence `rest`, which is whatever trails the fraction.
 *
 * A currency with no minor unit (JPY, KRW, IDR) has no split to make: `cents` comes back empty and
 * the caller renders nothing extra.
 */
export function splitMoney(
  v: number,
  display: Display = USD_DISPLAY
): { whole: string; cents: string; rest: string } {
  const parts = nf(display, false).formatToParts(convert(v, display));
  const at = parts.findIndex((p) => p.type === "fraction");
  const join = (from: number, to?: number) => parts.slice(from, to).map((p) => p.value).join("");
  if (at === -1) return { whole: join(0), cents: "", rest: "" };
  // The decimal separator belongs with the fraction — it is part of what gets dimmed.
  const decimalAt = parts[at - 1]?.type === "decimal" ? at - 1 : at;
  return { whole: join(0, decimalAt), cents: join(decimalAt, at + 1), rest: join(at + 1) };
}

export function formatPercent(ratio: number): string {
  const pct = (Math.abs(ratio) * 100).toFixed(1);
  if (pct === "0.0") return "0.0%";
  if (ratio > 0) return `+${pct}%`;
  if (ratio < 0) return `−${pct}%`;
  return `${pct}%`;
}

export function formatDelta(v: number, display: Display = USD_DISPLAY): string {
  const abs = nf(display, false).format(Math.abs(convert(v, display)));
  return v < 0 ? `−${abs}` : `+${abs}`;
}
