// @vitest-environment jsdom
// The admin curation flow: paste → resolve → fix up → save. The action module, Next's router and
// /api/search are mocked, as in builder.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { Resolution } from "@/lib/decks/decklist";
import type { EditDeckDetail } from "@/app/(app)/admin/decks/edit-event";
import { EDIT_EVENT } from "@/app/(app)/admin/decks/edit-event";

const { resolveDecklist, saveMetaDeck, deleteMetaDeck, refresh } = vi.hoisted(() => ({
  resolveDecklist: vi.fn(), saveMetaDeck: vi.fn(), deleteMetaDeck: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/app/(app)/admin/decks/actions", () => ({
  resolveDecklistAction: resolveDecklist,
  saveMetaDeckAction: saveMetaDeck,
  deleteMetaDeckAction: deleteMetaDeck,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import CurationForm from "@/app/(app)/admin/decks/CurationForm";
import MetaDeckRow from "@/app/(app)/admin/decks/MetaDeckRow";
import type { DeckSummary } from "@/lib/decks/data";

const GAMES = [
  { slug: "pokemon", name: "Pokémon" },
  { slug: "one-piece", name: "One Piece Card Game" },
  { slug: "riftbound", name: "Riftbound" },
];

const res = (over: Partial<Resolution> & { text: string; quantity: number }): Resolution => ({
  line: { raw: `${over.quantity} ${over.text}`, quantity: over.quantity, text: over.text, zone: over.line?.zone ?? "main" },
  cardId: over.cardId ?? null,
  candidates: over.candidates ?? [],
});
const candidate = (cardId: number, name: string) => ({ cardId, name, setName: "Obsidian Flames", number: "125/197" });

let hits: Array<{ cardId: number; name: string; setName: string; number: string; rarity: null; imageUrl: null; attrs: Record<string, string>; printings: [] }> = [];

beforeEach(() => {
  resolveDecklist.mockReset().mockResolvedValue({ ok: true, data: [] });
  saveMetaDeck.mockReset().mockResolvedValue({ ok: true, data: 42 });
  deleteMetaDeck.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
  hits = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ hits }) })));
});

const paste = (text: string) => fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: text } });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const resolveBtn = () => screen.getByRole("button", { name: "Resolve" });
const saveBtn = () => screen.getByRole("button", { name: /^Save/ });
const rows = () => screen.getAllByRole("listitem");

describe("CurationForm — resolve", () => {
  it("sends the pasted list for the selected game and renders one row per line", async () => {
    resolveDecklist.mockResolvedValueOnce({
      ok: true,
      data: [res({ text: "Charizard ex", quantity: 3, cardId: 11 }), res({ text: "Rare Candy", quantity: 4, cardId: 12 })],
    });
    render(<CurationForm games={GAMES} />);
    paste("3 Charizard ex\n4 Rare Candy");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(resolveDecklist).toHaveBeenCalledWith("pokemon", "3 Charizard ex\n4 Rare Candy"));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0]).toHaveTextContent("×3");
    expect(rows()[0]).toHaveAttribute("data-resolved", "true");
    expect(rows()[1]).toHaveTextContent("Rare Candy");
  });

  it("sends the game the admin switched to", async () => {
    render(<CurationForm games={GAMES} />);
    fireEvent.click(screen.getByRole("button", { name: "Riftbound" }));
    paste("1 Body Rune");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(resolveDecklist).toHaveBeenCalledWith("riftbound", "1 Body Rune"));
  });

  it("shows the action's error and does not render a fix-up list", async () => {
    resolveDecklist.mockResolvedValueOnce({ ok: false, error: "That list is too long" });
    render(<CurationForm games={GAMES} />);
    paste("x");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That list is too long"));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("cannot resolve an empty paste", () => {
    render(<CurationForm games={GAMES} />);
    expect(resolveBtn()).toBeDisabled();
    paste("   ");
    expect(resolveBtn()).toBeDisabled();
    paste("1 Rare Candy");
    expect(resolveBtn()).toBeEnabled();
  });
});

