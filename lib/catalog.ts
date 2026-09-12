// lib/catalog.ts
// Read side of the catalog for the UI. Prices come from latest_prices (last seen); 30-day change
// is derived from price_snapshots by carry-forward (spec §5 write-on-change semantics).
import { db } from "@/lib/db";
import { tokenize, likeTerm } from "@/lib/search-terms";

export interface PrintingPrice { printingId: number; subtype: string; market: number | null; priceDate: string | null }
// `attrs` rides along because the deck builder needs a hit's card type to know which zone it belongs in
// (lib/decks/zone.ts) and which rules apply to it (lib/decks/validate.ts).
export interface SearchHit { cardId: number; name: string; number: string | null; rarity: string | null; imageUrl: string | null; setName: string; gameSlug: string; attrs: Record<string, string>; printings: PrintingPrice[] }

const MIN_QUERY = 2;

/**
 * Type-ahead over the catalog: name, number, rarity, printing subtype and set name.
 *
 * Every TOKEN must match something, and any of those five fields will do — so "charizard sir" is a
 * Charizard that is a Special Illustration Rare, not every card mentioning either word. It used to
 * match name and number alone, which is why searching a rarity returned nothing and the add-a-card
 * dialog felt empty.
 *
 * Ranking keeps a name match ahead of a rarity match: someone typing "rare" wants a card called
 * Rare Candy before 3,500 rares.
 */
