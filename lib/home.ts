// lib/home.ts — the collection-level reads behind Home. Everything here answers a question about
// what you OWN, so every comparison is against cost basis (decision 1a): no function in this file
// returns a "change over the last N days".
//
// Cost is summed per lot — quantity × that lot's price — never one price times a total. Copies whose
// price was never recorded are counted separately rather than treated as free, because a missing
// cost overstates gain and the UI has to be able to say so.
import { db } from "@/lib/db";
import type { Point } from "@/lib/history";

export interface CollectionLine {
  collectionId: number;
  name: string;
  cards: number;
  value: number;
  cost: number;
  gain: number;
  /** Null when nothing in the collection has a recorded cost — there is no ratio to show. */
  ratio: number | null;
  uncostedQuantity: number;
  unpricedQuantity: number;
}

export interface HomeSummary {
  collections: number;
  cards: number;
  value: number;
  cost: number;
  gain: number;
  ratio: number | null;
  /** Copies worth more than they cost, out of `comparable` — the copies where both figures exist. */
  inProfit: number;
  comparable: number;
  uncostedQuantity: number;
  unpricedQuantity: number;
  lines: CollectionLine[];
}

const PER_COLLECTION = `
  SELECT po.id, po.name,
         COALESCE(SUM(ci.quantity), 0) AS cards,
         COALESCE(SUM(CASE WHEN lp.market IS NULL THEN 0 ELSE ci.quantity * lp.market END), 0) AS value,
         COALESCE(SUM(CASE WHEN ci.acquired_price IS NULL THEN 0 ELSE ci.quantity * ci.acquired_price END), 0) AS cost,
         COALESCE(SUM(CASE WHEN ci.acquired_price IS NULL THEN ci.quantity ELSE 0 END), 0) AS uncosted,
         COALESCE(SUM(CASE WHEN lp.market IS NULL THEN ci.quantity ELSE 0 END), 0) AS unpriced,
         COALESCE(SUM(CASE WHEN lp.market IS NOT NULL AND ci.acquired_price IS NOT NULL THEN ci.quantity ELSE 0 END), 0) AS comparable,
         COALESCE(SUM(CASE WHEN lp.market > ci.acquired_price THEN ci.quantity ELSE 0 END), 0) AS in_profit
  FROM collections po
  LEFT JOIN collection_items ci ON ci.collection_id = po.id
  LEFT JOIN printings p ON p.id = ci.printing_id
  LEFT JOIN latest_prices lp ON lp.printing_id = p.id
  WHERE po.user_id = ?
  GROUP BY po.id
  ORDER BY value DESC, po.name`;

/** Everything you own, and the same figures per collection. A collection with nothing in it still appears —
 *  the LEFT JOINs are there so an empty collection is a row of zeroes rather than a missing line. */
export async function getHomeSummary(userId: string): Promise<HomeSummary> {
  const c = await db();
  const r = await c.execute({ sql: PER_COLLECTION, args: [userId] });
  const lines: CollectionLine[] = r.rows.map((x) => {
    const value = Number(x.value);
    const cost = Number(x.cost);
    return {
      collectionId: Number(x.id),
      name: String(x.name),
      cards: Number(x.cards),
      value,
      cost,
      gain: value - cost,
      ratio: cost > 0 ? (value - cost) / cost : null,
      uncostedQuantity: Number(x.uncosted),
      unpricedQuantity: Number(x.unpriced),
    };
  });
  const sum = (f: (l: CollectionLine) => number) => lines.reduce((t, l) => t + f(l), 0);
  const value = sum((l) => l.value);
  const cost = sum((l) => l.cost);
  return {
    collections: lines.length,
    cards: sum((l) => l.cards),
    value,
    cost,
    gain: value - cost,
    ratio: cost > 0 ? (value - cost) / cost : null,
    inProfit: r.rows.reduce((t, x) => t + Number(x.in_profit), 0),
    comparable: r.rows.reduce((t, x) => t + Number(x.comparable), 0),
    uncostedQuantity: sum((l) => l.uncostedQuantity),
    unpricedQuantity: sum((l) => l.unpricedQuantity),
    lines,
  };
}

export interface Mover {
  cardId: number;
  printingId: number;
  cardName: string;
  setName: string;
  number: string | null;
  subtype: string;
  imageUrl: string | null;
  quantity: number;
  value: number;
  cost: number;
  gain: number;
  ratio: number;
}

