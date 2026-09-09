// lib/decks/data.ts
// Decks. Meta decks (owner_user_id IS NULL) are readable by anyone the caller admits — getDeck(id, null)
// returns them — and written only by admins (upsertMetaDeck); the route/action layer owns the sign-in gate.
// Personal decks are scoped to their owner on every read and write.
import { db } from "@/lib/db";
import type { InStatement } from "@libsql/client";
import { type DeckCardInput, type GameSlug, type Zone, MAX_LINES, QTY_MAX, ZONES, isGameSlug } from "./types";

export interface DeckSummary {
  id: number; gameSlug: GameSlug; gameName: string; name: string; archetype: string | null; tier: number | null;
  format: string | null; sourceNote: string | null; isMeta: boolean; isDraft: boolean; updatedAt: string; cardCount: number;
}
export interface DeckLine {
  cardId: number; zone: Zone; quantity: number; name: string; setName: string; number: string | null; rarity: string | null;
  imageUrl: string | null; attrs: Record<string, string>; market: number | null; // cheapest printing's market
}
export interface DeckDetail extends DeckSummary { cards: DeckLine[] }
export interface DeckLineInput { cardId: number; zone: Zone; quantity: number }

const NAME_MAX = 80;
// MAX_LINES (the write batch's bound) lives in ./types — the curation action needs the same number to
// bound a paste before it resolves it.
function cleanName(name: string): string {
  const n = name.trim();
  if (n.length === 0 || n.length > NAME_MAX) throw new Error(`Deck name must be 1–${NAME_MAX} characters`);
  return n;
}

const SUMMARY_SQL = `SELECT d.id, d.name, d.archetype, d.tier, d.format, d.source_note, d.owner_user_id, d.is_draft, d.updated_at,
                            g.slug AS game_slug, g.name AS game_name,
                            COALESCE((SELECT SUM(dc.quantity) FROM deck_cards dc WHERE dc.deck_id = d.id), 0) AS card_count
                     FROM decks d JOIN games g ON g.id = d.game_id`;
const toSummary = (x: Record<string, unknown>): DeckSummary => ({
  id: Number(x.id), gameSlug: String(x.game_slug) as GameSlug, gameName: String(x.game_name), name: String(x.name),
  archetype: x.archetype == null ? null : String(x.archetype), tier: x.tier == null ? null : Number(x.tier),
  format: x.format == null ? null : String(x.format), sourceNote: x.source_note == null ? null : String(x.source_note),
  isMeta: x.owner_user_id == null, isDraft: Number(x.is_draft) === 1, updatedAt: String(x.updated_at), cardCount: Number(x.card_count),
});

export async function isAdminUser(userId: string): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT "isAdmin" FROM "user" WHERE id = ?`, args: [userId] });
  return r.rows.length === 1 && Number(r.rows[0].isAdmin) === 1;
}

/** Curated decks for one game: tier 1 first, untiered last, then name. */
export async function listMetaDecks(gameSlug: GameSlug): Promise<DeckSummary[]> {
  const c = await db();
  const r = await c.execute({ sql: `${SUMMARY_SQL} WHERE d.owner_user_id IS NULL AND g.slug = ? ORDER BY d.tier IS NULL, d.tier, d.name`, args: [gameSlug] });
  return r.rows.map(toSummary);
}

export async function listMyDecks(userId: string): Promise<DeckSummary[]> {
  const c = await db();
  const r = await c.execute({ sql: `${SUMMARY_SQL} WHERE d.owner_user_id = ? ORDER BY d.updated_at DESC, d.id DESC`, args: [userId] });
  return r.rows.map(toSummary);
}

/** A meta deck (any caller, `userId` may be null) or the caller's own deck; null otherwise. */
export async function getDeck(id: number, userId: string | null): Promise<DeckDetail | null> {
  const c = await db();
  const d = (await c.execute({ sql: `${SUMMARY_SQL} WHERE d.id = ? AND (d.owner_user_id IS NULL OR d.owner_user_id = ?)`, args: [id, userId] })).rows[0];
  if (!d) return null;
  const rows = (await c.execute({
    sql: `SELECT dc.card_id, dc.zone, dc.quantity, ca.name, ca.number, ca.rarity, ca.image_url, ca.attrs, se.name AS set_name,
                 (SELECT MIN(lp.market) FROM printings p JOIN latest_prices lp ON lp.printing_id = p.id WHERE p.card_id = ca.id AND lp.market IS NOT NULL) AS market
          FROM deck_cards dc JOIN cards ca ON ca.id = dc.card_id JOIN sets se ON se.id = ca.set_id
          WHERE dc.deck_id = ? ORDER BY dc.zone, ca.name, dc.card_id`,
    args: [id],
  })).rows;
  const summary = toSummary(d);
  const order = ZONES[summary.gameSlug];
  const cards: DeckLine[] = rows.map((x) => {
    let attrs: Record<string, string> = {};
    try { attrs = JSON.parse(String(x.attrs ?? "{}")); } catch { /* keep {} */ }
    return {
      cardId: Number(x.card_id), zone: String(x.zone) as Zone, quantity: Number(x.quantity), name: String(x.name), setName: String(x.set_name),
      number: x.number == null ? null : String(x.number), rarity: x.rarity == null ? null : String(x.rarity),
      imageUrl: x.image_url == null ? null : String(x.image_url), attrs, market: x.market == null ? null : Number(x.market),
    };
  }).sort((a, b) => order.indexOf(a.zone) - order.indexOf(b.zone) || a.name.localeCompare(b.name));
  return { ...summary, cards };
}

/** The name/attrs/rarity a validator needs for the given lines, read from the catalog. Lines whose card
 *  no longer exists are dropped; `saveDeckCards` rejects them separately. */
export async function loadDeckCardInputs(lines: DeckLineInput[]): Promise<DeckCardInput[]> {
  if (lines.length === 0) return [];
  const c = await db();
  const ids = [...new Set(lines.map((l) => l.cardId))];
  const rows = (await c.execute({
    sql: `SELECT id, name, rarity, attrs FROM cards WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  })).rows;
  const byId = new Map(rows.map((r) => {
    let attrs: Record<string, string> = {};
    try { attrs = JSON.parse(String(r.attrs ?? "{}")); } catch { /* keep {} */ }
    return [Number(r.id), { name: String(r.name), rarity: r.rarity == null ? null : String(r.rarity), attrs }];
  }));
  return lines.flatMap((l) => {
    const card = byId.get(l.cardId);
    return card ? [{ cardId: l.cardId, zone: l.zone, quantity: l.quantity, name: card.name, rarity: card.rarity, attrs: card.attrs }] : [];
  });
}

