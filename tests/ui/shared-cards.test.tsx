// @vitest-environment jsdom
// The public share view's cards. Two rules it must never break: nothing about what the owner PAID,
// and nothing that assumes the viewer knows what is in the collection.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SharedCards from "@/app/s/[token]/SharedCards";
import type { PublicHolding } from "@/lib/share";

const holding = (over: Partial<PublicHolding> & { printingId: number }): PublicHolding => ({
  cardId: over.printingId, cardName: `Card ${over.printingId}`, setName: "Prismatic Evolutions",
  number: "001/131", rarity: "Common", subtype: "Holofoil", imageUrl: null, condition: "NM",
  quantity: 1, market: 10, priceDate: "2026-09-07", value: 10, ...over,
});

const holdings = [
  holding({ printingId: 1, cardName: "Umbreon ex", number: "161/131", value: 1465, quantity: 2, rarity: "Special Illustration Rare" }),
  holding({ printingId: 2, cardName: "Pikachu", number: "025/131", value: 0.25 }),
  holding({ printingId: 3, cardName: "Sylveon ex", number: "086/131", value: 40 }),
];

beforeEach(() => render(<SharedCards holdings={holdings} />));

describe("SharedCards", () => {
  it("shows every card with its value and count", () => {
    expect(screen.getByText("Umbreon ex")).toBeInTheDocument();
    expect(screen.getByText("$1,465.00")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
  });

  it("is a grid only — a visitor has no list view to toggle to", () => {
    expect(screen.queryByRole("button", { name: "List" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Grid" })).toBeNull();
  });

  it("is searchable, because a stranger cannot know what is in here", () => {
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "umbreon" } });
    expect(screen.getByText("Umbreon ex")).toBeInTheDocument();
    expect(screen.queryByText("Pikachu")).toBeNull();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("searches the set, number and rarity too, not just the name", () => {
    for (const [q, expected] of [["prismatic", 3], ["025", 1], ["illustration", 1]] as const) {
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });
      const tiles = screen.getAllByText(/Umbreon ex|Pikachu|Sylveon ex/);
      expect(tiles.length, q).toBe(expected);
    }
  });

  it("says so when nothing matches rather than looking broken", () => {
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "charizard" } });
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("NEVER offers a sort by what the owner paid", () => {
    // Cost basis does not reach a public link, so there is nothing to sort by — and an option that
    // existed but did nothing would be a promise the page cannot keep.
    const options = [...screen.getByRole("combobox").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).not.toContain("Price paid");
    expect(options).not.toContain("Gain");
    expect(options).toContain("Market price");
  });

  it("sorts, defaulting to the most valuable first", () => {
    const names = screen.getAllByText(/Umbreon ex|Pikachu|Sylveon ex/).map((n) => n.textContent);
    expect(names).toEqual(["Umbreon ex", "Sylveon ex", "Pikachu"]);
  });
});