export async function searchCards(q: string, opts: { gameSlug?: string; limit?: number } = {}): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < MIN_QUERY) return [];
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const limit = Math.min(opts.limit ?? 20, 50);
  const c = await db();

  const args: unknown[] = [];
  // One AND per token; inside it, one OR per field per expansion of that token.
  const where = tokens
    .map((t) =>
      "(" +
      t.terms
        .map(() => {
          const like = "?";
          args.push(null); // placeholder, filled below in the same order
          return `ca.name LIKE ${like} ESCAPE '\\' OR ca.number LIKE ${like} ESCAPE '\\' OR ca.rarity LIKE ${like} ESCAPE '\\' OR se.name LIKE ${like} ESCAPE '\\' OR EXISTS (SELECT 1 FROM printings p2 WHERE p2.card_id = ca.id AND p2.subtype LIKE ${like} ESCAPE '\\')`;
        })
        .join(" OR ") +
      ")"
    )
    .join(" AND ");
  // Each expansion supplies the same term to all five comparisons.
  args.length = 0;
  for (const t of tokens) for (const term of t.terms) for (let i = 0; i < 5; i++) args.push(likeTerm(term));

  // Same escaping as likeTerm, but anchored at the start: this is the RANKING term, which puts a
  // name beginning with the query above a rarity that merely contains it.
  const prefix = likeTerm(query).slice(1);
  const rows = (await c.execute({
    sql: `SELECT ca.id, ca.name, ca.number, ca.rarity, ca.image_url, ca.attrs, se.name AS set_name, g.slug AS game_slug
          FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id
          WHERE (${where}) AND (? IS NULL OR g.slug = ?)
          ORDER BY CASE WHEN ca.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, ca.name, se.release_date DESC
          LIMIT ?`,
    args: [...args, opts.gameSlug ?? null, opts.gameSlug ?? null, prefix, limit] as never[],
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
  return rows.map((r) => {
    let attrs: Record<string, string> = {};
    try { attrs = JSON.parse(String(r.attrs ?? "{}")); } catch { /* keep {} */ }
    return {
      cardId: Number(r.id), name: String(r.name), number: r.number == null ? null : String(r.number), rarity: r.rarity == null ? null : String(r.rarity),
      imageUrl: r.image_url == null ? null : String(r.image_url), setName: String(r.set_name), gameSlug: String(r.game_slug), attrs,
      printings: byCard.get(Number(r.id)) ?? [],
    };
  });
}

export interface JumpTarget { kind: "set" | "deck"; id: number; name: string; caption: string; href: string }

/**
 * Sets and decks matching a query, for the palette's "Go to" group.
 *
 * The palette is a navigator, and half of what you want to reach is not a card — "take me to
 * Prismatic Evolutions" or "open my Charizard build" are the other two things on this screen.
 * Meta decks are included alongside your own because both are browsable.
 */
export async function searchJumpTargets(userId: string, q: string, limit = 4): Promise<JumpTarget[]> {
  const query = q.trim();
  if (query.length < MIN_QUERY) return [];
  const like = likeTerm(query);
  const c = await db();
  const [sets, decks] = await Promise.all([
    c.execute({
      // g.slug as well as g.name: the name captions the row, but the set's URL is
      // /sets/<game>/<slug> and without the game segment every jump target 404s.
      sql: `SELECT se.id, se.slug, se.name, g.name AS game, g.slug AS game_slug, se.code
            FROM sets se JOIN games g ON g.id = se.game_id
            WHERE se.name LIKE ? ESCAPE '\\' OR se.code LIKE ? ESCAPE '\\'
            ORDER BY se.series_rank IS NULL, se.series_rank DESC, se.release_date DESC LIMIT ?`,
      args: [like, like, limit],
    }),
    c.execute({
      sql: `SELECT d.id, d.name, g.name AS game, d.owner_user_id IS NULL AS is_meta
            FROM decks d JOIN games g ON g.id = d.game_id
            WHERE d.name LIKE ? ESCAPE '\\' AND (d.owner_user_id IS NULL OR d.owner_user_id = ?)
            ORDER BY d.owner_user_id IS NULL, d.updated_at DESC LIMIT ?`,
      args: [like, userId, limit],
    }),
  ]);
  return [
    ...sets.rows.map((r) => ({
      kind: "set" as const, id: Number(r.id), name: String(r.name),
      // The id is still a valid segment — that route redirects it to the slug — so a set the slug
      // backfill has not reached yet is reachable rather than broken.
      href: `/sets/${String(r.game_slug)}/${r.slug == null ? Number(r.id) : String(r.slug)}`,
      caption: [String(r.game), r.code == null ? null : String(r.code)].filter(Boolean).join(" · "),
    })),
    ...decks.rows.map((r) => ({
      kind: "deck" as const, id: Number(r.id), name: String(r.name), href: `/decks/${Number(r.id)}`,
      caption: `${r.game} · ${Number(r.is_meta) === 1 ? "meta deck" : "your deck"}`,
    })),
  ];
}

/** The numeric id behind a game+slug pair, or null. Slugs are unique per game, which is exactly
 *  what /sets/<game>/<slug> encodes. */
export async function resolveSetSlug(gameSlug: string, slug: string): Promise<number | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT se.id FROM sets se JOIN games g ON g.id = se.game_id WHERE g.slug = ? AND se.slug = ?`,
    args: [gameSlug, slug],
  });
  return r.rows.length === 1 ? Number(r.rows[0].id) : null;
}

export interface Game { id: number; slug: string; name: string }
export async function listGames(): Promise<Game[]> {
  const c = await db();
  return (await c.execute("SELECT id, slug, name FROM games ORDER BY id")).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug), name: String(r.name) }));
}

export interface SetCompletion {
  id: number; slug: string | null; name: string; code: string | null; releaseDate: string | null;
  totalCards: number; ownedCards: number;
  /** Sealed products belonging to this set: ETBs, booster boxes, bundles, blisters. Counted apart
   *  from cards because they are a different thing to own, not a subset of the card list. */
  totalSealed: number; ownedSealed: number;
  /** The era, in the game's own vocabulary. Null for TCGplayer product groups that are not sets —
   *  /sets gathers those under "Promos & products". Filled by scripts/backfill-set-meta.mts. */
  series: string | null;
  /** Higher is newer. From the SOURCE's dates, because ours carry the ingest date for 19 sets. */
  seriesRank: number | null;
  logoUrl: string | null;
  symbolUrl: string | null;
}

/**
 * Every set in a game, with how much of it you hold.
 *
 * Cards and SEALED products are counted apart. Both live in `cards`; a null `number` is what marks a
 * sealed product, and the two are different things to own — "40 of 200" means nothing if half of
 * those 200 are booster boxes.
 *
 * Owned means at least one copy in any of the user's collections.
 */
export async function listSetsWithCompletion(userId: string, gameSlug: string): Promise<SetCompletion[]> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT se.id, se.slug, se.name, se.code, se.release_date, se.series, se.series_rank, se.logo_url, se.symbol_url,
                 (SELECT COUNT(*) FROM cards ca WHERE ca.set_id = se.id AND ca.number IS NOT NULL) AS total_cards,
                 (SELECT COUNT(*) FROM cards ca WHERE ca.set_id = se.id AND ca.number IS NULL) AS total_sealed,
                 (SELECT COUNT(DISTINCT ca.id) FROM cards ca
                    JOIN printings p ON p.card_id = ca.id
                    JOIN collection_items ci ON ci.printing_id = p.id
                    JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
                  WHERE ca.set_id = se.id AND ca.number IS NOT NULL) AS owned_cards,
                 (SELECT COUNT(DISTINCT ca.id) FROM cards ca
                    JOIN printings p ON p.card_id = ca.id
                    JOIN collection_items ci ON ci.printing_id = p.id
                    JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
                  WHERE ca.set_id = se.id AND ca.number IS NULL) AS owned_sealed
          FROM sets se JOIN games g ON g.id = se.game_id
          WHERE g.slug = ?
          ORDER BY se.series_rank IS NULL, se.series_rank DESC, se.release_date DESC, se.name`,
    args: [userId, userId, gameSlug],
  })).rows;
  return rows.map((r) => ({
    id: Number(r.id), slug: r.slug == null ? null : String(r.slug), name: String(r.name), code: r.code == null ? null : String(r.code),
    releaseDate: r.release_date == null ? null : String(r.release_date),
    totalCards: Number(r.total_cards), ownedCards: Number(r.owned_cards),
    totalSealed: Number(r.total_sealed), ownedSealed: Number(r.owned_sealed),
    series: r.series == null ? null : String(r.series),
    seriesRank: r.series_rank == null ? null : Number(r.series_rank),
    logoUrl: r.logo_url == null ? null : String(r.logo_url),
    symbolUrl: r.symbol_url == null ? null : String(r.symbol_url),
  }));
}

