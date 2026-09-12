// Display-currency conversion. Everything is stored in USD; this is the render-time multiply, and
// the cases that matter are the ones where a naive implementation quietly shows the wrong number.
import { describe, it, expect } from "vitest";
import { formatMoney, splitMoney, formatDelta, formatPercent } from "@/lib/format";
import { CURRENCIES, USD_DISPLAY, isCurrencyCode, currencyName, type Display } from "@/lib/currency";

const php: Display = { code: "PHP", rate: 62.689229, asOf: "2026-09-12" };
const jpy: Display = { code: "JPY", rate: 153.7596, asOf: "2026-09-12" };
const eur: Display = { code: "EUR", rate: 0.862019, asOf: "2026-09-12" };

describe("CURRENCIES", () => {
  it("offers the peso, which is the reason this exists", () => {
    expect(CURRENCIES.map((c) => c.code)).toContain("PHP");
    expect(currencyName("PHP")).toBe("Philippine Peso");
  });

  it("leads with the currency the data is actually stored in", () => {
    expect(CURRENCIES[0].code).toBe("USD");
  });

  it("lists every code exactly once", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("accepts only codes it offers", () => {
    expect(isCurrencyCode("PHP")).toBe(true);
    expect(isCurrencyCode("XYZ")).toBe(false);
    expect(isCurrencyCode("php")).toBe(false); // the cookie is not trusted to be normalised
    expect(isCurrencyCode(undefined)).toBe(false);
    expect(isCurrencyCode(42)).toBe(false);
  });
});

describe("formatMoney", () => {
  it("renders dollars when nobody has chosen", () => {
    expect(formatMoney(1465)).toBe("$1,465.00");
    expect(formatMoney(1465, { display: USD_DISPLAY })).toBe("$1,465.00");
  });

  it("multiplies by the rate and uses the target currency's own symbol", () => {
    const out = formatMoney(10, { display: php });
    expect(out).toContain("626.89");
    expect(out).toMatch(/₱|PHP/);
  });

  it("respects a currency with no minor unit", () => {
    // JPY has no sen. A formatter that assumed two decimals would invent them.
    const out = formatMoney(10, { display: jpy });
    expect(out).not.toContain(".");
    expect(out).toContain("1,538");
  });

  it("keeps the em dash for unknown, in every currency", () => {
    for (const d of [USD_DISPLAY, php, jpy]) {
      expect(formatMoney(null, { display: d })).toBe("—");
      expect(formatMoney(undefined, { display: d })).toBe("—");
      expect(formatMoney(Number.NaN, { display: d })).toBe("—");
      expect(formatMoney(Number.POSITIVE_INFINITY, { display: d })).toBe("—");
    }
  });

  it("drops the minor unit when compact, without throwing on a zero-decimal currency", () => {
    // `maximumFractionDigits: 0` alone throws for currencies whose minimum is 2 — the bug this guards.
    expect(formatMoney(1465.75, { compact: true })).toBe("$1,466");
    expect(() => formatMoney(1465.75, { compact: true, display: jpy })).not.toThrow();
    expect(formatMoney(1465.75, { compact: true, display: php })).not.toContain(".");
  });

  it("converts zero to zero rather than to nothing", () => {
    expect(formatMoney(0, { display: php })).toMatch(/0/);
  });
});

describe("splitMoney", () => {
  it("splits the minor unit off so it can be dimmed", () => {
    expect(splitMoney(1465.75)).toEqual({ whole: "$1,465", cents: ".75", rest: "" });
  });

  it("finds the separator the LOCALE uses, not a hard-coded dot", () => {
    // de-DE writes 1.262,86 — splitting on the last "." would cut into the thousands separator.
    const { whole, cents } = splitMoney(1465, eur);
    expect(cents).toMatch(/^,\d\d$/);
    expect(whole).not.toContain(",");
  });

  it("keeps a TRAILING currency symbol out of the part that gets dimmed", () => {
    // de-DE renders "1.262,86 €". Dimming from the comma to the end would dim the euro sign too.
    const { cents, rest } = splitMoney(1465, eur);
    expect(cents).not.toMatch(/€/);
    expect(rest).toContain("€");
  });

  it("puts the whole string in `whole` when the symbol leads", () => {
    const { whole, cents, rest } = splitMoney(1465.75, USD_DISPLAY);
    expect([whole, cents, rest]).toEqual(["$1,465", ".75", ""]);
  });

  it("returns no minor unit at all for a currency that has none", () => {
    const { whole, cents } = splitMoney(1465, jpy);
    expect(cents).toBe("");
    expect(whole).toContain("225");
  });
});

describe("formatDelta", () => {
  it("signs the converted amount with a true minus", () => {
    expect(formatDelta(-6.8)).toBe("−$6.80");
    expect(formatDelta(908.25)).toBe("+$908.25");
  });

  it("converts before signing, so the sign never lands on the dollar figure", () => {
    const out = formatDelta(-10, php);
    expect(out.startsWith("−")).toBe(true);
    expect(out).toContain("626.89");
  });
});

describe("formatPercent", () => {
  it("is currency-agnostic — a ratio does not convert", () => {
    expect(formatPercent(0.5)).toBe("+50.0%");
    expect(formatPercent(-0.125)).toBe("−12.5%");
    expect(formatPercent(0)).toBe("0.0%");
  });
});
