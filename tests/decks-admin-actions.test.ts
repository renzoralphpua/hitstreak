import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-admin-actions");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { listMetaDecks, getDeck, createDeck, saveDeckCards } from "@/lib/decks/data";

// Same shape as tests/decks-actions.test.ts: the session and Next's cache are the only mocks.
const { getSession, revalidatePath } = vi.hoisted(() => ({ getSession: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { resolveDecklistAction, saveMetaDeckAction, deleteMetaDeckAction } from "@/app/(app)/admin/decks/actions";

const ADMIN = "admin_1", USER = "user_1";
const signedIn = (id: string) => getSession.mockResolvedValue({ user: { id } });

let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
let personalId: number;

const lineCount = async (id: number) =>
  Number((await (await db()).execute({ sql: "SELECT COUNT(*) AS n FROM deck_cards WHERE deck_id = ?", args: [id] })).rows[0].n);

/** An admin-owned meta deck to operate on, created through the action itself. */
async function makeDeck(name: string) {
  signedIn(ADMIN);
  const r = await saveMetaDeckAction({
    gameSlug: "pokemon", name, tier: 1,
    lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 3 }, { cardId: f.cards.fireEnergy, zone: "main", quantity: 10 }],
  });
  if (!r.ok) throw new Error(r.error);
  return r.data as number;
}

beforeAll(async () => {
  await seedMiniCatalog();
  f = await seedDeckFixtures();
  const c = await db();
  await c.execute({
    sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAdmin) VALUES (?, 'Admin', 'admin@example.com', 0, '2026-09-01', '2026-09-01', 1), (?, 'User', 'u1@example.com', 0, '2026-09-01', '2026-09-01', 0)`,
    args: [ADMIN, USER],
  });
  personalId = await createDeck(USER, { gameSlug: "pokemon", name: "Mine" });
  await saveDeckCards(USER, personalId, [{ cardId: f.cards.fireEnergy, zone: "main", quantity: 4 }], true);
});
afterAll(() => { closeDb(); tmp.clean(); });
beforeEach(() => { getSession.mockReset(); revalidatePath.mockReset(); });

describe("admin curation actions — the gate", () => {
  it("refuses everything when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await resolveDecklistAction("pokemon", "4 Rare Candy")).toEqual({ ok: false, error: "Not signed in" });
    expect(await saveMetaDeckAction({ gameSlug: "pokemon", name: "Sneaky", lines: [] })).toEqual({ ok: false, error: "Not signed in" });
    expect(await deleteMetaDeckAction(1)).toEqual({ ok: false, error: "Not signed in" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a signed-in non-admin with \"Admins only\" and writes nothing", async () => {
    const id = await makeDeck("Guarded");
    const before = (await listMetaDecks("pokemon")).length;
    revalidatePath.mockReset(); // makeDeck's own (legitimate) save revalidated

    signedIn(USER);
    expect(await resolveDecklistAction("pokemon", "4 Rare Candy")).toEqual({ ok: false, error: "Admins only" });
    expect(await saveMetaDeckAction({ gameSlug: "pokemon", name: "Sneaky", lines: [] })).toEqual({ ok: false, error: "Admins only" });
    expect(await saveMetaDeckAction({ id, gameSlug: "pokemon", name: "Hijacked", lines: [] })).toEqual({ ok: false, error: "Admins only" });
    expect(await deleteMetaDeckAction(id)).toEqual({ ok: false, error: "Admins only" });

    expect((await listMetaDecks("pokemon")).length).toBe(before); // nothing created, nothing deleted
    const still = await getDeck(id, null);
    expect(still?.name).toBe("Guarded"); // nothing renamed
    expect(await lineCount(id)).toBe(2); // nothing re-lined
    expect(revalidatePath).not.toHaveBeenCalled();

    signedIn(ADMIN);
    expect(await deleteMetaDeckAction(id)).toEqual({ ok: true, data: undefined });
  });

  it("refuses a user id that has no row in \"user\" at all", async () => {
    signedIn("ghost_9");
    expect(await saveMetaDeckAction({ gameSlug: "pokemon", name: "Ghost deck", lines: [] })).toEqual({ ok: false, error: "Admins only" });
  });
});

describe("resolveDecklistAction", () => {
  it("returns one resolution per parsed line, with candidates where the name is ambiguous", async () => {
    signedIn(ADMIN);
    const r = await resolveDecklistAction("pokemon", "3 Charizard ex\n2 Charizard");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(2);
    expect(r.data![0]).toMatchObject({ cardId: f.cards.charizardEx, line: { quantity: 3, text: "Charizard ex", zone: "main" } });
    expect(r.data![1].cardId).toBeNull();
    expect(r.data![1].candidates.map((c) => c.name)).toContain("Charizard ex");
  });

  it("refuses an unknown game and an over-long paste", async () => {
    signedIn(ADMIN);
    expect(await resolveDecklistAction("yugioh", "1 Blue-Eyes")).toEqual({ ok: false, error: "Unknown game" });
    expect(await resolveDecklistAction("pokemon", "1 Rare Candy\n".repeat(2000))).toEqual({ ok: false, error: "That list is too long" });
  });
});

describe("saveMetaDeckAction", () => {
  it("creates a curated deck, then replaces its lines in place when an id is passed", async () => {
    signedIn(ADMIN);
    const created = await saveMetaDeckAction({
      gameSlug: "pokemon", name: "Zard pile", archetype: "Charizard ex", tier: 2, format: "standard", sourceNote: "Regionals",
      lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 3 }, { cardId: f.cards.rareCandyObf, zone: "main", quantity: 4 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data as number;
    expect(revalidatePath.mock.calls.flat()).toEqual(["/admin/decks", "/decks"]);

    const made = await getDeck(id, null);
    expect(made).toMatchObject({ name: "Zard pile", archetype: "Charizard ex", tier: 2, format: "standard", sourceNote: "Regionals", isMeta: true });
    expect(made?.cards.map((l) => [l.cardId, l.quantity])).toEqual([[f.cards.charizardEx, 3], [f.cards.rareCandyObf, 4]]);

    const updated = await saveMetaDeckAction({
      id, gameSlug: "pokemon", name: "Zard pile v2", tier: 1,
      lines: [{ cardId: f.cards.fireEnergy, zone: "main", quantity: 12 }],
    });
    expect(updated).toEqual({ ok: true, data: id }); // same row, not a second deck
    const after = await getDeck(id, null);
    expect(after).toMatchObject({ name: "Zard pile v2", tier: 1 });
    expect(after?.cards.map((l) => [l.cardId, l.quantity])).toEqual([[f.cards.fireEnergy, 12]]); // replaced, not appended

    expect(await deleteMetaDeckAction(id)).toEqual({ ok: true, data: undefined });
  });

  it("refuses a bad game, a non-integer id or line id, and an out-of-range quantity", async () => {
    signedIn(ADMIN);
    expect(await saveMetaDeckAction({ gameSlug: "yugioh", name: "x", lines: [] })).toEqual({ ok: false, error: "Unknown game" });
    expect(await saveMetaDeckAction({ id: 1.5, gameSlug: "pokemon", name: "x", lines: [] })).toEqual({ ok: false, error: "Invalid id" });
    expect(await saveMetaDeckAction({ gameSlug: "pokemon", name: "x", lines: [{ cardId: "3" as never, zone: "main", quantity: 1 }] }))
      .toEqual({ ok: false, error: "Invalid id" });
    expect(await saveMetaDeckAction({ gameSlug: "pokemon", name: "x", lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 100 }] }))
      .toEqual({ ok: false, error: "Quantity must be a whole number from 1 to 99" });
    expect(await saveMetaDeckAction({ gameSlug: "pokemon", name: "x", lines: [{ cardId: f.cards.charizardEx, zone: "rune" as never, quantity: 1 }] }))
      .toEqual({ ok: false, error: 'Zone "rune" is not used by this game' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("cannot overwrite a personal deck by passing its id", async () => {
    signedIn(ADMIN);
    expect(await saveMetaDeckAction({ id: personalId, gameSlug: "pokemon", name: "Hijack", lines: [] })).toEqual({ ok: false, error: "Meta deck not found" });
    expect((await getDeck(personalId, USER))?.cards.map((l) => [l.cardId, l.quantity])).toEqual([[f.cards.fireEnergy, 4]]);
  });
});

describe("deleteMetaDeckAction", () => {
  it("removes the deck and its lines and revalidates both paths", async () => {
    const id = await makeDeck("Short-lived");
    revalidatePath.mockReset();
    signedIn(ADMIN);
    expect(await deleteMetaDeckAction(id)).toEqual({ ok: true, data: undefined });
    expect(revalidatePath.mock.calls.flat()).toEqual(["/admin/decks", "/decks"]);
    expect(await getDeck(id, null)).toBeNull();
    expect(await lineCount(id)).toBe(0);
  });

  it("will not delete a personal deck or a missing id", async () => {
    signedIn(ADMIN);
    expect(await deleteMetaDeckAction(personalId)).toEqual({ ok: false, error: "Deck not found" });
    expect(await deleteMetaDeckAction(999999)).toEqual({ ok: false, error: "Deck not found" });
    expect(await deleteMetaDeckAction(-3)).toEqual({ ok: false, error: "Invalid id" });
    expect(await getDeck(personalId, USER)).not.toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
