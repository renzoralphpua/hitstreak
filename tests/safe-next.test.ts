import { describe, it, expect } from "vitest";
import { safeNext } from "@/app/(auth)/safe-next";

describe("safeNext (open-redirect guard)", () => {
  const cases: Array<[unknown, string]> = [
    ["/portfolios", "/portfolios"],
    ["/cards?q=x#y", "/cards?q=x#y"],
    ["//evil.com", "/portfolios"],
    ["/\\evil.com", "/portfolios"],
    ["/\t/evil.com", "/portfolios"],
    ["/\r\n/evil.com", "/portfolios"],
    ["/\\\\/evil.com", "/portfolios"],
    ["javascript:alert(1)", "/portfolios"],
    ["https://evil.com", "/portfolios"],
    ["", "/portfolios"],
    [undefined, "/portfolios"],
    ["relative", "/portfolios"],
    ["/" + "a".repeat(3000), "/portfolios"],
    [123, "/portfolios"],
    [{}, "/portfolios"],
  ];

  it.each(cases)("safeNext(%j) -> %j", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
