// Display currency. Everything in this app is stored in USD — TCGplayer prices arrive in dollars and
// cost basis is entered in dollars — and this converts at RENDER only.
//
// That is a deliberate limit, not an oversight. A figure shown in pesos is "what this is worth in
// pesos today", not what it was worth in pesos when you bought it: one rate is applied to every
// amount on the page, including historical ones. True multi-currency means recording the currency and
// the rate at the moment of each acquisition, which is a schema change and a different feature.
// Nothing here forecloses that; it just does not pretend to be it.

/** Offered in the switcher. Not the 160-odd the rate feed carries — the ones a collector plausibly
 *  thinks in, plus PHP. `locale` picks the grouping and symbol placement each one expects. */
export const CURRENCIES = [
  { code: "USD", name: "US Dollar", locale: "en-US" },
  { code: "PHP", name: "Philippine Peso", locale: "en-PH" },
  { code: "EUR", name: "Euro", locale: "de-DE" },
  { code: "GBP", name: "British Pound", locale: "en-GB" },
  { code: "JPY", name: "Japanese Yen", locale: "ja-JP" },
  { code: "CAD", name: "Canadian Dollar", locale: "en-CA" },
  { code: "AUD", name: "Australian Dollar", locale: "en-AU" },
  { code: "SGD", name: "Singapore Dollar", locale: "en-SG" },
  { code: "HKD", name: "Hong Kong Dollar", locale: "en-HK" },
  { code: "TWD", name: "New Taiwan Dollar", locale: "zh-TW" },
  { code: "KRW", name: "South Korean Won", locale: "ko-KR" },
  { code: "CNY", name: "Chinese Yuan", locale: "zh-CN" },
  { code: "MYR", name: "Malaysian Ringgit", locale: "ms-MY" },
  { code: "THB", name: "Thai Baht", locale: "th-TH" },
  { code: "IDR", name: "Indonesian Rupiah", locale: "id-ID" },
  { code: "INR", name: "Indian Rupee", locale: "en-IN" },
  { code: "NZD", name: "New Zealand Dollar", locale: "en-NZ" },
  { code: "CHF", name: "Swiss Franc", locale: "de-CH" },
  { code: "MXN", name: "Mexican Peso", locale: "es-MX" },
  { code: "BRL", name: "Brazilian Real", locale: "pt-BR" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** The currency to render in, and how many of it one US dollar buys. */
export interface Display {
  code: CurrencyCode;
  /** Units per 1 USD. Always 1 for USD, which is why the default needs no rate feed. */
  rate: number;
  /** The rate's own day, so the UI can admit how fresh it is. Null when the feed has never run. */
  asOf: string | null;
}

/** What money looks like before anyone has chosen otherwise, and the fallback whenever a rate is
 *  missing — showing a converted figure at a guessed rate would be worse than showing dollars. */
export const USD_DISPLAY: Display = { code: "USD", rate: 1, asOf: null };

export const isCurrencyCode = (v: unknown): v is CurrencyCode =>
  typeof v === "string" && BY_CODE.has(v as CurrencyCode);

export const currencyName = (code: CurrencyCode): string => BY_CODE.get(code)?.name ?? code;
export const currencyLocale = (code: CurrencyCode): string => BY_CODE.get(code)?.locale ?? "en-US";

/** The cookie, not localStorage: a server component must be able to read this to render the first
 *  paint in the right currency, and localStorage does not reach the server. */
export const CURRENCY_COOKIE = "hitstreak.currency";
