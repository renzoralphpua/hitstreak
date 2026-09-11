// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Holding } from "@/lib/collections";

const { add, decrement, removeHolding, refresh } = vi.hoisted(() => ({
  add: vi.fn(), decrement: vi.fn(), removeHolding: vi.fn(), refresh: vi.fn(),
}));
// A row is a holding now, so its controls are holding-level. `+` goes through addItemAction
// because adding a copy is an acquisition, not an edit to an existing lot.
vi.mock("@/app/(app)/collections/actions", () => ({
  addItemAction: add, decrementHoldingAction: decrement, removeHoldingAction: removeHolding,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import HoldingsTable from "@/app/(app)/collections/[id]/HoldingsTable";

const holding = (over: Partial<Holding>): Holding => ({
  printingId: 1, cardId: 1, cardName: "Umbreon ex", setName: "Prismatic Evolutions",
  number: "161/131", subtype: "Holofoil", imageUrl: null, quantity: 1, condition: "NM",
  market: 1465, priceDate: "2026-09-07", value: 1465, cost: 1100, uncostedQuantity: 0,
  lots: [{ itemId: 1, quantity: 1, acquiredPrice: 1100, acquiredDate: null, cost: 1100 }],
  ...over,
});

const priced = holding({});
const unpriced = holding({
  printingId: 4, cardId: 3, cardName: "Booster Bundle", number: null, subtype: "Normal",
  quantity: 2, market: null, priceDate: null, value: null, cost: null, uncostedQuantity: 2,
  lots: [{ itemId: 2, quantity: 2, acquiredPrice: null, acquiredDate: null, cost: null }],
});
/** Two purchases of the same printing and condition at different prices. */
const twoLots = holding({
  printingId: 9, cardId: 9, cardName: "Pikachu", number: "238/191", subtype: "Normal",
  quantity: 5, market: 10, value: 50, cost: 16, uncostedQuantity: 0,
  lots: [
    { itemId: 11, quantity: 2, acquiredPrice: 5, acquiredDate: null, cost: 10 },
    { itemId: 10, quantity: 3, acquiredPrice: 2, acquiredDate: null, cost: 6 },
  ],
});

beforeEach(() => {
  add.mockReset().mockResolvedValue({ ok: true });
  decrement.mockReset().mockResolvedValue({ ok: true });
  removeHolding.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("HoldingsTable", () => {
  it("renders each holding with its subtitle, value and gain", () => {
    render(<HoldingsTable collectionId={7} holdings={[priced]} />);
    expect(screen.getByText("Umbreon ex")).toBeInTheDocument();
    expect(screen.getByText("Prismatic Evolutions · 161/131 · Holofoil · NM")).toBeInTheDocument();
    expect(screen.getByText("$1,465.00")).toBeInTheDocument();
    expect(screen.getByText(/\+\$365\.00/)).toBeInTheDocument();
  });

  it("shows an em dash and 'no price' for an unpriced holding", () => {
    render(<HoldingsTable collectionId={7} holdings={[unpriced]} />);
    expect(screen.getByText("no price")).toBeInTheDocument();
    // one dash for the value, one for the unknown delta
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("the + stepper records a NEW uncosted lot rather than bumping an existing one", async () => {
    render(<HoldingsTable collectionId={7} holdings={[priced]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add one Umbreon ex" }));
    // No acquiredPrice: bumping the existing lot would value this copy at the older copy’s
    // price, which is the bug that made acquisitions lots in the first place.
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(7, { printingId: 1, quantity: 1, condition: "NM" })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("the − stepper is disabled at one copy and decrements the holding above it", async () => {
    render(<HoldingsTable collectionId={7} holdings={[priced, unpriced]} />);
    expect(screen.getByRole("button", { name: "Remove one Umbreon ex" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove one Booster Bundle" }));
    await waitFor(() => expect(decrement).toHaveBeenCalledWith(7, 4, "NM"));
  });

  it("says how many copies have no recorded cost, because the gain excludes them", () => {
    render(<HoldingsTable collectionId={7} holdings={[unpriced, holding({
      printingId: 5, cardName: "Shanks", quantity: 5, cost: 20, uncostedQuantity: 3, value: 100,
      lots: [
        { itemId: 21, quantity: 3, acquiredPrice: null, acquiredDate: null, cost: null },
        { itemId: 20, quantity: 2, acquiredPrice: 10, acquiredDate: null, cost: 20 },
      ],
    })]} />);
    expect(screen.getByText("no cost recorded")).toBeInTheDocument();      // every copy
    expect(screen.getByText("3 of 5 without a cost")).toBeInTheDocument(); // some copies
  });

  it("Remove confirms first, then removes the whole holding", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<HoldingsTable collectionId={7} holdings={[priced]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Umbreon ex from collection" }));
    expect(confirm).toHaveBeenCalledWith("Remove 1 × Umbreon ex from this collection?");
    await waitFor(() => expect(removeHolding).toHaveBeenCalledWith(7, 1, "NM"));
    confirm.mockRestore();
  });

  it("warns that a multi-lot holding is several purchases before removing it", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<HoldingsTable collectionId={7} holdings={[twoLots]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Pikachu from collection" }));
    expect(confirm).toHaveBeenCalledWith("Remove 5 × Pikachu (2 purchases) from this collection?");
    confirm.mockRestore();
  });

  it("Remove does nothing when the confirm is dismissed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<HoldingsTable collectionId={7} holdings={[priced]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Umbreon ex from collection" }));
    expect(removeHolding).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("surfaces an action error as an alert", async () => {
    add.mockResolvedValueOnce({ ok: false, error: "Item not found" });
    render(<HoldingsTable collectionId={7} holdings={[priced]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add one Umbreon ex" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Item not found"));
    expect(refresh).not.toHaveBeenCalled();
  });
});
