import { describe, it, expect } from "vitest";
import { formatMoney, formatPercent, formatDelta, splitMoney } from "@/lib/format";

describe("format", () => {
  it("formatMoney: USD, 2 decimals, thousands separators; null → em dash", () => {
    expect(formatMoney(4812.4)).toBe("$4,812.40");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(1465, { compact: true })).toBe("$1,465");
  });
  it("splitMoney: whole and cents for the display style ($4,812 + .40)", () => {
    expect(splitMoney(4812.4)).toEqual({ whole: "$4,812", cents: ".40" });
  });
  it("formatPercent: one decimal, sign", () => {
    expect(formatPercent(0.0282)).toBe("+2.8%");
    expect(formatPercent(-0.15)).toBe("−15.0%");
    expect(formatPercent(0)).toBe("0.0%");
  });
  it("formatDelta: signed money using a true minus sign", () => {
    expect(formatDelta(132.1)).toBe("+$132.10");
    expect(formatDelta(-6.8)).toBe("−$6.80");
  });
});
