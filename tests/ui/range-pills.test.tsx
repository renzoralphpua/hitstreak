// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RangePills from "@/components/ui/RangePills";

describe("RangePills", () => {
  it("renders one link per range with the current one marked", () => {
    render(<RangePills current="90d" hrefFor={(r) => `/cards/1?range=${r}`} />);
    const group = screen.getByRole("group", { name: "Chart range" });
    const links = group.querySelectorAll("a");
    expect([...links].map((a) => a.textContent)).toEqual(["7D", "30D", "90D", "1Y", "All"]);
    expect(screen.getByRole("link", { name: "90D" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1Y" })).toHaveAttribute("href", "/cards/1?range=1y");
    expect(screen.getByRole("link", { name: "1Y" })).not.toHaveAttribute("aria-current");
  });
});
