// @vitest-environment jsdom
// The two deck Server Components rendered end to end against a throwaway database: seeded catalog +
// deck fixtures, three curated Pokémon decks, and one user's binders. Only the session and Next's
// navigation helpers are mocked (a plain vitest process has neither).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { tmpDb } from "../helpers/tmpdb";
const tmp = tmpDb("deck-pages");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "../helpers/seed";
import { seedDeckFixtures } from "../helpers/decks";
import { createPortfolio, addItem } from "@/lib/portfolios";
import { upsertMetaDeck, createDeck, saveDeckCards } from "@/lib/decks/data";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
// The builder imports the deck actions, which import next/cache; nothing here calls one.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import DecksPage from "@/app/(app)/decks/page";
import DeckDetailPage, { generateMetadata } from "@/app/(app)/decks/[id]/page";
import MyDecksPage from "@/app/(app)/decks/mine/page";
import BuilderPage, { generateMetadata as builderMetadata } from "@/app/(app)/decks/mine/[id]/page";

const ADMIN = "admin_1", U = "user_1", U2 = "user_2";
let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
let zardId: number, candyId: number, energyId: number, mineId: number, notMineId: number;

const browser = (game?: string) => DecksPage({ params: Promise.resolve({}), searchParams: Promise.resolve(game ? { game } : {}) });
const detail = (id: string) => DeckDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
const builder = (id: string) => BuilderPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

