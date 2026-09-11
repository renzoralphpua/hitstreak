// @vitest-environment jsdom
// The grid is the binder's default view. What it must get right is the three things a tile can say
// under the value — and never saying 0% for a holding whose cost was never recorded.
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Holding } from "@/lib/portfolios";
import BinderGrid from "@/app/(app)/binders/[id]/BinderGrid";
import { parseView } from "@/lib/view-mode";

const holding = (over: Partial<Holding>): Holding => ({
  printingId: 1, cardId: 1, cardName: "Umbreon ex", setName: "Prismatic Evolutions",
  number: "161/131", subtype: "Holofoil", imageUrl: null, quantity: 1, condition: "NM",
  market: 1465, priceDate: "2026-09-07", value: 1465, cost: 1101.5, uncostedQuantity: 0,
  lots: [{ itemId: 1, quantity: 1, acquiredPrice: 1101.5, acquiredDate: null, cost: 1101.5 }],
  ...over,
});

const tileFor = (name: string) => screen.getByText(name).closest("li")!;

describe("parseView", () => {
  it("defaults to grid and only accepts an exact 'list'", () => {
    expect(parseView(undefined)).toBe("grid");
    expect(parseView("list")).toBe("list");
    expect(parseView("grid")).toBe("grid");
    expect(parseView("List")).toBe("grid");
    expect(parseView(["list", "grid"])).toBe("grid"); // a repeated query key is not a choice
  });
});

describe("BinderGrid", () => {
  it("shows the vs-paid percent without the dollar figure, which will not fit a tile", () => {
    render(<BinderGrid holdings={[holding({})]} />);
    const tile = tileFor("Umbreon ex");
    expect(within(tile).getByText("$1,465.00")).toBeInTheDocument();
    expect(within(tile).getByText("+33.0%")).toBeInTheDocument();
    expect(tile.textContent).not.toMatch(/\$363/);   // the dollar delta stays in the list view
    expect(tile.textContent).not.toMatch(/[▲▼]/);    // sign and colour already say the direction
  });

  it("asks for the missing cost instead of claiming a holding has not moved", () => {
    render(<BinderGrid holdings={[holding({ cost: null, uncostedQuantity: 1 })]} />);
    const tile = tileFor("Umbreon ex");
    expect(within(tile).getByText("Add cost")).toBeInTheDocument();
    // 0% would read as "worth exactly what you paid" — the opposite of "we do not know".
    expect(tile.textContent).not.toContain("0.0%");
  });

  it("asks for the cost when only SOME copies have one, since the gain is overstated either way", () => {
    render(<BinderGrid holdings={[holding({ quantity: 3, value: 4395, cost: 1101.5, uncostedQuantity: 2 })]} />);
    expect(within(tileFor("Umbreon ex")).getByText("Add cost")).toBeInTheDocument();
  });

  it("says 'no price' when the ingest has never priced the printing", () => {
    render(<BinderGrid holdings={[holding({ market: null, value: null, priceDate: null })]} />);
    const tile = tileFor("Umbreon ex");
    expect(within(tile).getByText("no price")).toBeInTheDocument();
    expect(within(tile).getByText("—")).toBeInTheDocument();
  });

  it("shows the ×N chip only above a single copy — a binder is all-owned, so ×1 says nothing", () => {
    render(<BinderGrid holdings={[holding({}), holding({ printingId: 2, cardId: 2, cardName: "Shanks", quantity: 3 })]} />);
    expect(tileFor("Umbreon ex").textContent).not.toContain("×");
    expect(within(tileFor("Shanks")).getByText("×3")).toBeInTheDocument();
  });

  it("carries no controls at all — a tile is a link to the card page", () => {
    render(<BinderGrid holdings={[holding({})]} />);
    const tile = tileFor("Umbreon ex");
    expect(within(tile).queryAllByRole("button")).toEqual([]);
    expect(within(tile).getByRole("link")).toHaveAttribute("href", "/cards/1");
  });
});
