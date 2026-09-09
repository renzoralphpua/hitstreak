import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-admin-actions");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { listMetaDecks, getDeck, createDeck, saveDeckCards } from "@/lib/decks/data";
import { MAX_LINES } from "@/lib/decks/types";

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

  it("refuses more lines than a deck can hold, before it queries the catalog for any of them", async () => {
    signedIn(ADMIN);
    // Well under TEXT_MAX characters (~13 bytes a line) but far past the line bound: the length guard
    // alone would let this run two sequential catalog queries per line.
    const over = "1 Rare Candy\n".repeat(MAX_LINES + 1);
    expect(over.length).toBeLessThan(20_000);
    expect(await resolveDecklistAction("pokemon", over)).toEqual({ ok: false, error: `A deck can have at most ${MAX_LINES} lines` });

    const atTheLimit = await resolveDecklistAction("pokemon", "1 Rare Candy\n".repeat(MAX_LINES));
    expect(atTheLimit.ok).toBe(true); // the bound itself is allowed
    if (atTheLimit.ok) expect(atTheLimit.data).toHaveLength(MAX_LINES);
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

  it("refuses an over-long or non-string archetype, format or source note", async () => {
    signedIn(ADMIN);
    const tooLong = "x".repeat(201);
    const base = { gameSlug: "pokemon", name: "Bloated", lines: [] };
    expect(await saveMetaDeckAction({ ...base, archetype: tooLong })).toEqual({ ok: false, error: "That value must be at most 200 characters" });
    expect(await saveMetaDeckAction({ ...base, format: tooLong })).toEqual({ ok: false, error: "That value must be at most 200 characters" });
    expect(await saveMetaDeckAction({ ...base, sourceNote: tooLong })).toEqual({ ok: false, error: "That value must be at most 200 characters" });
    expect(await saveMetaDeckAction({ ...base, archetype: 7 as never })).toEqual({ ok: false, error: "That value must be text" });
    expect(await saveMetaDeckAction({ ...base, format: { toString: () => "std" } as never })).toEqual({ ok: false, error: "That value must be text" });
    expect(await saveMetaDeckAction({ ...base, sourceNote: ["a"] as never })).toEqual({ ok: false, error: "That value must be text" });
    expect((await listMetaDecks("pokemon")).some((d) => d.name === "Bloated")).toBe(false); // nothing was written
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("trims the metadata fields and stores a blank one as null", async () => {
    signedIn(ADMIN);
    const created = await saveMetaDeckAction({
      gameSlug: "pokemon", name: "Trimmed", archetype: "   ", format: "  standard  ", sourceNote: "\t\n",
      lines: [{ cardId: f.cards.fireEnergy, zone: "main", quantity: 1 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data as number;
    expect(await getDeck(id, null)).toMatchObject({ archetype: null, format: "standard", sourceNote: null });
    expect(await deleteMetaDeckAction(id)).toEqual({ ok: true, data: undefined });
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
