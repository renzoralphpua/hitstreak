import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-data");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { listMetaDecks, listMyDecks, getDeck, createDeck, renameDeck, deleteDeck, saveDeckCards, upsertMetaDeck, isAdminUser } from "@/lib/decks/data";

let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
const ADMIN = "admin_1", U1 = "user_1", U2 = "user_2";
beforeAll(async () => {
  await seedMiniCatalog();
  f = await seedDeckFixtures();
  const c = await db();
  await c.execute({ sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAdmin) VALUES (?, 'Admin', 'admin@example.com', 0, '2026-09-01', '2026-09-01', 1), (?, 'U1', 'u1@example.com', 0, '2026-09-01', '2026-09-01', 0)`, args: [ADMIN, U1] });
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("meta decks", () => {
  it("only an admin can create or replace a meta deck", async () => {
    expect(await isAdminUser(ADMIN)).toBe(true);
    expect(await isAdminUser(U1)).toBe(false);
    await expect(upsertMetaDeck(U1, { gameSlug: "pokemon", name: "Zard", lines: [] })).rejects.toThrow(/admin/i);
    const id = await upsertMetaDeck(ADMIN, {
      gameSlug: "pokemon", name: "Charizard ex / Pidgeot", archetype: "Charizard ex", tier: 1, format: "standard", sourceNote: "Regional top cuts, Aug 30",
      lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 3 }, { cardId: f.cards.rareCandyObf, zone: "main", quantity: 4 }],
    });
    const list = await listMetaDecks("pokemon");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "Charizard ex / Pidgeot", tier: 1, isMeta: true, isDraft: false, cardCount: 7, gameSlug: "pokemon" });
    expect(await listMetaDecks("one-piece")).toEqual([]);
    // replace by id: lines are swapped wholesale
    await upsertMetaDeck(ADMIN, { id, gameSlug: "pokemon", name: "Charizard ex / Pidgeot", tier: 2, lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 2 }] });
    const d = await getDeck(id, U1);
    expect(d?.tier).toBe(2);
    expect(d?.cards.map((l) => [l.cardId, l.quantity])).toEqual([[f.cards.charizardEx, 2]]);
    expect(d?.cards[0]).toMatchObject({ name: "Charizard ex", setName: "Obsidian Flames", number: "125/197", market: 18.9, attrs: { "Card Type": "Fire" } });
  });
  it("rejects lines whose card is from another game, an unknown card, or a bad zone/quantity", async () => {
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: [{ cardId: f.cards.nami, zone: "main", quantity: 1 }] })).rejects.toThrow(/game/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: [{ cardId: 99999, zone: "main", quantity: 1 }] })).rejects.toThrow(/card/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: [{ cardId: f.cards.charizardEx, zone: "rune", quantity: 1 }] })).rejects.toThrow(/zone/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 0 }] })).rejects.toThrow(/quantity/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "  ", lines: [] })).rejects.toThrow(/name/i);
  });
  it("rejects the same card twice in one zone, a tier outside 1–4, and more than 200 lines", async () => {
    const twice = [{ cardId: f.cards.charizardEx, zone: "main" as const, quantity: 1 }, { cardId: f.cards.charizardEx, zone: "main" as const, quantity: 2 }];
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: twice })).rejects.toThrow(/twice/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", tier: 0, lines: [] })).rejects.toThrow(/tier/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", tier: 5, lines: [] })).rejects.toThrow(/tier/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", tier: 1.5, lines: [] })).rejects.toThrow(/tier/i);
    // 201 lines with card ids that do not exist: the cap must trip before the card lookup ("Card not found")
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ cardId: 900000 + i, zone: "main" as const, quantity: 1 }));
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: tooMany })).rejects.toThrow(/at most 200 lines/i);
    expect(await listMetaDecks("pokemon")).toHaveLength(1); // nothing above was written
  });
  it("prices a line at the cheapest printing", async () => {
    const meta = (await listMetaDecks("pokemon"))[0];
    expect((await getDeck(meta.id, null))?.cards[0]).toMatchObject({ cardId: f.cards.charizardEx, market: 18.9 });
    const c = await db();
    const p = await c.execute({ sql: "INSERT INTO printings (card_id, subtype) VALUES (?, 'Reverse Holofoil') RETURNING id", args: [f.cards.charizardEx] });
    await c.execute({ sql: "INSERT INTO latest_prices (printing_id, date, market) VALUES (?, '2026-09-07', 42.5)", args: [Number(p.rows[0].id)] });
    expect((await getDeck(meta.id, null))?.cards[0].market).toBe(18.9); // MIN across the two printings
  });
  it("replace-by-id only reaches this game's meta decks", async () => {
    const meta = (await listMetaDecks("pokemon"))[0];
    const personal = await createDeck(U1, { gameSlug: "pokemon", name: "Mine" });
    await saveDeckCards(U1, personal, [{ cardId: f.cards.fireEnergy, zone: "main", quantity: 10 }], false);
    await expect(upsertMetaDeck(ADMIN, { id: personal, gameSlug: "pokemon", name: "hijack", lines: [] })).rejects.toThrow(/meta deck not found/i);
    await expect(upsertMetaDeck(ADMIN, { id: meta.id, gameSlug: "one-piece", name: "wrong game", lines: [] })).rejects.toThrow(/meta deck not found/i);
    expect((await getDeck(personal, U1))?.cards.map((l) => [l.cardId, l.quantity])).toEqual([[f.cards.fireEnergy, 10]]); // untouched
    expect((await getDeck(meta.id, null))?.name).toBe("Charizard ex / Pidgeot");
    expect(await deleteDeck(U1, personal)).toBe(true);
  });
});

describe("personal decks", () => {
  it("are scoped to their owner; meta decks are visible to everyone signed in", async () => {
    const id = await createDeck(U1, { gameSlug: "one-piece", name: "Blue Nami" });
    await saveDeckCards(U1, id, [{ cardId: f.cards.luffyLeader, zone: "leader", quantity: 1 }, { cardId: f.cards.nami, zone: "main", quantity: 4 }], true);
    expect((await listMyDecks(U1)).map((d) => [d.id, d.isDraft, d.cardCount])).toEqual([[id, true, 5]]);
    expect(await listMyDecks(U2)).toEqual([]);
    expect(await getDeck(id, U2)).toBeNull();
    const mine = await getDeck(id, U1);
    expect(mine?.cards).toHaveLength(2);
    expect(mine?.cards.map((l) => l.zone)).toEqual(["leader", "main"]); // ZONES["one-piece"] display order
    expect(mine?.isDraft).toBe(true);
    const meta = (await listMetaDecks("pokemon"))[0];
    expect(await getDeck(meta.id, U2)).not.toBeNull();
    expect(await getDeck(meta.id, null)).not.toBeNull(); // meta decks need no user
    expect(await getDeck(id, null)).toBeNull();
  });
  it("owner-only writes", async () => {
    const id = (await listMyDecks(U1))[0].id;
    expect(await renameDeck(U2, id, "hijack")).toBe(false);
    expect(await renameDeck(U1, id, "Nami Blue")).toBe(true);
    await expect(saveDeckCards(U2, id, [], false)).rejects.toThrow(/not found/i);
    expect(await deleteDeck(U2, id)).toBe(false);
    expect(await deleteDeck(U1, id)).toBe(true);
    expect(await getDeck(id, U1)).toBeNull();
    expect((await (await db()).execute({ sql: "SELECT COUNT(*) AS n FROM deck_cards WHERE deck_id = ?", args: [id] })).rows[0].n).toBe(0);
  });
  it("a user cannot write a meta deck through the personal path", async () => {
    const meta = (await listMetaDecks("pokemon"))[0];
    expect(await renameDeck(U1, meta.id, "x")).toBe(false);
    await expect(saveDeckCards(U1, meta.id, [], false)).rejects.toThrow(/not found/i);
    expect(await deleteDeck(ADMIN, meta.id)).toBe(false); // meta decks are not deleted through the personal path either
  });
});
