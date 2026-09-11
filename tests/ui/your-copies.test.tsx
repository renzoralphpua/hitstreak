// @vitest-environment jsdom
// The card page is the only place lots are visible as lots. Two copies bought a year apart at
// different prices must read as two purchases, and editing one must not touch the other.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CardLot } from "@/lib/collections";

const { update, remove, refresh } = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/collections/actions", () => ({ updateItemAction: update, removeItemAction: remove }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import YourCopies from "@/app/(app)/cards/[id]/YourCopies";

const lot = (over: Partial<CardLot>): CardLot => ({
  itemId: 1, collectionId: 2, collectionName: "Main", printingId: 9, subtype: "Holofoil",
  condition: "NM", quantity: 1, acquiredPrice: 1101.5, acquiredDate: "2025-02-12",
  market: 1465, cost: 1101.5, value: 1465, ...over,
});

/** Last year at one price, this year at another — the case that was impossible before lots. */
const older = lot({});
const newer = lot({ itemId: 2, quantity: 2, acquiredPrice: 1400, acquiredDate: "2026-08-02", cost: 2800, value: 2930 });

beforeEach(() => {
  update.mockReset().mockResolvedValue({ ok: true });
  remove.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

/** The subtype/condition/date caption is one span built from several JSX expressions, so its text
 *  is split across nodes — match on the element's whole textContent instead of a single node. */
const rowFor = (text: string) =>
  screen.getByText((_, el) => el?.tagName === "SPAN" && (el.textContent ?? "").includes(text)).closest("li")!;

describe("YourCopies", () => {
  it("gives every purchase its own row with what was paid, when, and how many", () => {
    render(<YourCopies lots={[newer, older]} />);
    expect(screen.getByText("2 purchases")).toBeInTheDocument();

    const first = rowFor("bought 2026-08-02");
    expect(within(first).getByText("×2")).toBeInTheDocument();
    expect(within(first).getByText("$1,400.00")).toBeInTheDocument();  // per copy
    expect(first.textContent).toContain("$2,800.00 total");           // × 2

    const second = rowFor("bought 2025-02-12");
    expect(within(second).getByText("$1,101.50")).toBeInTheDocument();
    // A single copy needs no "total" restatement of its own price.
    expect(second.textContent).not.toContain("total");
  });

  it("says so when a purchase has no price or no date, rather than showing a zero", () => {
    render(<YourCopies lots={[lot({ acquiredPrice: null, acquiredDate: null, cost: null })]} />);
    expect(screen.getByText("not recorded")).toBeInTheDocument();
    expect(screen.getByText(/no date recorded/)).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("edits ONE lot, leaving the other purchase alone", async () => {
    render(<YourCopies lots={[newer, older]} />);
    fireEvent.click(within(rowFor("bought 2025-02-12")).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Paid each"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(2, 1, { quantity: 1, acquiredPrice: 1200, acquiredDate: "2025-02-12" })
    );
    expect(update).toHaveBeenCalledTimes(1); // the 2026 purchase is untouched
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("lets a price be cleared back to unknown rather than trapping a wrong entry", async () => {
    render(<YourCopies lots={[older]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Paid each"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(2, 1, expect.objectContaining({ acquiredPrice: null })));
  });

  it("confirms before removing a purchase, and says the other copies survive", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<YourCopies lots={[older]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledWith(
      "Remove this purchase of 1 from 2025-02-12? Your other copies stay."
    );
    await waitFor(() => expect(remove).toHaveBeenCalledWith(2, 1));
    confirm.mockRestore();
  });

  it("surfaces a failure against the row it belongs to", async () => {
    update.mockResolvedValueOnce({ ok: false, error: "Item not found" });
    render(<YourCopies lots={[older]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Item not found"));
    expect(refresh).not.toHaveBeenCalled();
  });
});
