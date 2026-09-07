// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Alert } from "@/lib/alerts";

const { deleteAlert, refresh } = vi.hoisted(() => ({ deleteAlert: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/alerts/actions", () => ({ deleteAlertAction: deleteAlert }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import AlertList from "@/app/(app)/alerts/AlertList";

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 1, printingId: 5, cardId: 9, cardName: "Umbreon ex", setName: "Prismatic Evolutions", number: "161/131", subtype: "Holofoil", imageUrl: null,
  direction: "above", threshold: 1450, armed: true, lastFiredAt: null, lastFiredPrice: null, createdAt: "2026-09-01T00:00:00.000Z",
  market: 1465, priceDate: "2026-09-07", change30d: null,
  ...over,
});

// Fired last night, waiting for the price to fall back under the line.
const triggered = alert({ id: 1, armed: false, lastFiredAt: "2026-09-07T21:05:00.000Z", lastFiredPrice: 1465, change30d: { amount: 100, ratio: 0.073 } });
// Still armed, up a third over the month.
const watching = alert({
  id: 2, printingId: 2, cardId: 2, cardName: "Pikachu", number: "025/131", subtype: "Normal",
  direction: "below", threshold: 0.2, market: 0.25, change30d: { amount: 0.06, ratio: 0.332 },
});

beforeEach(() => {
  deleteAlert.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("AlertList", () => {
  it("groups fired alerts under Triggered and armed ones under Watching", () => {
    render(<AlertList alerts={[triggered, watching]} />);
    expect(screen.getByText("Triggered")).toBeInTheDocument();
    expect(screen.getByText("Watching")).toBeInTheDocument();
    expect(screen.getByText("Umbreon ex")).toBeInTheDocument();
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    // Triggered comes first.
    const order = screen.getAllByText(/^(Triggered|Watching)$/).map((n) => n.textContent);
    expect(order).toEqual(["Triggered", "Watching"]);
  });

  it("leaves out a group with nothing in it", () => {
    render(<AlertList alerts={[watching]} />);
    expect(screen.queryByText("Triggered")).not.toBeInTheDocument();
    expect(screen.getByText("Watching")).toBeInTheDocument();
  });

  it("a triggered row is inverted and says when it emailed and where it re-arms", () => {
    render(<AlertList alerts={[triggered]} />);
    expect(screen.getByText(/Rises above \$1,450\.00 · emailed Sep 7/)).toBeInTheDocument();
    expect(screen.getByText("re-arms below $1,450.00")).toBeInTheDocument();
    expect(screen.getByText("$1,465.00")).toBeInTheDocument();
    expect(screen.getByText("Umbreon ex").closest(".bg-chip")).not.toBeNull();
  });

  it("a watching row shows the line and the 30-day change in the gain tone", () => {
    render(<AlertList alerts={[watching]} />);
    expect(screen.getByText(/Prismatic Evolutions · 025\/131 · Normal — Drops below \$0\.20$/)).toBeInTheDocument();
    const change = screen.getByText("+33.2% · 30D");
    expect(change).toHaveClass("text-gain");
    expect(change).not.toHaveClass("text-accent");
    expect(screen.getByText("Pikachu").closest(".bg-chip")).toBeNull();
  });

  it("a negative 30-day change takes the loss tone, and no history says so", () => {
    render(
      <AlertList
        alerts={[
          alert({ id: 3, cardName: "Shanks", change30d: { amount: -5, ratio: -0.25 } }),
          alert({ id: 4, cardName: "Luffy", change30d: null }),
        ]}
      />
    );
    expect(screen.getByText("−25.0% · 30D")).toHaveClass("text-accent");
    expect(screen.getByText("no 30D history")).toBeInTheDocument();
  });

  it("Delete confirms, then calls deleteAlertAction and refreshes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AlertList alerts={[triggered, watching]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete alert for Pikachu" }));
    expect(confirm).toHaveBeenCalledWith("Delete the drops below $0.20 alert for Pikachu?");
    await waitFor(() => expect(deleteAlert).toHaveBeenCalledWith(2));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(deleteAlert).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the confirm is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AlertList alerts={[triggered]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete alert for Umbreon ex" }));
    expect(deleteAlert).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces an action error as an alert", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteAlert.mockResolvedValueOnce({ ok: false, error: "Alert not found" });
    render(<AlertList alerts={[triggered]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete alert for Umbreon ex" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Alert not found"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a thrown action as a network problem", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteAlert.mockRejectedValueOnce(new Error("boom"));
    render(<AlertList alerts={[triggered]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete alert for Umbreon ex" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not reach the server/i));
    expect(refresh).not.toHaveBeenCalled();
  });
});