async function gameIdFor(slug: string): Promise<number> {
  if (!isGameSlug(slug)) throw new Error("Unknown game");
  const c = await db();
  const r = await c.execute({ sql: "SELECT id FROM games WHERE slug = ?", args: [slug] });
  if (r.rows.length === 0) throw new Error("Unknown game");
  return Number(r.rows[0].id);
}

/** Every line's card must exist, belong to the deck's game, use one of the game's zones, and carry a sane quantity; at most MAX_LINES lines. */
async function checkLines(gameSlug: GameSlug, gameId: number, lines: DeckLineInput[]): Promise<void> {
  if (lines.length > MAX_LINES) throw new Error(`A deck can have at most ${MAX_LINES} lines`);
  const zones = ZONES[gameSlug] as readonly string[];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0 || l.quantity > QTY_MAX) throw new Error(`Quantity must be a whole number from 1 to ${QTY_MAX}`);
    if (!zones.includes(l.zone)) throw new Error(`Zone "${l.zone}" is not used by this game`);
    const k = `${l.cardId}|${l.zone}`;
    if (seen.has(k)) throw new Error("A card appears twice in the same zone");
    seen.add(k);
  }
  if (lines.length === 0) return;
  const c = await db();
  const ids = [...new Set(lines.map((l) => l.cardId))];
  const r = await c.execute({ sql: `SELECT ca.id, se.game_id FROM cards ca JOIN sets se ON se.id = ca.set_id WHERE ca.id IN (${ids.map(() => "?").join(",")})`, args: ids });
  const byId = new Map(r.rows.map((x) => [Number(x.id), Number(x.game_id)]));
  for (const id of ids) {
    const g = byId.get(id);
    if (g === undefined) throw new Error("Card not found");
    if (g !== gameId) throw new Error("Card belongs to another game");
  }
}

/** Statements that swap a deck's lines wholesale and bump updated_at (and is_draft when given); run them in one write batch. */
function lineStatements(deckId: number, lines: DeckLineInput[], isDraft?: boolean): InStatement[] {
  return [
    { sql: "DELETE FROM deck_cards WHERE deck_id = ?", args: [deckId] },
    ...lines.map((l) => ({ sql: "INSERT INTO deck_cards (deck_id, card_id, zone, quantity) VALUES (?, ?, ?, ?)", args: [deckId, l.cardId, l.zone, l.quantity] })),
    isDraft === undefined
      ? { sql: "UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", args: [deckId] }
      : { sql: "UPDATE decks SET is_draft = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", args: [isDraft ? 1 : 0, deckId] },
  ];
}

/** Replaces a deck's lines atomically. */
async function replaceLines(deckId: number, lines: DeckLineInput[], isDraft?: boolean): Promise<void> {
  const c = await db();
  await c.batch(lineStatements(deckId, lines, isDraft), "write");
}

export interface MetaDeckInput { id?: number; gameSlug: GameSlug; name: string; archetype?: string | null; tier?: number | null; format?: string | null; sourceNote?: string | null; lines: DeckLineInput[] }