describe("CurationForm — fix-up", () => {
  const ambiguous = [
    res({ text: "Charizard ex", quantity: 3, cardId: 11 }),
    res({ text: "Charizard", quantity: 2, candidates: [candidate(21, "Charizard ex"), candidate(22, "Charizard VMAX")] }),
  ];

  it("leaves Save disabled until every line has a card, then enables it on a candidate click", async () => {
    resolveDecklist.mockResolvedValueOnce({ ok: true, data: ambiguous });
    render(<CurationForm games={GAMES} />);
    type("Name", "Zard pile");
    paste("3 Charizard ex\n2 Charizard");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(rows()).toHaveLength(2));

    const unresolved = rows()[1];
    expect(unresolved).toHaveAttribute("data-resolved", "false");
    expect(unresolved).toHaveTextContent("needs a card");
    expect(saveBtn()).toBeDisabled();

    fireEvent.click(within(unresolved).getByRole("button", { name: /Charizard VMAX/ }));
    await waitFor(() => expect(saveBtn()).toBeEnabled());
    expect(rows()[1]).toHaveAttribute("data-resolved", "true");
    expect(rows()[1]).toHaveTextContent("Charizard VMAX");
  });

  it("offers a catalog search for a line with no usable candidate", async () => {
    resolveDecklist.mockResolvedValueOnce({ ok: true, data: [res({ text: "Nonesuch", quantity: 1 })] });
    hits = [{ cardId: 77, name: "Nonesuch ex", setName: "Obsidian Flames", number: "1/197", rarity: null, imageUrl: null, attrs: {}, printings: [] }];
    render(<CurationForm games={GAMES} />);
    type("Name", "Mystery");
    paste("1 Nonesuch");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(saveBtn()).toBeDisabled();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nonesuch" } });
    const hit = await screen.findByRole("button", { name: /Nonesuch ex/ }, { timeout: 3000 });
    fireEvent.click(hit);
    await waitFor(() => expect(saveBtn()).toBeEnabled());
  });

  it("labels the zone when the game uses more than one", async () => {
    resolveDecklist.mockResolvedValueOnce({
      ok: true,
      data: [
        { line: { raw: "1 Monkey.D.Luffy", quantity: 1, text: "Monkey.D.Luffy", zone: "leader" }, cardId: 31, candidates: [] },
        { line: { raw: "4 Nami", quantity: 4, text: "Nami", zone: "main" }, cardId: 32, candidates: [] },
      ] satisfies Resolution[],
    });
    render(<CurationForm games={GAMES} />);
    fireEvent.click(screen.getByRole("button", { name: "One Piece Card Game" }));
    paste("Leader:\n1 Monkey.D.Luffy\nMain:\n4 Nami");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0]).toHaveTextContent("Leader");
    expect(rows()[1]).toHaveTextContent("Main deck");
  });
});

