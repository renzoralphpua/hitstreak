// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SetCard } from "@/lib/catalog";
import type { Collection } from "@/lib/collections";

const { addItem, refresh } = vi.hoisted(() => ({ addItem: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/collections/actions", () => ({ addItemAction: addItem }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import SetGrid from "@/app/(app)/sets/[game]/[slug]/SetGrid";

const card = (over: Partial<SetCard> & { cardId: number }): SetCard => ({
  name: `Card ${over.cardId}`,
  number: String(over.cardId).padStart(3, "0"),
  rarity: "Common",
  imageUrl: null,
  lowestMarket: 0.25,
  ownedQuantity: 0,
  printings: [
    { printingId: over.cardId * 10, subtype: "Normal", market: 0.25, priceDate: "2026-09-07" },
    { printingId: over.cardId * 10 + 1, subtype: "Holofoil", market: 3.5, priceDate: "2026-09-07" },
  ],
  ...over,
});

const umbreon = card({ cardId: 1, name: "Umbreon ex", number: "161", ownedQuantity: 2, lowestMarket: 1465 });
const charmander = card({ cardId: 2, name: "Charmander", number: "004" });
const pikachu = card({ cardId: 3, name: "Pikachu", number: "005" });
const cards = [umbreon, charmander, pikachu];

const collections: Collection[] = [
  { id: 2, name: "Main Collection", slug: "main-collection", createdAt: "2026-09-01" },
  { id: 5, name: "Trades", slug: "trades", createdAt: "2026-09-02" },
];

beforeEach(() => {
  addItem.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("SetGrid", () => {
  it("points a card's back link at the set's real URL, not /sets/<id>", () => {
    // /sets/5 matches the GAME route (/sets/[game]) and renders a game that does not exist, so the
    // back arrow from a card landed nowhere. The set's canonical href is passed in for this.
    render(<SetGrid cards={cards} sealed={[]} setHref="/sets/pokemon/prismatic-evolutions" collections={collections} />);
    const details = screen.getAllByRole("link", { name: "Details" })[0];
    expect(details).toHaveAttribute(
      "href",
      `/cards/1?from=${encodeURIComponent("/sets/pokemon/prismatic-evolutions")}`
    );
  });

  it("counts owned and missing cards on the filter pills and filters the grid", () => {
    render(<SetGrid cards={cards} sealed={[]} setHref="/sets/pokemon/prismatic-evolutions" collections={collections} />);
    expect(screen.getByRole("button", { name: "All 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Owned 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Missing 2" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Details" })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Owned 1" }));
    expect(screen.getByRole("button", { name: /Umbreon ex/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Charmander/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Details" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Missing 2" }));
    expect(screen.queryByRole("button", { name: /Umbreon ex/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Charmander/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pikachu/ })).toBeInTheDocument();
  });

  it("tapping a missing tile adds the first printing to the target collection and shows ×1 at once", async () => {
    render(<SetGrid cards={cards} sealed={[]} setHref="/sets/pokemon/prismatic-evolutions" collections={collections} />);
    expect(screen.getByText("×2")).toBeInTheDocument(); // the already-owned card

    fireEvent.click(screen.getByRole("button", { name: /Charmander/ }));
    await waitFor(() =>
      expect(addItem).toHaveBeenCalledWith(2, { printingId: 20, quantity: 1, condition: "NM" })
    );
    expect(screen.getByText("×1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Owned 2" })).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("switching the target collection pill changes the collection the action is called with", async () => {
    render(<SetGrid cards={cards} sealed={[]} setHref="/sets/pokemon/prismatic-evolutions" collections={collections} />);
    expect(screen.getByRole("button", { name: "Main Collection" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(screen.getByRole("button", { name: "Trades" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Pikachu/ }));
    await waitFor(() =>
      expect(addItem).toHaveBeenCalledWith(5, { printingId: 30, quantity: 1, condition: "NM" })
    );
  });

  it("without a collection the tiles are not tappable and it points at /collections", () => {
    render(<SetGrid cards={cards} sealed={[]} setHref="/sets/pokemon/prismatic-evolutions" collections={[]} />);
    const hint = screen.getByRole("link", { name: "Create a collection to start marking cards owned" });
    expect(hint).toHaveAttribute("href", "/collections");
    expect(screen.queryByText("Add to:")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Charmander/ })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Charmander" })).toBeInTheDocument();
  });

  it("surfaces an action error as an alert and reverts the optimistic copy", async () => {
    addItem.mockResolvedValueOnce({ ok: false, error: "Collection not found" });
    render(<SetGrid cards={cards} sealed={[]} setHref="/sets/pokemon/prismatic-evolutions" collections={collections} />);

    fireEvent.click(screen.getByRole("button", { name: /Charmander/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Collection not found"));
    expect(screen.queryByText("×1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Owned 1" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
