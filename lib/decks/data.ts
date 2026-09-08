// lib/decks/data.ts
// Decks. Meta decks (owner_user_id IS NULL) are readable by any signed-in user and written only by
// admins (upsertMetaDeck); personal decks are scoped to their owner on every read and write.
import { db } from "@/lib/db";
import { type GameSlug, type Zone, ZONES, isGameSlug } from "./types";

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
const QTY_MAX = 99;
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

async function gameIdFor(slug: string): Promise<number> {
  if (!isGameSlug(slug)) throw new Error("Unknown game");
  const c = await db();
  const r = await c.execute({ sql: "SELECT id FROM games WHERE slug = ?", args: [slug] });
  if (r.rows.length === 0) throw new Error("Unknown game");
  return Number(r.rows[0].id);
}

/** Every line's card must exist, belong to the deck's game, use one of the game's zones, and carry a sane quantity. */
async function checkLines(gameSlug: GameSlug, gameId: number, lines: DeckLineInput[]): Promise<void> {
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

async function replaceLines(deckId: number, lines: DeckLineInput[]): Promise<void> {
  const c = await db();
  await c.batch(
    [
      { sql: "DELETE FROM deck_cards WHERE deck_id = ?", args: [deckId] },
      ...lines.map((l) => ({ sql: "INSERT INTO deck_cards (deck_id, card_id, zone, quantity) VALUES (?, ?, ?, ?)", args: [deckId, l.cardId, l.zone, l.quantity] })),
      { sql: "UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", args: [deckId] },
    ],
    "write"
  );
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
  let id = input.id;
  if (id != null) {
    const r = await c.execute({
      sql: "UPDATE decks SET name = ?, archetype = ?, tier = ?, format = ?, source_note = ? WHERE id = ? AND owner_user_id IS NULL AND game_id = ?",
      args: [name, input.archetype ?? null, input.tier ?? null, input.format ?? null, input.sourceNote ?? null, id, gameId],
    });
    if (r.rowsAffected !== 1) throw new Error("Meta deck not found");
  } else {
    const r = await c.execute({
      sql: "INSERT INTO decks (game_id, owner_user_id, name, archetype, tier, format, source_note) VALUES (?, NULL, ?, ?, ?, ?, ?) RETURNING id",
      args: [gameId, name, input.archetype ?? null, input.tier ?? null, input.format ?? null, input.sourceNote ?? null],
    });
    id = Number(r.rows[0].id);
  }
  await replaceLines(id, input.lines);
  return id;
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
  await replaceLines(id, lines);
  await c.execute({ sql: "UPDATE decks SET is_draft = ? WHERE id = ?", args: [isDraft ? 1 : 0, id] });
}

export async function deleteDeck(userId: string, id: number): Promise<boolean> {
  const c = await db();
  const own = await c.execute({ sql: "SELECT 1 FROM decks WHERE id = ? AND owner_user_id = ?", args: [id, userId] });
  if (own.rows.length === 0) return false;
  await c.batch([{ sql: "DELETE FROM deck_cards WHERE deck_id = ?", args: [id] }, { sql: "DELETE FROM decks WHERE id = ? AND owner_user_id = ?", args: [id, userId] }], "write");
  return true;
}
