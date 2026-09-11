import { describe, it, expect } from "vitest";
import { safeNext } from "@/app/(auth)/safe-next";

describe("safeNext (open-redirect guard)", () => {
  const cases: Array<[unknown, string]> = [
    ["/collections", "/collections"],
    ["/cards?q=x#y", "/cards?q=x#y"],
    ["//evil.com", "/collections"],
    ["/\\evil.com", "/collections"],
    ["/\t/evil.com", "/collections"],
    ["/\r\n/evil.com", "/collections"],
    ["/\\\\/evil.com", "/collections"],
    ["javascript:alert(1)", "/collections"],
    ["https://evil.com", "/collections"],
    ["", "/collections"],
    [undefined, "/collections"],
    ["relative", "/collections"],
    ["/" + "a".repeat(3000), "/collections"],
    [123, "/collections"],
    [{}, "/collections"],
  ];

  it.each(cases)("safeNext(%j) -> %j", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