const MOVERS = `
  SELECT ca.id AS card_id, p.id AS printing_id, ca.name, se.name AS set_name, ca.number, ca.image_url,
         p.subtype, lp.market,
         SUM(ci.quantity) AS quantity,
         SUM(ci.quantity * ci.acquired_price) AS cost
  FROM collection_items ci
  JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
  JOIN printings p ON p.id = ci.printing_id
  JOIN cards ca ON ca.id = p.card_id
  JOIN sets se ON se.id = ca.set_id
  JOIN latest_prices lp ON lp.printing_id = p.id AND lp.market IS NOT NULL
  WHERE ci.acquired_price IS NOT NULL
  GROUP BY p.id`;

/**
 * The holdings furthest from what they cost, best first and worst first.
 *
 * Grouped by printing across every collection — the same card in two collections is one position, which is
 * what you actually hold. Lots with no recorded price are excluded rather than counted at zero: a
 * card with an unknown cost is not a winner, it is an unknown.
 */
export async function getMovers(userId: string, limit = 3): Promise<{ winners: Mover[]; losers: Mover[] }> {
  const c = await db();
  const r = await c.execute({ sql: MOVERS, args: [userId] });
  const all: Mover[] = r.rows
    .map((x) => {
      const quantity = Number(x.quantity);
      const value = quantity * Number(x.market);
      const cost = Number(x.cost);
      return {
        cardId: Number(x.card_id), printingId: Number(x.printing_id), cardName: String(x.name),
        setName: String(x.set_name), number: x.number == null ? null : String(x.number),
        subtype: String(x.subtype), imageUrl: x.image_url == null ? null : String(x.image_url),
        quantity, value, cost, gain: value - cost, ratio: cost > 0 ? (value - cost) / cost : 0,
      };
    })
    .filter((m) => m.gain !== 0); // a position exactly at cost is neither, and says nothing here
  const byGain = [...all].sort((a, b) => b.gain - a.gain);
  return {
    winners: byGain.filter((m) => m.gain > 0).slice(0, limit),
    // Ascending, so the worst loss leads its column the way the biggest win leads the other.
    losers: byGain.filter((m) => m.gain < 0).reverse().slice(0, limit),
  };
}

/**
 * Two series over the same window: what the collection was worth, and what it had cost by then.
 *
 * Value comes from `collection_history`, summed across collections for each day any of them was
 * recorded. Cost basis is derived from the lots instead — a lot counts from its `acquired_date`
 * onward, and a lot with no date counts throughout, because the alternative is pretending you
 * acquired it today and putting a cliff in the line that never happened.
 */
export async function getHomeHistory(
  userId: string, from: string, to: string
): Promise<{ value: Point[]; cost: Point[] }> {
  const c = await db();
  const [hist, lots] = await Promise.all([
    c.execute({
      sql: `SELECT ph.date, SUM(ph.total_value) AS v
            FROM collection_history ph
            JOIN collections po ON po.id = ph.collection_id AND po.user_id = ?
            WHERE ph.date >= ? AND ph.date <= ?
            GROUP BY ph.date ORDER BY ph.date`,
      args: [userId, from, to],
    }),
    c.execute({
      sql: `SELECT ci.quantity, ci.acquired_price, ci.acquired_date
            FROM collection_items ci
            JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
            WHERE ci.acquired_price IS NOT NULL`,
      args: [userId],
    }),
  ]);
  const value: Point[] = hist.rows.map((x) => ({ date: String(x.date), value: Number(x.v) }));

  const undated = lots.rows
    .filter((x) => x.acquired_date == null)
    .reduce((t, x) => t + Number(x.quantity) * Number(x.acquired_price), 0);
  const dated = lots.rows
    .filter((x) => x.acquired_date != null)
    .map((x) => ({ date: String(x.acquired_date), amount: Number(x.quantity) * Number(x.acquired_price) }));

  // One cost point per day the value line has, so the two series share an x-axis exactly.
  const cost: Point[] = value.map((p) => ({
    date: p.date,
    value: undated + dated.reduce((t, l) => (l.date <= p.date ? t + l.amount : t), 0),
  }));
  return { value, cost };
}
