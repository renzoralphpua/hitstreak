import { describe, it, expect } from "vitest";
import { safeNext } from "@/app/(auth)/safe-next";

describe("safeNext (open-redirect guard)", () => {
  const cases: Array<[unknown, string]> = [
    ["/collections", "/collections"],
    ["/cards?q=x#y", "/cards?q=x#y"],
    ["//evil.com", "/home"],
    ["/\\evil.com", "/home"],
    ["/\t/evil.com", "/home"],
    ["/\r\n/evil.com", "/home"],
    ["/\\\\/evil.com", "/home"],
    ["javascript:alert(1)", "/home"],
    ["https://evil.com", "/home"],
    ["", "/home"],
    [undefined, "/home"],
    ["relative", "/home"],
    ["/" + "a".repeat(3000), "/home"],
    [123, "/home"],
    [{}, "/home"],
  ];

  it.each(cases)("safeNext(%j) -> %j", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
