// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { addItem, refresh } = vi.hoisted(() => ({ addItem: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/collections/actions", () => ({ addItemAction: addItem }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import AddItemDialog from "@/app/(app)/collections/[slug]/AddItemDialog";

const printings = [
  { printingId: 2, subtype: "Normal", market: 0.25, priceDate: "2026-09-07" },
  { printingId: 3, subtype: "Reverse Holofoil", market: 1.1, priceDate: "2026-09-07" },
];
const hit = {
  cardId: 2, name: "Pikachu", number: "025/131", rarity: "Common", imageUrl: null,
  setName: "Prismatic Evolutions", gameSlug: "pokemon", printings,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  addItem.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hits: [hit] }) });
  vi.stubGlobal("fetch", fetchMock);
});

async function openAndPick() {
  render(<AddItemDialog collectionId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pika" } });
  const row = await screen.findByRole("button", { name: /Pikachu/ });
  fireEvent.click(row);
}

describe("AddItemDialog", () => {
  it("searches, picks a card, and adds the first printing with the defaults", async () => {
    await openAndPick();
    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=pika");
    expect(screen.getByRole("button", { name: "Normal · $0.25" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reverse Holofoil · $1.10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Normal · $0.25" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "NM" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
    await waitFor(() =>
      expect(addItem).toHaveBeenCalledWith(7, { printingId: 2, quantity: 1, condition: "NM", acquiredPrice: null })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // closed again
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends the chosen printing, quantity, condition and price paid", async () => {
    await openAndPick();
    fireEvent.click(screen.getByRole("button", { name: "Reverse Holofoil · $1.10" }));
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "LP" }));
    fireEvent.change(screen.getByLabelText(/Price paid/), { target: { value: "0.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
    await waitFor(() =>
      expect(addItem).toHaveBeenCalledWith(7, { printingId: 3, quantity: 3, condition: "LP", acquiredPrice: 0.9 })
    );
  });

  it("shows the action's error as an alert and stays open", async () => {
    addItem.mockResolvedValueOnce({ ok: false, error: "Printing not found" });
    await openAndPick();
    fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Printing not found"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Escape closes the dialog, and so does Cancel", async () => {
    render(<AddItemDialog collectionId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(addItem).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger when it closes", async () => {
    render(<AddItemDialog collectionId={7} />);
    const trigger = screen.getByRole("button", { name: "Add a card" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("focuses the first control when the card is preselected, and traps Tab in the panel", () => {
    render(
      <AddItemDialog
        collectionId={7}
        preselected={{ name: "Pikachu", subtitle: "Prismatic Evolutions · 025/131", imageUrl: null, printings }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    const panel = screen.getByRole("dialog");
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Normal · $0.25" }));

    // Shift+Tab off the first control wraps to the last one instead of leaving the dialog.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add to collection" }));
    // …and Tab off the last wraps back to the first.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Normal · $0.25" }));
  });

  it("does not search for a one-character query", async () => {
    render(<AddItemDialog collectionId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "p" } });
    await new Promise((r) => setTimeout(r, 320));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a custom trigger label", () => {
    render(<AddItemDialog collectionId={7} label="Add your first card" />);
    expect(screen.getByRole("button", { name: "Add your first card" })).toBeInTheDocument();
  });

  it("skips the search step when a card is preselected", async () => {
    render(
      <AddItemDialog
        collectionId={7}
        preselected={{ name: "Pikachu", subtitle: "Prismatic Evolutions · 025/131", imageUrl: null, printings }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Normal · $0.25" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pick a different card" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
    await waitFor(() =>
      expect(addItem).toHaveBeenCalledWith(7, { printingId: 2, quantity: 1, condition: "NM", acquiredPrice: null })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
