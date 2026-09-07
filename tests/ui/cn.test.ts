import { describe, it, expect } from "vitest";
import { cn } from "@/components/ui/cn";

describe("cn", () => {
  it("resolves Tailwind class conflicts, keeping the last one", () => {
    expect(cn("min-h-11", "min-h-8")).toBe("min-h-8");
  });
  it("joins truthy parts and drops falsy ones", () => {
    expect(cn("a", false, null, "b")).toBe("a b");
  });
});