beforeAll(async () => {
  await seedMiniCatalog();
  f = await seedDeckFixtures();
  const c = await db();
  await c.execute({ sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAdmin) VALUES (?, 'Admin', 'admin@example.com', 0, '2026-09-01', '2026-09-01', 1)`, args: [ADMIN] });
  zardId = await upsertMetaDeck(ADMIN, {
    gameSlug: "pokemon", name: "Charizard ex / Pidgeot", archetype: "Charizard ex", tier: 1, format: "standard", sourceNote: "Regional top cuts, Aug 30",
    lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 3 }, { cardId: f.cards.rareCandyObf, zone: "main", quantity: 4 }, { cardId: f.cards.fireEnergy, zone: "main", quantity: 10 }],
  });
  candyId = await upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "Candy Toolbox", tier: 2, lines: [{ cardId: f.cards.rareCandySvi, zone: "main", quantity: 4 }] });
  energyId = await upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "Energy Pile", lines: [{ cardId: f.cards.fireEnergy, zone: "main", quantity: 2 }] });
  const a = await createPortfolio(U, "A"), b = await createPortfolio(U, "B");
  await addItem(U, a.id, { printingId: f.printings.rareCandySvi, quantity: 2, condition: "NM" }); // "Rare Candy - 191/198" → Rare Candy
  await addItem(U, b.id, { printingId: f.printings.rareCandyObf, quantity: 1, condition: "LP" });
  await addItem(U, a.id, { printingId: f.printings.fireEnergy, quantity: 2, condition: "NM" });
  mineId = await createDeck(U, { gameSlug: "pokemon", name: "Zard on a budget" });
  await saveDeckCards(U, mineId, [{ cardId: f.cards.rareCandyObf, zone: "main", quantity: 4 }], true);
  notMineId = await createDeck(U2, { gameSlug: "pokemon", name: "Someone else's" });
  getSession.mockResolvedValue({ user: { id: U } });
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("/decks", () => {
  it("groups curated decks by tier with each deck's gap against the user's binders", async () => {
    render(await browser("pokemon"));
    expect(screen.getByRole("heading", { level: 1, name: "Meta decks" })).toBeInTheDocument();
    expect(screen.getByText("3 curated for Pokémon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pokémon" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Riftbound" })).toHaveAttribute("href", "/decks?game=riftbound");

    // Group labels in tier order, untiered last; "Tier 1" also appears as the badge inside the deck.
    const labels = screen.getAllByText(/^(Tier \d|Other)$/).filter((el) => el.className.includes("tracking-[0.06em]"));
    expect(labels.map((el) => el.textContent)).toEqual(["Tier 1", "Tier 2", "Other"]);

    const zard = screen.getByRole("link", { name: /Charizard ex \/ Pidgeot/ });
    expect(zard).toHaveAttribute("href", `/decks/${zardId}`);
    expect(zard).toHaveTextContent("You own 5 / 17"); // 3 Rare Candy + 2 Basic Fire Energy
    expect(zard).toHaveTextContent("$59.10 to complete"); // 3×18.90 + 1×1.60 + 8×0.10

    const candy = screen.getByRole("link", { name: /Candy Toolbox/ });
    expect(candy).toHaveAttribute("href", `/decks/${candyId}`);
    expect(candy).toHaveTextContent("You own 3 / 4"); // the same 3 Rare Candy count against every deck
    expect(candy).toHaveTextContent("$0.80 to complete");

    const energy = screen.getByRole("link", { name: /Energy Pile/ });
    expect(energy).toHaveAttribute("href", `/decks/${energyId}`);
    expect(energy).toHaveTextContent("Complete");
    expect(within(energy).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("shows the empty state for a game with no curated decks", async () => {
    render(await browser("riftbound"));
    expect(screen.getByText("0 curated for Riftbound")).toBeInTheDocument();
    expect(screen.getByText("No curated decks yet")).toBeInTheDocument();
    expect(screen.getByText("Meta decks for Riftbound appear here once they are curated.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("falls back to Pokémon for a slug that is not a game", async () => {
    render(await browser("yugioh"));
    expect(screen.getByText("3 curated for Pokémon")).toBeInTheDocument();
  });

  it("redirects to sign-in without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(browser()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });
});

describe("/decks/[id]", () => {
  it("shows the stat tiles, the missing cards priciest first, the full list by zone and the legality rules", async () => {
    render(await detail(String(zardId)));
    expect(screen.getByRole("heading", { level: 1, name: "Charizard ex / Pidgeot" })).toBeInTheDocument();
    expect(screen.getByText("Pokémon · Tier 1 · standard · curated from Regional top cuts, Aug 30")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Meta decks" })).toHaveAttribute("href", "/decks?game=pokemon");

    expect(screen.getByText("You own").nextElementSibling).toHaveTextContent("5 / 17");
    expect(screen.getByText("Missing").nextElementSibling).toHaveTextContent("12 cards");
    expect(screen.getByText("Cost to complete").nextElementSibling).toHaveTextContent("$59.10");

    // Missing list: Charizard ×3 ($56.70) before Rare Candy ×1 ($1.60) before Basic Fire Energy ×8 ($0.80)
    const missing = screen.getByText("Missing cards").closest("div")!.parentElement!.querySelector("ul")!;
    const rows = within(missing).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Charizard ex"), expect.stringContaining("Rare Candy"), expect.stringContaining("Basic Fire Energy"),
    ]);
    expect(rows[0]).toHaveTextContent("Obsidian Flames · 125/197");
    expect(rows[0]).toHaveTextContent("×3");
    expect(rows[0]).toHaveTextContent("$56.70");
    expect(rows[1]).toHaveTextContent("×1");
    expect(rows[1]).toHaveTextContent("$1.60");
    expect(rows[2]).toHaveTextContent("×8");
    expect(rows[2]).toHaveTextContent("$0.80");

    // Full list: one zone group for Pokémon, every line with its owned-of-quantity state
    expect(screen.getByText("Show full list (17)")).toBeInTheDocument();
    expect(screen.getByText("Main deck")).toBeInTheDocument();
    const full = screen.getByText("Main deck").parentElement!;
    expect(full).toHaveTextContent("×3 Charizard ex");
    expect(full).toHaveTextContent("0 of 3");
    expect(full).toHaveTextContent("×4 Rare Candy");
    expect(full).toHaveTextContent("3 of 4");
    expect(full).toHaveTextContent("×10 Basic Fire Energy");
    expect(full).toHaveTextContent("2 of 10");

    // Legality: 17 cards and no Basic Pokémon fail; copy limits hold (Basic Energy is exempt)
    const legality = screen.getByText("Legality").parentElement!;
    const failed = Array.from(legality.querySelectorAll('li[data-ok="false"]')).map((li) => li.textContent);
    expect(failed).toEqual(["Exactly 60 cards", "At least one Basic Pokémon"]);
    expect(legality.querySelector('li[data-ok="true"]')).toHaveTextContent("No more than 4 of a card (Basic Energy excepted)");
  });

  it("says so when every card is owned", async () => {
    render(await detail(String(energyId)));
    expect(screen.getByText("You own every card in this deck.")).toBeInTheDocument();
    expect(screen.getByText("Missing").nextElementSibling).toHaveTextContent("0 cards");
    expect(screen.getByText("Cost to complete").nextElementSibling).toHaveClass("text-gain");
    expect(screen.getByText("Pokémon")).toBeInTheDocument(); // no tier / format / source → bare game name
    expect(screen.getByText("owned")).toBeInTheDocument();
  });

  it("titles the tab after the deck", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ id: String(candyId) }), searchParams: Promise.resolve({}) })).toEqual({ title: "Candy Toolbox — Hitstreak" });
  });

  it("is not found for a missing id or a malformed segment", async () => {
    await expect(detail("999999")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(detail("abc")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(generateMetadata({ params: Promise.resolve({ id: "999999" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/decks/mine", () => {
  it("lists the caller's own decks with their draft state and the start-a-deck form", async () => {
    render(await MyDecksPage());
    expect(screen.getByRole("heading", { level: 1, name: "My decks" })).toBeInTheDocument();
    expect(screen.getByText("1 deck")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zard on a budget" })).toHaveAttribute("href", `/decks/mine/${mineId}`);
    expect(screen.getByText("4 cards")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Someone else's")).not.toBeInTheDocument(); // U2's deck stays U2's
    expect(screen.getByRole("link", { name: "Meta decks" })).toHaveAttribute("href", "/decks");
    expect(screen.getByRole("button", { name: "Create deck" })).toBeInTheDocument();
  });

  it("redirects to sign-in without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(MyDecksPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });
});

describe("/decks/mine/[id]", () => {
  it("opens the caller's own deck in the builder", async () => {
    render(await builder(String(mineId)));
    expect(screen.getByRole("heading", { level: 1, name: "Zard on a budget" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save deck" })).toBeInTheDocument();
    expect(screen.getByText("Main deck")).toBeInTheDocument();
    expect(screen.getByText("Rare Candy")).toBeInTheDocument();
    expect(screen.getByText("own 3")).toBeInTheDocument(); // 3 Rare Candy across the two binders
    expect(await builderMetadata({ params: Promise.resolve({ id: String(mineId) }), searchParams: Promise.resolve({}) }))
      .toEqual({ title: "Zard on a budget — Hitstreak" });
  });

  it("is not found for a curated deck, someone else's deck, a missing id or a malformed segment", async () => {
    await expect(builder(String(zardId))).rejects.toThrow("NEXT_NOT_FOUND"); // read-only: copy it first
    await expect(builder(String(notMineId))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(builder("999999")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(builder("abc")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("redirects to sign-in without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(builder(String(mineId))).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });
});
