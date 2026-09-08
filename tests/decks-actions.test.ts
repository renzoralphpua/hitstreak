import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-actions");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { listMyDecks, getDeck, upsertMetaDeck, type DeckLineInput } from "@/lib/decks/data";

// The session and Next's cache are the two things a server action reaches for that a plain
// node test can't provide. Importing actions.ts here is fine: "use server" is inert in vitest.
const { getSession, revalidatePath } = vi.hoisted(() => ({ getSession: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { createDeckAction, renameDeckAction, deleteDeckAction, saveDeckAction, copyDeckAction } from "@/app/(app)/decks/actions";

const ADMIN = "admin_1", U1 = "user_1", U2 = "user_2";
const signedIn = (id: string) => getSession.mockResolvedValue({ user: { id } });

let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
let charmanderId: number; // the fixtures' only Basic Pokémon
let metaId: number;

/** 4 Charmander + 3 Charizard ex + 4 Rare Candy + 49 Basic Fire Energy = a legal 60. */
const legal60 = (): DeckLineInput[] => [
  { cardId: charmanderId, zone: "main", quantity: 4 },
  { cardId: f.cards.charizardEx, zone: "main", quantity: 3 },
  { cardId: f.cards.rareCandyObf, zone: "main", quantity: 4 },
  { cardId: f.cards.fireEnergy, zone: "main", quantity: 49 },
];
const isDraftOf = async (id: number) =>
  Number((await (await db()).execute({ sql: "SELECT is_draft FROM decks WHERE id = ?", args: [id] })).rows[0].is_draft);
const newDeck = async (owner: string, name: string) => {
  signedIn(owner);
  const r = await createDeckAction("pokemon", name);
  if (!r.ok) throw new Error(r.error);
  return r.data as number;
};

beforeAll(async () => {
  await seedMiniCatalog();
  f = await seedDeckFixtures();
  const c = await db();
  charmanderId = Number((await c.execute({
    sql: "INSERT INTO cards (set_id, tcgplayer_product_id, name, number, rarity, image_url, attrs) VALUES (?, 3020, 'Charmander', '026/197', 'Common', NULL, ?) RETURNING id",
    args: [f.sets.obsidian, JSON.stringify({ "Card Type": "Fire", HP: "70", Stage: "Basic" })],
  })).rows[0].id);
  await c.execute({ sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAdmin) VALUES (?, 'Admin', 'admin@example.com', 0, '2026-09-01', '2026-09-01', 1)`, args: [ADMIN] });
  metaId = await upsertMetaDeck(ADMIN, {
    gameSlug: "pokemon", name: "Charizard ex / Pidgeot", tier: 1,
    lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 3 }, { cardId: f.cards.rareCandyObf, zone: "main", quantity: 4 }],
  });
});
afterAll(() => { closeDb(); tmp.clean(); });
beforeEach(() => { getSession.mockReset(); revalidatePath.mockReset(); });

describe("deck server actions", () => {
  it("refuses everything when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await createDeckAction("pokemon", "Zard")).toEqual({ ok: false, error: "Not signed in" });
    expect(await renameDeckAction(1, "Zard")).toEqual({ ok: false, error: "Not signed in" });
    expect(await deleteDeckAction(1)).toEqual({ ok: false, error: "Not signed in" });
    expect(await saveDeckAction(1, [])).toEqual({ ok: false, error: "Not signed in" });
    expect(await copyDeckAction(1)).toEqual({ ok: false, error: "Not signed in" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects ids that aren't positive integers before they reach the data layer", async () => {
    signedIn(U1);
    expect(await renameDeckAction(NaN as never, "x")).toEqual({ ok: false, error: "Invalid id" });
    expect(await deleteDeckAction(-1)).toEqual({ ok: false, error: "Invalid id" });
    expect(await saveDeckAction(1.5, [])).toEqual({ ok: false, error: "Invalid id" });
    expect(await copyDeckAction("3" as never)).toEqual({ ok: false, error: "Invalid id" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a game it doesn't know", async () => {
    signedIn(U1);
    expect(await createDeckAction("yugioh", "Blue-Eyes")).toEqual({ ok: false, error: "Unknown game" });
  });

  it("creates, renames and deletes the caller's own deck", async () => {
    const id = await newDeck(U1, "Zard on a budget");
    expect(revalidatePath).toHaveBeenCalledWith("/decks/mine");
    expect((await listMyDecks(U1)).map((d) => d.name)).toContain("Zard on a budget");

    expect(await renameDeckAction(id, "Zard, fixed")).toEqual({ ok: true, data: undefined });
    expect(revalidatePath).toHaveBeenCalledWith(`/decks/mine/${id}`);
    expect((await getDeck(id, U1))?.name).toBe("Zard, fixed");

    expect(await deleteDeckAction(id)).toEqual({ ok: true, data: undefined });
    expect(await getDeck(id, U1)).toBeNull();
  });

  it("hides another user's deck behind the same 'Deck not found'", async () => {
    const id = await newDeck(U1, "Mine alone");
    signedIn(U2);
    expect(await renameDeckAction(id, "Yours now")).toEqual({ ok: false, error: "Deck not found" });
    expect(await deleteDeckAction(id)).toEqual({ ok: false, error: "Deck not found" });
    expect(await saveDeckAction(id, legal60())).toEqual({ ok: false, error: "Deck not found" });
    expect(await copyDeckAction(id)).toEqual({ ok: false, error: "Deck not found" });
    expect((await getDeck(id, U1))?.name).toBe("Mine alone");
  });

  it("will not let a user save over a curated deck", async () => {
    signedIn(U1);
    expect(await saveDeckAction(metaId, legal60())).toEqual({ ok: false, error: "Deck not found" });
    expect((await getDeck(metaId, null))?.cardCount).toBe(7);
  });

  it("saves a legal 60 as legal, validating from the catalog's own attrs", async () => {
    const id = await newDeck(U1, "Legal");
    const r = await saveDeckAction(id, legal60());
    expect(r).toEqual({ ok: true, data: { valid: true, errors: [] } });
    expect(await isDraftOf(id)).toBe(0);
    const deck = await getDeck(id, U1);
    expect(deck?.cardCount).toBe(60);
    expect(deck?.isDraft).toBe(false);
  });

  it("saves a deck that breaks a rule as a draft and hands back the errors", async () => {
    const id = await newDeck(U1, "One short");
    const lines = legal60();
    lines[3].quantity = 48; // 59 cards
    const r = await saveDeckAction(id, lines);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.data?.valid).toBe(false);
    expect(r.data?.errors.map((e) => e.code)).toEqual(["size"]);
    expect(r.data?.errors[0].message).toMatch(/59/);
    expect(await isDraftOf(id)).toBe(1);
    expect((await getDeck(id, U1))?.cardCount).toBe(59);
  });

  it("refuses lines in a zone this game doesn't use", async () => {
    const id = await newDeck(U1, "Wrong zone");
    const r = await saveDeckAction(id, [{ cardId: f.cards.charizardEx, zone: "leader", quantity: 1 }]);
    expect(r).toEqual({ ok: false, error: 'Zone "leader" is not used by this game' });
    expect((await getDeck(id, U1))?.cardCount).toBe(0);
  });

  it("copies a curated deck into a new personal deck and leaves the source alone", async () => {
    signedIn(U1);
    const r = await copyDeckAction(metaId);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const copy = await getDeck(r.data as number, U1);
    expect(copy?.name).toBe("Charizard ex / Pidgeot (copy)");
    expect(copy?.isMeta).toBe(false);
    expect(copy?.isDraft).toBe(true); // 7 cards, no Basic Pokémon → not legal
    expect(copy?.cards.map((l) => [l.name, l.zone, l.quantity])).toEqual([
      ["Charizard ex", "main", 3], ["Rare Candy", "main", 4],
    ]);
    const source = await getDeck(metaId, null);
    expect(source?.name).toBe("Charizard ex / Pidgeot");
    expect(source?.cardCount).toBe(7);
    expect(await getDeck(r.data as number, U2)).toBeNull();
  });
});
