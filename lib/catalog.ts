// lib/catalog.ts
// Read side of the catalog for the UI. Prices come from latest_prices (last seen); 30-day change
// is derived from price_snapshots by carry-forward (spec §5 write-on-change semantics).
import { db } from "@/lib/db";

export interface PrintingPrice { printingId: number; subtype: string; market: number | null; priceDate: string | null }
export interface SearchHit { cardId: number; name: string; number: string | null; rarity: string | null; imageUrl: string | null; setName: string; gameSlug: string; printings: PrintingPrice[] }

const MIN_QUERY = 2;

export async function searchCards(q: string, opts: { gameSlug?: string; limit?: number } = {}): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < MIN_QUERY) return [];
  const limit = Math.min(opts.limit ?? 20, 50);
  const c = await db();
  const like = `%${query.replace(/[%_]/g, (m) => "\\" + m)}%`;
  const rows = (await c.execute({
    sql: `SELECT ca.id, ca.name, ca.number, ca.rarity, ca.image_url, se.name AS set_name, g.slug AS game_slug
          FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id
          WHERE (ca.name LIKE ? ESCAPE '\\' OR ca.number LIKE ? ESCAPE '\\') AND (? IS NULL OR g.slug = ?)
          ORDER BY CASE WHEN ca.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, ca.name, se.release_date DESC
          LIMIT ?`,
    args: [like, like, opts.gameSlug ?? null, opts.gameSlug ?? null, `${query.replace(/[%_]/g, (m) => "\\" + m)}%`, limit],
  })).rows;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const prices = (await c.execute({
    sql: `SELECT p.id AS printing_id, p.card_id, p.subtype, lp.market, lp.date
          FROM printings p LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE p.card_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.card_id, p.id`,
    args: ids,
  })).rows;
  const byCard = new Map<number, PrintingPrice[]>();
  for (const r of prices) {
    const list = byCard.get(Number(r.card_id)) ?? [];
    list.push({ printingId: Number(r.printing_id), subtype: String(r.subtype), market: r.market == null ? null : Number(r.market), priceDate: r.date == null ? null : String(r.date) });
    byCard.set(Number(r.card_id), list);
  }
  return rows.map((r) => ({
    cardId: Number(r.id), name: String(r.name), number: r.number == null ? null : String(r.number), rarity: r.rarity == null ? null : String(r.rarity),
    imageUrl: r.image_url == null ? null : String(r.image_url), setName: String(r.set_name), gameSlug: String(r.game_slug),
    printings: byCard.get(Number(r.id)) ?? [],
  }));
}

export interface Game { id: number; slug: string; name: string }
export async function listGames(): Promise<Game[]> {
  const c = await db();
  return (await c.execute("SELECT id, slug, name FROM games ORDER BY id")).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug), name: String(r.name) }));
}

export interface SetCompletion { id: number; name: string; code: string | null; releaseDate: string | null; totalCards: number; ownedCards: number }

