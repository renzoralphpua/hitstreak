// @vitest-environment jsdom
// Recording a sale. The dialog's job beyond collecting numbers is to show what the sale realises
// BEFORE it is committed — a price handed over at a table is negotiated, and seeing the profit move
// as you type is the point.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { sell, refresh } = vi.hoisted(() => ({ sell: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/collections/sale-actions", () => ({ sellLotAction: sell, unsellAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import SellDialog from "@/app/(app)/cards/[id]/SellDialog";
import type { CardLot } from "@/lib/collections";

const lot = (over: Partial<CardLot> = {}): CardLot => ({
  itemId: 31, collectionId: 2, collectionName: "Table Stock", printingId: 9, subtype: "Holofoil",
  condition: "NM", quantity: 4, soldQuantity: 0, acquiredPrice: 1100, acquiredDate: "2026-08-01",
  market: 1500, cost: 4400, value: 6000, ...over,
});

const open = (over: Partial<CardLot> = {}) => {
  render(<SellDialog lot={lot(over)} />);
  fireEvent.click(screen.getByRole("button", { name: "Sell" }));
};
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  sell.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("SellDialog", () => {
  it("says which lot is being sold and what it cost", () => {
    open();
    expect(screen.getByText(/Table Stock/)).toBeInTheDocument();
    expect(screen.getByText(/4 held/)).toBeInTheDocument();
    expect(screen.getByText(/paid \$1,100\.00 each/)).toBeInTheDocument();
  });

  it("seeds the price from the market, because that is what you price off at a table", () => {
    open();
    expect(field(/Sold for/).value).toBe("1500.00");
  });

  it("shows the proceeds and the profit before anything is committed", () => {
    open();
    fireEvent.change(field(/Copies/), { target: { value: "2" } });
    fireEvent.change(field(/Sold for/), { target: { value: "1500" } });
    // 2 × 1500 = 3000 proceeds, against 2 × 1100 = 2200 cost.
    expect(screen.getByText("$3,000.00")).toBeInTheDocument();
    expect(screen.getByText(/800/)).toBeInTheDocument();
  });

  it("takes fees off the proceeds as you type them", () => {
    open();
    fireEvent.change(field(/Copies/), { target: { value: "1" } });
    fireEvent.change(field(/Sold for/), { target: { value: "1500" } });
    fireEvent.change(field(/Fees/), { target: { value: "100" } });
    expect(screen.getByText("$1,400.00")).toBeInTheDocument();
  });

  it("says there is no profit to show when the lot has no recorded cost", () => {
    // Not zero profit — unknown profit. Guessing zero would invent a gain.
    open({ acquiredPrice: null, cost: null });
    expect(screen.getByText(/no recorded cost/)).toBeInTheDocument();
    fireEvent.change(field(/Sold for/), { target: { value: "20" } });
    expect(screen.getByText(/no cost recorded/)).toBeInTheDocument();
  });

  it("refuses to sell more copies than the lot holds", async () => {
    open();
    fireEvent.change(field(/Copies/), { target: { value: "9" } });
    expect(screen.getByRole("alert")).toHaveTextContent("You only hold 4");
    expect(screen.getByRole("button", { name: "Record sale" })).toBeDisabled();
  });

  it("sends the sale and refreshes", async () => {
    open();
    fireEvent.change(field(/Copies/), { target: { value: "2" } });
    fireEvent.change(field(/Sold for/), { target: { value: "1500" } });
    fireEvent.change(field(/Date/), { target: { value: "2026-09-10" } });
    fireEvent.change(field(/Where/), { target: { value: "  Manila Card Con  " } });
    fireEvent.click(screen.getByRole("button", { name: "Record sale" }));

    await waitFor(() => expect(sell).toHaveBeenCalledWith({
      itemId: 31, quantity: 2, unitPrice: 1500, fees: 0,
      soldDate: "2026-09-10", venue: "Manila Card Con",
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("sends no venue rather than an empty string", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(sell).toHaveBeenCalledWith(expect.objectContaining({ venue: null })));
  });

  it("reports a rejection instead of closing as though it worked", async () => {
    sell.mockResolvedValueOnce({ ok: false, error: "That lot is already sold" });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That lot is already sold"));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cannot be opened for a lot with nothing left", () => {
    render(<SellDialog lot={lot({ quantity: 0, soldQuantity: 4 })} />);
    expect(screen.getByRole("button", { name: "Sell" })).toBeDisabled();
  });
});
