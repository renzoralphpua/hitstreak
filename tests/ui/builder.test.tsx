// @vitest-environment jsdom
// The deck builder's interaction: zones, quantity steppers, live legality, and the save round-trip.
// The action module, Next's router and /api/search are mocked, as in add-item-dialog.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { DeckDetail, DeckLine } from "@/lib/decks/data";

const { saveDeck, refresh } = vi.hoisted(() => ({ saveDeck: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/decks/actions", () => ({ saveDeckAction: saveDeck }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import Builder from "@/app/(app)/decks/mine/[id]/Builder";

const line = (over: Partial<DeckLine> & { cardId: number; name: string }): DeckLine => ({
  zone: "main", quantity: 1, setName: "Obsidian Flames", number: "1/197", rarity: null, imageUrl: null, attrs: {}, market: 1, ...over,
});
const deckOf = (over: Partial<DeckDetail> & { gameSlug: DeckDetail["gameSlug"]; cards: DeckLine[] }): DeckDetail => ({
  id: 7, gameName: "Pokémon", name: "Zard on a budget", archetype: null, tier: null, format: "standard", sourceNote: null,
  isMeta: false, isDraft: true, updatedAt: "2026-09-08T00:00:00.000Z", cardCount: 0, ...over,
});
const hit = (over: { cardId: number; name: string; attrs?: Record<string, string>; setName?: string; number?: string; market?: number }) => ({
  cardId: over.cardId, name: over.name, number: over.number ?? "R04", rarity: null, imageUrl: null,
  setName: over.setName ?? "Origins", gameSlug: "riftbound", attrs: over.attrs ?? {},
  printings: [{ printingId: over.cardId * 10, subtype: "Normal", market: over.market ?? 0.5, priceDate: "2026-09-07" }],
});

const POKEMON = deckOf({
  gameSlug: "pokemon",
  cards: [
    line({ cardId: 1, name: "Charmander", quantity: 4, attrs: { "Card Type": "Fire", HP: "70", Stage: "Basic" }, market: 0.9 }),
    line({ cardId: 3, name: "Rare Candy", quantity: 5, attrs: { "Card Type": "Trainer - Item" }, market: 1.6 }),
  ],
});
const RIFTBOUND = deckOf({
  gameSlug: "riftbound", gameName: "Riftbound", name: "Renekton aggro", format: null,
  cards: [
    line({ cardId: 11, name: "Renekton, Butcher of the Sands", zone: "legend", setName: "Origins", number: "141/166", attrs: { "Card Type": "Legend", Tag: "Renekton", Domain: "Fury;Body" }, market: 12 }),
    line({ cardId: 12, name: "Rampage", quantity: 3, setName: "Origins", number: "020/166", attrs: { "Card Type": "Spell", Domain: "Fury" }, market: 2 }),
    line({ cardId: 13, name: "Body Rune", quantity: 11, zone: "rune", setName: "Origins", number: "R04", attrs: { "Card Type": "Rune", Domain: "Body" }, market: 0.5 }),
  ],
});
const ONE_PIECE = deckOf({
  gameSlug: "one-piece", gameName: "One Piece Card Game", name: "Red Luffy", format: null,
  cards: [
    line({ cardId: 21, name: "Monkey.D.Luffy", zone: "leader", setName: "Two Legends", number: "OP01-003", attrs: { CardType: "Leader", Color: "Red", Number: "OP01-003" }, market: 3 }),
    line({ cardId: 22, name: "Nami", quantity: 4, setName: "Two Legends", number: "OP01-016", attrs: { CardType: "Character", Color: "Blue", Number: "OP01-016" }, market: 2.5 }),
  ],
});

let hits: ReturnType<typeof hit>[] = [];
beforeEach(() => {
  saveDeck.mockReset().mockResolvedValue({ ok: true, data: { valid: true, errors: [] } });
  refresh.mockReset();
  hits = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ hits }) })));
});

const search = (q: string) => fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });
const groupLabels = () => screen.getAllByText(/^(Main deck|Leader|Legend|Chosen champion|Runes|Battlefields)$/).map((el) => el.parentElement!);