/** Completion counts CARDS (rows with a number — sealed products are excluded), owned = at least one copy in any of the user's portfolios. */
export async function listSetsWithCompletion(userId: string, gameSlug: string): Promise<SetCompletion[]> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT se.id, se.name, se.code, se.release_date,
                 (SELECT COUNT(*) FROM cards ca WHERE ca.set_id = se.id AND ca.number IS NOT NULL) AS total_cards,
                 (SELECT COUNT(DISTINCT ca.id) FROM cards ca
                    JOIN printings p ON p.card_id = ca.id
                    JOIN collection_items ci ON ci.printing_id = p.id
                    JOIN portfolios po ON po.id = ci.portfolio_id AND po.user_id = ?
                  WHERE ca.set_id = se.id AND ca.number IS NOT NULL) AS owned_cards
          FROM sets se JOIN games g ON g.id = se.game_id
          WHERE g.slug = ?
          ORDER BY se.release_date DESC, se.name`,
    args: [userId, gameSlug],
  })).rows;
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name), code: r.code == null ? null : String(r.code), releaseDate: r.release_date == null ? null : String(r.release_date), totalCards: Number(r.total_cards), ownedCards: Number(r.owned_cards) }));
}

export interface SetCard { cardId: number; name: string; number: string; rarity: string | null; imageUrl: string | null; lowestMarket: number | null; ownedQuantity: number; printings: PrintingPrice[] }
export interface SetDetail { set: { id: number; name: string; code: string | null; releaseDate: string | null; gameSlug: string; gameName: string }; cards: SetCard[]; stats: { totalCards: number; ownedCards: number; setValue: number; ownedValue: number; missingCost: number } }

export async function getSetDetail(userId: string, setId: number): Promise<SetDetail | null> {
  const c = await db();
  const s = (await c.execute({ sql: "SELECT se.id, se.name, se.code, se.release_date, g.slug, g.name AS game_name FROM sets se JOIN games g ON g.id = se.game_id WHERE se.id = ?", args: [setId] })).rows[0];
  if (!s) return null;
  const rows = (await c.execute({
    sql: `SELECT ca.id AS card_id, ca.name, ca.number, ca.rarity, ca.image_url, p.id AS printing_id, p.subtype, lp.market, lp.date,
                 COALESCE((SELECT SUM(ci.quantity) FROM collection_items ci JOIN portfolios po ON po.id = ci.portfolio_id AND po.user_id = ? WHERE ci.printing_id = p.id), 0) AS owned
          FROM cards ca JOIN printings p ON p.card_id = ca.id LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE ca.set_id = ? AND ca.number IS NOT NULL
          ORDER BY ca.number, ca.id, p.id`,
    args: [userId, setId],
  })).rows;
  const cards = new Map<number, SetCard>();
  for (const r of rows) {
    const id = Number(r.card_id);
    const market = r.market == null ? null : Number(r.market);
    const owned = Number(r.owned);
    const card = cards.get(id) ?? { cardId: id, name: String(r.name), number: String(r.number), rarity: r.rarity == null ? null : String(r.rarity), imageUrl: r.image_url == null ? null : String(r.image_url), lowestMarket: null, ownedQuantity: 0, printings: [] };
    card.printings.push({ printingId: Number(r.printing_id), subtype: String(r.subtype), market, priceDate: r.date == null ? null : String(r.date) });
    card.ownedQuantity += owned;
    if (market != null && (card.lowestMarket == null || market < card.lowestMarket)) card.lowestMarket = market;
    cards.set(id, card);
  }
  const list = [...cards.values()];
  let setValue = 0, ownedValue = 0, missingCost = 0, ownedCards = 0;
  for (const card of list) {
    if (card.lowestMarket != null) setValue += card.lowestMarket;
    if (card.ownedQuantity > 0) { ownedCards++; if (card.lowestMarket != null) ownedValue += card.lowestMarket; }
    else if (card.lowestMarket != null) missingCost += card.lowestMarket;
  }
  return {
    set: { id: Number(s.id), name: String(s.name), code: s.code == null ? null : String(s.code), releaseDate: s.release_date == null ? null : String(s.release_date), gameSlug: String(s.slug), gameName: String(s.game_name) },
    cards: list,
    stats: { totalCards: list.length, ownedCards, setValue, ownedValue, missingCost },
  };
}

export interface Change { amount: number; ratio: number }
/** Market on `asOf` vs. the carried-forward snapshot 30 days earlier; null without history. */
export async function thirtyDayChange(printingId: number, asOf: string): Promise<Change | null> {
  const c = await db();
  const cutoff = new Date(`${asOf}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const then = (await c.execute({ sql: "SELECT market FROM price_snapshots WHERE printing_id = ? AND date <= ? ORDER BY date DESC LIMIT 1", args: [printingId, cutoffDate] })).rows[0];
  const now = (await c.execute({ sql: "SELECT market FROM latest_prices WHERE printing_id = ?", args: [printingId] })).rows[0];
  if (!then || then.market == null || !now || now.market == null) return null;
  const a = Number(then.market), b = Number(now.market);
  if (a === 0) return null;
  return { amount: b - a, ratio: (b - a) / a };
}

export interface CardDetail {
  card: { id: number; name: string; number: string | null; rarity: string | null; imageUrl: string | null; setId: number; setName: string; gameSlug: string; gameName: string; attrs: Record<string, string> };
  printings: Array<PrintingPrice & { owned: number; change30d: Change | null }>;
}
export async function getCardDetail(userId: string, cardId: number, asOf = new Date().toISOString().slice(0, 10)): Promise<CardDetail | null> {
  const c = await db();
  const r = (await c.execute({ sql: "SELECT ca.*, se.name AS set_name, g.slug AS game_slug, g.name AS game_name FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id WHERE ca.id = ?", args: [cardId] })).rows[0];
  if (!r) return null;
  const ps = (await c.execute({
    sql: `SELECT p.id, p.subtype, lp.market, lp.date,
                 COALESCE((SELECT SUM(ci.quantity) FROM collection_items ci JOIN portfolios po ON po.id = ci.portfolio_id AND po.user_id = ? WHERE ci.printing_id = p.id), 0) AS owned
          FROM printings p LEFT JOIN latest_prices lp ON lp.printing_id = p.id WHERE p.card_id = ? ORDER BY p.id`,
    args: [userId, cardId],
  })).rows;
  const printings = await Promise.all(
    ps.map(async (p) => ({
      printingId: Number(p.id),
      subtype: String(p.subtype),
      market: p.market == null ? null : Number(p.market),
      priceDate: p.date == null ? null : String(p.date),
      owned: Number(p.owned),
      change30d: await thirtyDayChange(Number(p.id), asOf),
    }))
  );
  let attrs: Record<string, string> = {};
  try { attrs = JSON.parse(String(r.attrs ?? "{}")); } catch { /* keep {} */ }
  return {
    card: { id: Number(r.id), name: String(r.name), number: r.number == null ? null : String(r.number), rarity: r.rarity == null ? null : String(r.rarity), imageUrl: r.image_url == null ? null : String(r.image_url), setId: Number(r.set_id), setName: String(r.set_name), gameSlug: String(r.game_slug), gameName: String(r.game_name), attrs },
    printings,
  };
}
