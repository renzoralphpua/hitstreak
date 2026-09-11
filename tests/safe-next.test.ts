import { describe, it, expect } from "vitest";
import { safeNext } from "@/app/(auth)/safe-next";

describe("safeNext (open-redirect guard)", () => {
  const cases: Array<[unknown, string]> = [
    ["/binders", "/binders"],
    ["/cards?q=x#y", "/cards?q=x#y"],
    ["//evil.com", "/binders"],
    ["/\\evil.com", "/binders"],
    ["/\t/evil.com", "/binders"],
    ["/\r\n/evil.com", "/binders"],
    ["/\\\\/evil.com", "/binders"],
    ["javascript:alert(1)", "/binders"],
    ["https://evil.com", "/binders"],
    ["", "/binders"],
    [undefined, "/binders"],
    ["relative", "/binders"],
    ["/" + "a".repeat(3000), "/binders"],
    [123, "/binders"],
    [{}, "/binders"],
  ];

  it.each(cases)("safeNext(%j) -> %j", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
