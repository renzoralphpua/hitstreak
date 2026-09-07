import { describe, it, expect } from "vitest";
import { parseRouteId } from "@/lib/route-id";

describe("parseRouteId", () => {
  it("accepts a plain positive integer", () => {
    expect(parseRouteId("12")).toBe(12);
  });
  it("rejects scientific notation, signs, decimals, zero, and non-numeric input", () => {
    expect(parseRouteId("1e3")).toBeNull();
    expect(parseRouteId("+5")).toBeNull();
    expect(parseRouteId("2.0")).toBeNull();
    expect(parseRouteId("0")).toBeNull();
    expect(parseRouteId("abc")).toBeNull();
    expect(parseRouteId("")).toBeNull();
  });
});