describe("CurationForm — save", () => {
  const twoOfTheSameCard = [
    res({ text: "Rare Candy SVI 191", quantity: 3, cardId: 12 }),
    res({ text: "Rare Candy OBF 191", quantity: 1, cardId: 12 }),
    res({ text: "Charizard ex", quantity: 2, cardId: 11 }),
  ];

  it("sends the merged lines and the metadata from the fields", async () => {
    resolveDecklist.mockResolvedValueOnce({ ok: true, data: twoOfTheSameCard });
    render(<CurationForm games={GAMES} />);
    type("Name", "Zard pile");
    type("Archetype", "Charizard ex");
    type("Format", "standard");
    type("Source", "Regionals");
    fireEvent.click(screen.getByRole("button", { name: "Tier 2" }));
    paste("3 Rare Candy SVI 191\n1 Rare Candy OBF 191\n2 Charizard ex");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.click(saveBtn());
    await waitFor(() => expect(saveMetaDeck).toHaveBeenCalledTimes(1));
    expect(saveMetaDeck).toHaveBeenCalledWith({
      id: undefined, gameSlug: "pokemon", name: "Zard pile", archetype: "Charizard ex", tier: 2,
      format: "standard", sourceNote: "Regionals",
      lines: [
        { cardId: 12, zone: "main", quantity: 4 }, // the two Rare Candy printings summed
        { cardId: 11, zone: "main", quantity: 2 },
      ],
    });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue(""); // a new deck clears the form
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("sends a human's pick rather than the resolver's null", async () => {
    resolveDecklist.mockResolvedValueOnce({
      ok: true,
      data: [res({ text: "Charizard", quantity: 2, candidates: [candidate(21, "Charizard ex")] })],
    });
    render(<CurationForm games={GAMES} />);
    type("Name", "Picked");
    paste("2 Charizard");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(within(rows()[0]).getByRole("button", { name: /Charizard ex/ }));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(saveMetaDeck).toHaveBeenCalled());
    expect(saveMetaDeck.mock.calls[0][0].lines).toEqual([{ cardId: 21, zone: "main", quantity: 2 }]);
  });

  it("renders the action's error and leaves Save available", async () => {
    resolveDecklist.mockResolvedValueOnce({ ok: true, data: [res({ text: "Charizard ex", quantity: 3, cardId: 11 })] });
    saveMetaDeck.mockResolvedValueOnce({ ok: false, error: "Admins only" });
    render(<CurationForm games={GAMES} />);
    type("Name", "Nope");
    paste("3 Charizard ex");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Admins only"));
    expect(saveBtn()).toBeEnabled();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("needs a name as well as resolved lines", async () => {
    resolveDecklist.mockResolvedValueOnce({ ok: true, data: [res({ text: "Charizard ex", quantity: 3, cardId: 11 })] });
    render(<CurationForm games={GAMES} />);
    paste("3 Charizard ex");
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(saveBtn()).toBeDisabled();
    type("Name", "Named now");
    expect(saveBtn()).toBeEnabled();
  });
});

describe("CurationForm — editing an existing deck", () => {
  const detail: EditDeckDetail = {
    id: 9, gameSlug: "one-piece", name: "Red Luffy", archetype: "Rush", tier: 1,
    format: "standard", sourceNote: "Regionals", decklist: "Leader:\n1 Monkey.D.Luffy\n\nMain:\n4 Nami",
  };

  it("fills the fields from the edit event and sends the deck's id on save", async () => {
    render(<CurationForm games={GAMES} />);
    fireEvent(window, new CustomEvent(EDIT_EVENT, { detail }));

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Red Luffy"));
    expect(screen.getByLabelText("Archetype")).toHaveValue("Rush");
    expect(screen.getByLabelText("Format")).toHaveValue("standard");
    expect(screen.getByLabelText("Source")).toHaveValue("Regionals");
    expect(screen.getByLabelText("Decklist")).toHaveValue(detail.decklist);
    expect(screen.getByRole("button", { name: "Tier 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "One Piece Card Game" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Editing deck #9")).toBeInTheDocument();

    resolveDecklist.mockResolvedValueOnce({
      ok: true,
      data: [{ line: { raw: "4 Nami", quantity: 4, text: "Nami", zone: "main" }, cardId: 32, candidates: [] }] satisfies Resolution[],
    });
    fireEvent.click(resolveBtn());
    await waitFor(() => expect(resolveDecklist).toHaveBeenCalledWith("one-piece", detail.decklist));
    await waitFor(() => expect(rows()).toHaveLength(1));

    fireEvent.click(saveBtn());
    await waitFor(() => expect(saveMetaDeck).toHaveBeenCalled());
    expect(saveMetaDeck.mock.calls[0][0]).toMatchObject({ id: 9, gameSlug: "one-piece", name: "Red Luffy", tier: 1 });
    // editing keeps the deck loaded rather than clearing the form
    expect(screen.getByLabelText("Name")).toHaveValue("Red Luffy");
  });

  it("Stop editing clears the id and the fields", async () => {
    render(<CurationForm games={GAMES} />);
    fireEvent(window, new CustomEvent(EDIT_EVENT, { detail }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Red Luffy"));
    fireEvent.click(screen.getByRole("button", { name: "Stop editing" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Decklist")).toHaveValue("");
    expect(screen.getByText("Curate a deck")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop editing" })).not.toBeInTheDocument();
  });
});

describe("MetaDeckRow", () => {
  const DECK: DeckSummary = {
    id: 9, gameSlug: "one-piece", gameName: "One Piece Card Game", name: "Red Luffy", archetype: "Rush",
    tier: 1, format: "standard", sourceNote: "Regionals", isMeta: true, isDraft: false,
    updatedAt: "2026-09-08T00:00:00.000Z", cardCount: 51,
  };
  const DECKLIST = "Leader:\n1 Monkey.D.Luffy\n\nMain:\n4 Nami";

  it("shows the deck's shape and its tier badge", () => {
    render(<MetaDeckRow deck={DECK} decklist={DECKLIST} />);
    expect(screen.getByText("Red Luffy")).toBeInTheDocument();
    expect(screen.getByText(/One Piece Card Game/)).toHaveTextContent("51");
    expect(screen.getByText("Tier 1")).toBeInTheDocument();
  });

  it("Edit hands the deck to a CurationForm rendered beside it", async () => {
    render(
      <>
        <CurationForm games={GAMES} />
        <MetaDeckRow deck={DECK} decklist={DECKLIST} />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Red Luffy"));
    expect(screen.getByLabelText("Decklist")).toHaveValue(DECKLIST);
    expect(screen.getByText("Editing deck #9")).toBeInTheDocument();
  });

  it("Delete asks first: cancelling calls nothing, confirming deletes and refreshes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MetaDeckRow deck={DECK} decklist={DECKLIST} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith('Delete "Red Luffy"?');
    expect(deleteMetaDeck).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteMetaDeck).toHaveBeenCalledWith(9));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    confirm.mockRestore();
  });

  it("renders the action's refusal as an alert", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteMetaDeck.mockResolvedValueOnce({ ok: false, error: "Admins only" });
    render(<MetaDeckRow deck={DECK} decklist={DECKLIST} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Admins only"));
    expect(refresh).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
