// @vitest-environment jsdom
// Search from anywhere. The palette NAVIGATES — an action menu per result was drafted and rejected,
// because every action needs a different form and a menu of forms is a worse router.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
let pathname = "/collections/7";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => pathname,
}));

import CommandPalette from "@/components/ui/CommandPalette";

const card = (over: Record<string, unknown> = {}) => ({
  cardId: 1, name: "Umbreon ex", number: "161/131", rarity: "Special Illustration Rare",
  setName: "Prismatic Evolutions", imageUrl: null, owned: 0,
  printings: [{ printingId: 1, subtype: "Holofoil", market: 1465, priceDate: "2026-09-07" }],
  ...over,
});

const body = {
  hits: [card({ cardId: 1, owned: 2 }), card({ cardId: 2, name: "Umbreon", owned: 0, rarity: "Common" })],
  jump: [{ kind: "set", id: 9, name: "Prismatic Evolutions", caption: "Pokémon · PRE" }],
};

beforeEach(() => {
  push.mockReset();
  pathname = "/collections/7";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const openPalette = () => fireEvent.click(screen.getByRole("button", { name: /Find a card/ }));
const type = async (q: string) => {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });
  await vi.advanceTimersByTimeAsync(300);
};

describe("CommandPalette", () => {
  it("opens on ⌘K and closes on Escape", async () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("waits for a real query before asking the server", async () => {
    render(<CommandPalette />);
    openPalette();
    await type("u");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
  });

  it("splits what you own from what merely exists, and offers somewhere to go", async () => {
    render(<CommandPalette />);
    openPalette();
    await type("umbreon");
    await waitFor(() => expect(screen.getByText("In your collection")).toBeInTheDocument());
    expect(screen.getByText("In the catalog")).toBeInTheDocument();
    expect(screen.getByText("Go to")).toBeInTheDocument();
    // An owned row says how many, which is the fastest way to tell "I have this" from "I could".
    expect(screen.getByText("×2")).toBeInTheDocument();
  });

  it("opens the card page and tells it where you came from", async () => {
    render(<CommandPalette />);
    openPalette();
    await type("umbreon");
    await waitFor(() => expect(screen.getByText("In your collection")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    // ?from= is this page, so the card screen's back arrow returns here — not to the card's set.
    expect(push).toHaveBeenCalledWith(`/cards/1?from=${encodeURIComponent("/collections/7")}`);
  });

  it("moves the cursor with the arrows and opens whatever it lands on", async () => {
    render(<CommandPalette />);
    openPalette();
    await type("umbreon");
    await waitFor(() => expect(screen.getByText("In the catalog")).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/cards/2"));
  });

  it("wraps around rather than sticking at either end", async () => {
    render(<CommandPalette />);
    openPalette();
    await type("umbreon");
    await waitFor(() => expect(screen.getByText("Go to")).toBeInTheDocument());
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowUp" }); // from the first row, back to the last
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/sets/9");
  });

  it("carries no action buttons — every row is a way to somewhere", async () => {
    render(<CommandPalette />);
    openPalette();
    await type("umbreon");
    await waitFor(() => expect(screen.getByText("In your collection")).toBeInTheDocument());
    const list = screen.getByRole("dialog").querySelector("ul")!;
    for (const b of within(list).getAllByRole("button")) {
      expect(b.textContent).not.toMatch(/add|alert|deck to/i);
    }
  });

  it("says so when the search fails instead of looking empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    render(<CommandPalette />);
    openPalette();
    await type("umbreon");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not search right now"));
  });

  it("forgets the query between openings", async () => {
    render(<CommandPalette />);
    openPalette();
    await type("umbreon");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    openPalette();
    expect(await screen.findByRole("searchbox")).toHaveValue("");
  });
});