export interface SetCard {
  cardId: number; name: string;
  /** Null on a SEALED product — that is exactly what distinguishes one from a card. */
  number: string | null;
  rarity: string | null; imageUrl: string | null; lowestMarket: number | null; ownedQuantity: number;
  printings: PrintingPrice[];
}
export interface SetDetail {
  set: { id: number; slug: string | null; name: string; code: string | null; releaseDate: string | null; gameSlug: string; gameName: string };
  cards: SetCard[];
  /** The set's sealed products, in the same shape. They live in the same table as the cards and were
   *  simply filtered out of every query until now. */
  sealed: SetCard[];
  stats: {
    totalCards: number; ownedCards: number;
    totalSealed: number; ownedSealed: number;
    /** Cards only: the sum of each card's cheapest printing. A booster box is not part of what it
     *  costs to complete a set, so sealed is deliberately left out of all three figures. */
    setValue: number; ownedValue: number; missingCost: number;
  };
}

export async function getSetDetail(userId: string, setId: number): Promise<SetDetail | null> {
  const c = await db();
  const s = (await c.execute({ sql: "SELECT se.id, se.name, se.code, se.release_date, g.slug, g.name AS game_name FROM sets se JOIN games g ON g.id = se.game_id WHERE se.id = ?", args: [setId] })).rows[0];
  if (!s) return null;
  const rows = (await c.execute({
    sql: `SELECT ca.id AS card_id, ca.name, ca.number, ca.rarity, ca.image_url, p.id AS printing_id, p.subtype, lp.market, lp.date,
                 COALESCE((SELECT SUM(ci.quantity) FROM collection_items ci JOIN collections po ON po.id = ci.collection_id AND po.user_id = ? WHERE ci.printing_id = p.id), 0) AS owned
          FROM cards ca JOIN printings p ON p.card_id = ca.id LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE ca.set_id = ?
          ORDER BY ca.number IS NULL, ca.number, ca.name, ca.id, p.id`,
    args: [userId, setId],
  })).rows;
  // One pass over cards AND sealed — they differ only by `number`, so splitting them in SQL would
  // mean running the same join twice.
  const byId = new Map<number, SetCard>();
  for (const r of rows) {
    const id = Number(r.card_id);
    const market = r.market == null ? null : Number(r.market);
    const owned = Number(r.owned);
    const card = byId.get(id) ?? { cardId: id, name: String(r.name), number: r.number == null ? null : String(r.number), rarity: r.rarity == null ? null : String(r.rarity), imageUrl: r.image_url == null ? null : String(r.image_url), lowestMarket: null, ownedQuantity: 0, printings: [] };
    card.printings.push({ printingId: Number(r.printing_id), subtype: String(r.subtype), market, priceDate: r.date == null ? null : String(r.date) });
    card.ownedQuantity += owned;
    if (market != null && (card.lowestMarket == null || market < card.lowestMarket)) card.lowestMarket = market;
    byId.set(id, card);
  }
  const all = [...byId.values()];
  const cards = all.filter((x) => x.number != null);
  const sealed = all.filter((x) => x.number == null);
  // A set with neither is a TCGplayer group we have no products for. There is nothing to show, so
  // the page 404s rather than rendering an empty shell — and /sets does not link to it.
  if (all.length === 0) return null;

  let setValue = 0, ownedValue = 0, missingCost = 0, ownedCards = 0;
  for (const card of cards) {
    if (card.lowestMarket != null) setValue += card.lowestMarket;
    if (card.ownedQuantity > 0) { ownedCards++; if (card.lowestMarket != null) ownedValue += card.lowestMarket; }
    else if (card.lowestMarket != null) missingCost += card.lowestMarket;
  }
  return {
    set: { id: Number(s.id), slug: s.set_slug == null ? null : String(s.set_slug), name: String(s.name), code: s.code == null ? null : String(s.code), releaseDate: s.release_date == null ? null : String(s.release_date), gameSlug: String(s.slug), gameName: String(s.game_name) },
    cards,
    sealed,
    stats: {
      totalCards: cards.length, ownedCards,
      totalSealed: sealed.length, ownedSealed: sealed.filter((x) => x.ownedQuantity > 0).length,
      setValue, ownedValue, missingCost,
    },
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
                 COALESCE((SELECT SUM(ci.quantity) FROM collection_items ci JOIN collections po ON po.id = ci.collection_id AND po.user_id = ? WHERE ci.printing_id = p.id), 0) AS owned
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