/** Admin only. Creates a meta deck, or replaces name/metadata/lines of an existing one (by id). */
export async function upsertMetaDeck(adminUserId: string, input: MetaDeckInput): Promise<number> {
  if (!(await isAdminUser(adminUserId))) throw new Error("Only an admin can curate meta decks");
  const name = cleanName(input.name);
  if (input.tier != null && (!Number.isInteger(input.tier) || input.tier < 1 || input.tier > 4)) throw new Error("Tier must be 1–4");
  const gameId = await gameIdFor(input.gameSlug);
  await checkLines(input.gameSlug, gameId, input.lines);
  const c = await db();
  const meta = [input.archetype ?? null, input.tier ?? null, input.format ?? null, input.sourceNote ?? null];
  // Both paths run in one interactive write transaction. Create needs the new id for its lines, and a failed
  // line write must roll the deck row back (listMetaDecks would otherwise show an empty deck). Edit needs its
  // existence check to still hold when the writes land: read-then-batch let a concurrent deleteMetaDeck slip
  // in between, turning the UPDATE into a no-op while the line INSERTs stayed — orphan `deck_cards` rows,
  // since the FKs are not enforced.
  const tx = await c.transaction("write");
  try {
    let id: number;
    if (input.id != null) {
      // Confirm the target is this game's meta deck before any write: the statements below would otherwise
      // swap the lines of a personal deck (or another game's deck) whose id was passed.
      const own = await tx.execute({ sql: "SELECT 1 FROM decks WHERE id = ? AND owner_user_id IS NULL AND game_id = ?", args: [input.id, gameId] });
      if (own.rows.length !== 1) throw new Error("Meta deck not found");
      id = input.id;
      await tx.execute({
        sql: "UPDATE decks SET name = ?, archetype = ?, tier = ?, format = ?, source_note = ? WHERE id = ? AND owner_user_id IS NULL AND game_id = ?",
        args: [name, ...meta, id, gameId],
      });
    } else {
      const r = await tx.execute({
        sql: "INSERT INTO decks (game_id, owner_user_id, name, archetype, tier, format, source_note) VALUES (?, NULL, ?, ?, ?, ?, ?) RETURNING id",
        args: [gameId, name, ...meta],
      });
      id = Number(r.rows[0].id);
    }
    await tx.batch(lineStatements(id, input.lines));
    await tx.commit();
    return id;
  } catch (e) {
    await tx.rollback().catch(() => { /* already closed (e.g. commit failed) — the error below is the one to surface */ });
    throw e;
  }
}

/** Admin only. Removes a curated deck and its lines. Personal decks are untouched (deleteDeck owns those). */
export async function deleteMetaDeck(adminUserId: string, id: number): Promise<boolean> {
  if (!(await isAdminUser(adminUserId))) throw new Error("Only an admin can curate meta decks");
  const c = await db();
  const found = await c.execute({ sql: "SELECT 1 FROM decks WHERE id = ? AND owner_user_id IS NULL", args: [id] });
  if (found.rows.length === 0) return false;
  await c.batch(
    [
      { sql: "DELETE FROM deck_cards WHERE deck_id = ?", args: [id] },
      { sql: "DELETE FROM decks WHERE id = ? AND owner_user_id IS NULL", args: [id] },
    ],
    "write"
  );
  return true;
}

export async function createDeck(userId: string, input: { gameSlug: GameSlug; name: string }): Promise<number> {
  const gameId = await gameIdFor(input.gameSlug);
  const c = await db();
  const r = await c.execute({ sql: "INSERT INTO decks (game_id, owner_user_id, name, is_draft) VALUES (?, ?, ?, 1) RETURNING id", args: [gameId, userId, cleanName(input.name)] });
  return Number(r.rows[0].id);
}

export async function renameDeck(userId: string, id: number, name: string): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: "UPDATE decks SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND owner_user_id = ?", args: [cleanName(name), id, userId] });
  return r.rowsAffected === 1;
}

/** Replaces the owner's deck lines wholesale; `isDraft` is what the caller's validation said. */
export async function saveDeckCards(userId: string, id: number, lines: DeckLineInput[], isDraft: boolean): Promise<void> {
  const c = await db();
  const d = (await c.execute({ sql: "SELECT d.game_id, g.slug FROM decks d JOIN games g ON g.id = d.game_id WHERE d.id = ? AND d.owner_user_id = ?", args: [id, userId] })).rows[0];
  if (!d) throw new Error("Deck not found");
  await checkLines(String(d.slug) as GameSlug, Number(d.game_id), lines);
  await replaceLines(id, lines, isDraft); // lines + is_draft commit in one batch
}

export async function deleteDeck(userId: string, id: number): Promise<boolean> {
  const c = await db();
  const own = await c.execute({ sql: "SELECT 1 FROM decks WHERE id = ? AND owner_user_id = ?", args: [id, userId] });
  if (own.rows.length === 0) return false;
  await c.batch([{ sql: "DELETE FROM deck_cards WHERE deck_id = ?", args: [id] }, { sql: "DELETE FROM decks WHERE id = ? AND owner_user_id = ?", args: [id, userId] }], "write");
  return true;
}