describe("Builder", () => {
  it("renders the deck grouped by the game's zones, each with its subtotal", () => {
    render(<Builder deck={RIFTBOUND} owned={{ "name:body rune": 11 }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Renekton aggro" })).toBeInTheDocument();
    expect(screen.getByText("Riftbound · no format")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← My decks" })).toHaveAttribute("href", "/decks/mine");

    // Zones in ZONES order, empty ones (Chosen champion, Battlefields) left out.
    expect(groupLabels().map((el) => el.textContent)).toEqual(["Legend1", "Main deck3", "Runes11"]);

    // Ownership is allocated per line: 11 Body Runes owned, nothing else.
    const runes = screen.getByText("Runes").closest("div")!.parentElement!;
    expect(within(runes).getByText("own 11")).toHaveClass("text-gain");
    const main = screen.getByText("Main deck").closest("div")!.parentElement!;
    expect(within(main).getByText("own 0")).toHaveClass("text-accent");
    expect(within(main).getByText("Rampage")).toHaveTextContent("Origins · 020/166");
  });

  it("adds a search hit to the zone its card type says", async () => {
    hits = [hit({ cardId: 99, name: "Fury Rune", attrs: { "Card Type": "Rune", Domain: "Fury" } })];
    render(<Builder deck={RIFTBOUND} owned={{}} />);
    search("rune");
    fireEvent.click(await screen.findByRole("button", { name: /Fury Rune/ }));
    await waitFor(() => expect(groupLabels().map((el) => el.textContent)).toEqual(["Legend1", "Main deck3", "Runes12"]));
    const runes = screen.getByText("Runes").closest("div")!.parentElement!;
    expect(within(runes).getByText("Fury Rune")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("passes the game to the search endpoint and shows what the user owns of a hit", async () => {
    hits = [hit({ cardId: 99, name: "Fury Rune", attrs: { "Card Type": "Rune" } })];
    render(<Builder deck={RIFTBOUND} owned={{ "name:fury rune": 2 }} />);
    search("fury");
    const row = await screen.findByRole("button", { name: /Fury Rune/ });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/search?q=fury&game=riftbound");
    expect(row).toHaveTextContent("Origins · R04 · own 2 · $0.50");
  });

  it("replaces what is in a one-card zone", async () => {
    hits = [hit({ cardId: 30, name: "Kaido", setName: "Two Legends", number: "OP01-001", attrs: { CardType: "Leader", Color: "Purple", Number: "OP01-001" }, market: 8 })];
    render(<Builder deck={ONE_PIECE} owned={{}} />);
    search("kaido");
    fireEvent.click(await screen.findByRole("button", { name: /Kaido/ }));
    const leader = await waitFor(() => screen.getByText("Leader").closest("div")!.parentElement!);
    expect(within(leader).getByText("Kaido")).toBeInTheDocument();
    expect(within(leader).queryByText("Monkey.D.Luffy")).not.toBeInTheDocument();
    expect(groupLabels().map((el) => el.textContent)).toEqual(["Leader1", "Main deck4"]);
  });

  it("bumps a line with + and drops it when − takes it below one", () => {
    render(<Builder deck={POKEMON} owned={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add one Charmander" }));
    expect(groupLabels().map((el) => el.textContent)).toEqual(["Main deck10"]);
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Remove one Charmander" }));
    expect(screen.queryByText("Charmander")).not.toBeInTheDocument();
    expect(groupLabels().map((el) => el.textContent)).toEqual(["Main deck5"]);
  });

  it("validates live, spelling out the rule that breaks and clearing it when it is fixed", () => {
    render(<Builder deck={POKEMON} owned={{}} />);
    const legality = screen.getByText("Legality").parentElement!;
    const failing = () => Array.from(legality.querySelectorAll('li[data-ok="false"]')).map((li) => li.textContent);
    expect(failing()).toEqual([expect.stringContaining("9"), "Rare Candy: 5 copies (max 4)"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove one Rare Candy" }));
    expect(failing()).toEqual([expect.stringContaining("8")]); // only the 60-card rule is left
    expect(legality).toHaveTextContent("No more than 4 of a card (Basic Energy excepted)");
  });

  it("keeps the cost panel in step with the deck", () => {
    render(<Builder deck={POKEMON} owned={{ "name:charmander": 4 }} />);
    expect(screen.getByText("Cards").nextElementSibling).toHaveTextContent("9");
    expect(screen.getByText("You own").nextElementSibling).toHaveTextContent("4 / 9");
    expect(screen.getByText("Cost to complete").nextElementSibling).toHaveTextContent("$8.00"); // 5 × $1.60
  });

  it("saves the current lines and reports the server's verdict", async () => {
    saveDeck.mockResolvedValue({ ok: true, data: { valid: false, errors: [{ code: "size", message: "…" }] } });
    render(<Builder deck={POKEMON} owned={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove one Rare Candy" }));
    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() =>
      expect(saveDeck).toHaveBeenCalledWith(7, [
        { cardId: 1, zone: "main", quantity: 4 },
        { cardId: 3, zone: "main", quantity: 4 },
      ])
    );
    await waitFor(() => expect(screen.getByText("Saved as draft")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("says so when the server accepts the deck", async () => {
    render(<Builder deck={POKEMON} owned={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => expect(screen.getByText("Saved · legal")).toBeInTheDocument());
  });

  it("shows a failed save as an alert and keeps the deck dirty", async () => {
    saveDeck.mockResolvedValue({ ok: false, error: "Deck not found" });
    render(<Builder deck={POKEMON} owned={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add one Charmander" }));
    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Deck not found"));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
