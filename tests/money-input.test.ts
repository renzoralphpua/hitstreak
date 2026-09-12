// Money coming IN. This exists because the display switcher shipped converting only money going
// OUT: an Akali bought for ₱8,500 was stored as $8,500 and rendered back as ₱532,858. Every case
// here is the round trip that should have been there from the start.
import { describe, it, expect } from "vitest";
import { toUsd, fromUsd, inputCurrency, placeholderAmount } from "@/lib/money-input";
import { USD_DISPLAY, type Display } from "@/lib/currency";

const php: Display = { code: "PHP", rate: 62.689229, asOf: "2026-09-12" };
const jpy: Display = { code: "JPY", rate: 153.7596, asOf: "2026-09-12" };

describe("toUsd", () => {
  it("stores what was typed when the display is dollars", () => {
    expect(toUsd("8500", USD_DISPLAY)).toBe(8500);
    expect(toUsd(135.59, USD_DISPLAY)).toBe(135.59);
  });

  it("divides by the rate — the actual bug", () => {
    // Typed 8500 while looking at pesos. Storing 8500 made a $135 card cost $8,500.
    expect(toUsd("8500", php)).toBeCloseTo(8500 / 62.689229, 6);
  });

  it("tells blank from zero", () => {
    // Clearing a cost basis and recording a free card are different facts.
    expect(toUsd("", php)).toBeNull();
    expect(toUsd(null, php)).toBeNull();
    expect(toUsd(undefined, php)).toBeNull();
    expect(toUsd("0", php)).toBe(0);
  });

  it("refuses anything that is not a number rather than storing NaN", () => {
    for (const v of ["abc", "1.2.3", " ", "$8500"]) expect(toUsd(v, php), v).toBeNull();
  });

  it("does not divide by a broken rate", () => {
    // Infinity in a price column would poison every sum that touched it.
    expect(toUsd("100", { code: "PHP", rate: 0, asOf: null })).toBe(100);
    expect(toUsd("100", { code: "PHP", rate: Number.NaN, asOf: null })).toBe(100);
  });
});

describe("fromUsd", () => {
  it("round-trips a typed amount back to what was typed", () => {
    const stored = toUsd("8500", php)!;
    expect(stored).toBeLessThan(200); // sanity: pesos in, dollars out
    expect(fromUsd(stored, php)).toBe("8500.00");
  });

  it("gives a plain number, never a formatted one", () => {
    // It fills a type="number" field, which silently renders empty for "₱8,500.00".
    const out = fromUsd(8500, php);
    expect(out).not.toMatch(/[₱,$]/);
    expect(Number.isFinite(Number(out))).toBe(true);
  });

  it("uses the currency's own precision", () => {
    expect(fromUsd(10, USD_DISPLAY)).toBe("10.00");
    // JPY has no minor unit; "1537.60" in a yen field is wrong.
    expect(fromUsd(10, jpy)).toBe("1538");
  });

  it("is empty for an amount that was never recorded", () => {
    expect(fromUsd(null, php)).toBe("");
    expect(fromUsd(undefined, php)).toBe("");
    expect(fromUsd(Number.NaN, php)).toBe("");
  });

  it("survives editing a lot and saving it unchanged", () => {
    // The nudge this guards: convert out, convert back, and the stored figure must not drift.
    const original = 135.5915;
    const shown = fromUsd(original, php);
    const back = toUsd(shown, php)!;
    expect(fromUsd(back, php)).toBe(shown);
  });
});

describe("inputCurrency", () => {
  it("says nothing for dollars and names anything else", () => {
    // Labelling every field "(USD)" is noise; not labelling a peso field is a factor-of-62 mistake.
    expect(inputCurrency(USD_DISPLAY)).toBeNull();
    expect(inputCurrency(php)).toBe("PHP");
  });
});

describe("placeholderAmount", () => {
  it("shows the market price in the field's own currency, without a symbol", () => {
    expect(placeholderAmount(10, php)).toBe("626.89");
  });

  it("falls back rather than rendering an empty placeholder", () => {
    expect(placeholderAmount(null, php)).toBe("0.00");
  });
});
