// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { createDeck, push, refresh } = vi.hoisted(() => ({ createDeck: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/decks/actions", () => ({ createDeckAction: createDeck, renameDeckAction: vi.fn(), deleteDeckAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import NewDeckForm from "@/app/(app)/decks/mine/NewDeckForm";

const GAMES = [
  { slug: "pokemon", name: "Pokémon" },
  { slug: "one-piece", name: "One Piece Card Game" },
  { slug: "riftbound", name: "Riftbound" },
];

beforeEach(() => {
  createDeck.mockReset().mockResolvedValue({ ok: true, data: 12 });
  push.mockReset();
});

const type = (v: string) => fireEvent.change(screen.getByLabelText("Deck name"), { target: { value: v } });

describe("NewDeckForm", () => {
  it("renders one pill per game with the first selected", () => {
    render(<NewDeckForm games={GAMES} />);
    expect(screen.getByRole("button", { name: "Pokémon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Riftbound" })).toHaveAttribute("aria-pressed", "false");
  });

  it("creates the deck for the selected game and opens the builder", async () => {
    render(<NewDeckForm games={GAMES} />);
    type("Zard");
    fireEvent.click(screen.getByRole("button", { name: "Create deck" }));
    await waitFor(() => expect(createDeck).toHaveBeenCalledWith("pokemon", "Zard"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/decks/mine/12"));
  });

  it("sends the game the user switched to", async () => {
    render(<NewDeckForm games={GAMES} />);
    fireEvent.click(screen.getByRole("button", { name: "Riftbound" }));
    expect(screen.getByRole("button", { name: "Riftbound" })).toHaveAttribute("aria-pressed", "true");
    type("Ornn ramp");
    fireEvent.click(screen.getByRole("button", { name: "Create deck" }));
    await waitFor(() => expect(createDeck).toHaveBeenCalledWith("riftbound", "Ornn ramp"));
  });

  it("shows the action's error and stays put", async () => {
    createDeck.mockResolvedValueOnce({ ok: false, error: "Deck name must be 1–80 characters" });
    render(<NewDeckForm games={GAMES} />);
    type("Zard");
    fireEvent.click(screen.getByRole("button", { name: "Create deck" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Deck name must be 1–80 characters"));
    expect(push).not.toHaveBeenCalled();
  });

  it("cannot be submitted without a name", () => {
    render(<NewDeckForm games={GAMES} />);
    expect(screen.getByRole("button", { name: "Create deck" })).toBeDisabled();
    type("   ");
    expect(screen.getByRole("button", { name: "Create deck" })).toBeDisabled();
    type("Zard");
    expect(screen.getByRole("button", { name: "Create deck" })).toBeEnabled();
  });
});
