// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Holding } from "@/lib/portfolios";

const { update, remove, refresh } = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/portfolios/actions", () => ({ updateItemAction: update, removeItemAction: remove }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import HoldingsTable from "@/app/(app)/portfolios/[id]/HoldingsTable";

const holding = (over: Partial<Holding>): Holding => ({
  itemId: 1, printingId: 1, cardId: 1, cardName: "Umbreon ex", setName: "Prismatic Evolutions",
  number: "161/131", subtype: "Holofoil", imageUrl: null, quantity: 1, condition: "NM",
  acquiredPrice: 1100, acquiredDate: null, market: 1465, priceDate: "2026-09-07",
  value: 1465, cost: 1100, ...over,
});

const priced = holding({});
const unpriced = holding({
  itemId: 2, printingId: 4, cardId: 3, cardName: "Booster Bundle", number: null, subtype: "Normal",
  quantity: 2, acquiredPrice: null, market: null, priceDate: null, value: null, cost: null,
});

beforeEach(() => {
  update.mockReset().mockResolvedValue({ ok: true });
  remove.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("HoldingsTable", () => {
  it("renders each holding with its subtitle, value and gain", () => {
    render(<HoldingsTable portfolioId={7} holdings={[priced]} />);
    expect(screen.getByText("Umbreon ex")).toBeInTheDocument();
    expect(screen.getByText("Prismatic Evolutions · 161/131 · Holofoil · NM")).toBeInTheDocument();
    expect(screen.getByText("$1,465.00")).toBeInTheDocument();
    expect(screen.getByText(/\+\$365\.00/)).toBeInTheDocument();
  });

  it("shows an em dash and 'no price' for an unpriced holding", () => {
    render(<HoldingsTable portfolioId={7} holdings={[unpriced]} />);
    expect(screen.getByText("no price")).toBeInTheDocument();
    // one dash for the value, one for the unknown delta
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("the + stepper updates the quantity and refreshes", async () => {
    render(<HoldingsTable portfolioId={7} holdings={[priced]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add one Umbreon ex" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(7, 1, { quantity: 2 }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("the − stepper is disabled at one copy and decrements above it", async () => {
    render(<HoldingsTable portfolioId={7} holdings={[priced, unpriced]} />);
    expect(screen.getByRole("button", { name: "Remove one Umbreon ex" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove one Booster Bundle" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(7, 2, { quantity: 1 }));
  });

  it("Remove confirms first, then calls the action", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<HoldingsTable portfolioId={7} holdings={[priced]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Umbreon ex from binder" }));
    expect(confirm).toHaveBeenCalledWith("Remove 1 × Umbreon ex from this binder?");
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7, 1));
    confirm.mockRestore();
  });

  it("Remove does nothing when the confirm is dismissed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<HoldingsTable portfolioId={7} holdings={[priced]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Umbreon ex from binder" }));
    expect(remove).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("surfaces an action error as an alert", async () => {
    update.mockResolvedValueOnce({ ok: false, error: "Item not found" });
    render(<HoldingsTable portfolioId={7} holdings={[priced]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add one Umbreon ex" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Item not found"));
    expect(refresh).not.toHaveBeenCalled();
  });
});
