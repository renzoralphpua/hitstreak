// lib/sales.ts
// Selling draws a lot DOWN; it never deletes one.
//
// That is the whole design. `collection_items` stays a record of acquisitions, `sales` records
// disposals, and what you still hold is the difference — exposed by the `lot_holdings` view so
// ownership stops counting a sold copy in one place rather than nineteen.
//
// Two consequences fall out of it, and both are the point:
//   • a sold card remains a historical row in the collection rather than a hole, and
//   • collection_history does not read a sale as a price crash, because realised proceeds are
//     carried alongside held value instead of one replacing the other.
//
// Money is USD here like everywhere else. A price handed over in pesos at a table is converted on
// the way in (lib/money-input.ts).
import { db } from "@/lib/db";
import { CONDITIONS, type Condition } from "@/lib/collections";

export interface Sale {
  id: number;
  itemId: number;
  quantity: number;
  /** Dollars per copy. */
  unitPrice: number;
  /** Dollars, for the whole sale — a table fee, a shipping cost. Usually 0 selling in person. */
  fees: number;
  /** Dollars per copy, as the lot's cost basis stood ON THE DAY. Null when the lot had none. */
  unitCost: number | null;
  soldDate: string;
  venue: string | null;
  createdAt: string;
  /** Denormalised for display, so a sales list does not need a second query per row. */
  cardId: number;
  cardName: string;
  setName: string;
  number: string | null;
  subtype: string;
  condition: Condition;
}

export interface SellInput {
  /** The exact lot being sold from. Specific-lot, not FIFO: we already model each acquisition
   *  separately, so "I sold THAT copy, the one I paid 1,100 for" is both truer and simpler. */
  itemId: number;
  quantity: number;
  /** Dollars per copy. */
  unitPrice: number;
  fees?: number;
  /** YYYY-MM-DD. Defaults to today. */
  soldDate?: string;
  venue?: string | null;
}

const MAX_FEES = 1_000_000;

function checkMoney(v: number, what: string): number {
  if (!Number.isFinite(v) || v < 0) throw new Error(`${what} must be zero or more`);
  if (v > MAX_FEES) throw new Error(`${what} is implausibly large`);
  // Two decimal places: a per-copy price with more is a conversion artefact, not a fact.
  return Math.round(v * 100) / 100;
}

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** What a sale realised: proceeds less fees, against the cost of the copies that left. */
export const realisedOf = (s: Pick<Sale, "quantity" | "unitPrice" | "fees" | "unitCost">) => {
  const proceeds = s.quantity * s.unitPrice - s.fees;
  // Null cost means null profit, not zero profit: "I made $200" and "I made $200 on something that
  // cost me an unknown amount" are different claims, and only one of them is safe to add up.
  const cost = s.unitCost == null ? null : s.quantity * s.unitCost;
  return { proceeds, cost, gain: cost == null ? null : proceeds - cost };
};

async function ownedLot(userId: string, itemId: number) {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT h.id, h.quantity AS held, h.acquired_price, ci.collection_id
          FROM lot_holdings h
          JOIN collection_items ci ON ci.id = h.id
          JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
          WHERE h.id = ?`,
    args: [userId, itemId],
  });
  if (r.rows.length === 0) throw new Error("Lot not found");
  return r.rows[0];
}

/**
 * Record a sale against one lot.
 *
 * `unit_cost` is SNAPSHOTTED from the lot here and never recomputed. Realised profit is a fact about
 * a day that has passed; editing what you paid afterwards must not rewrite what you made.
 */
export async function sellLot(userId: string, input: SellInput): Promise<void> {
  const lot = await ownedLot(userId, input.itemId);
  const held = Number(lot.held);

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be a whole number of copies");
  }
  if (input.quantity > held) {
    throw new Error(held === 0 ? "That lot is already sold" : `You only hold ${held} of these`);
  }
  const unitPrice = checkMoney(input.unitPrice, "Sale price");
  const fees = checkMoney(input.fees ?? 0, "Fees");
  const soldDate = input.soldDate ?? new Date().toISOString().slice(0, 10);
  if (!isDate(soldDate)) throw new Error("Sale date must be YYYY-MM-DD");

  const venue = input.venue?.trim() ? input.venue.trim().slice(0, 120) : null;

  const c = await db();
  await c.execute({
    sql: `INSERT INTO sales (item_id, quantity, unit_price, fees, unit_cost, sold_date, venue)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [input.itemId, input.quantity, unitPrice, fees, lot.acquired_price ?? null, soldDate, venue],
  });
}

/** Undo a sale. The copies return to their lot, because the lot never went anywhere. */
export async function unsell(userId: string, saleId: number): Promise<boolean> {
  const c = await db();
  const r = await c.execute({
    sql: `DELETE FROM sales WHERE id = ? AND item_id IN (
            SELECT ci.id FROM collection_items ci
            JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?)`,
    args: [saleId, userId],
  });
  return r.rowsAffected === 1;
}

const rowToSale = (x: Record<string, unknown>): Sale => ({
  id: Number(x.id), itemId: Number(x.item_id), quantity: Number(x.quantity),
  unitPrice: Number(x.unit_price), fees: Number(x.fees),
  unitCost: x.unit_cost == null ? null : Number(x.unit_cost),
  soldDate: String(x.sold_date), venue: x.venue == null ? null : String(x.venue),
  createdAt: String(x.created_at),
  cardId: Number(x.card_id), cardName: String(x.card_name), setName: String(x.set_name),
  number: x.number == null ? null : String(x.number), subtype: String(x.subtype),
  condition: String(x.condition) as Condition,
});

const SALE_SELECT = `
  SELECT s.id, s.item_id, s.quantity, s.unit_price, s.fees, s.unit_cost, s.sold_date, s.venue, s.created_at,
         ca.id AS card_id, ca.name AS card_name, ca.number, se.name AS set_name, p.subtype, ci.condition
  FROM sales s
  JOIN collection_items ci ON ci.id = s.item_id
  JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
  JOIN printings p ON p.id = ci.printing_id
  JOIN cards ca ON ca.id = p.card_id
  JOIN sets se ON se.id = ca.set_id`;

/** Every sale from one collection, newest first. */
export async function listSales(userId: string, collectionId: number): Promise<Sale[]> {
  const c = await db();
  const r = await c.execute({
    sql: `${SALE_SELECT} WHERE ci.collection_id = ? ORDER BY s.sold_date DESC, s.id DESC`,
    args: [userId, collectionId],
  });
  return r.rows.map((x) => rowToSale(x as unknown as Record<string, unknown>));
}

export interface RealisedSummary {
  /** Copies sold. */
  quantity: number;
  /** Proceeds less fees, in dollars. Known for every sale. */
  proceeds: number;
  /** Cost of the copies that left. Covers only the sales whose lot HAD a cost basis. */
  cost: number;
  /** proceeds − cost, over those same sales. */
  gain: number;
  /** Copies sold from a lot with no recorded cost. They inflate `gain`, exactly as an uncosted
   *  holding inflates an unrealised one, so the UI has to be able to say so. */
  uncostedQuantity: number;
  fees: number;
}

/** What a collection has actually made, as opposed to what it might make. */
export async function realisedFor(userId: string, collectionId: number): Promise<RealisedSummary> {
  const sales = await listSales(userId, collectionId);
  const out: RealisedSummary = { quantity: 0, proceeds: 0, cost: 0, gain: 0, uncostedQuantity: 0, fees: 0 };
  for (const s of sales) {
    const r = realisedOf(s);
    out.quantity += s.quantity;
    out.proceeds += r.proceeds;
    out.fees += s.fees;
    if (r.cost == null) out.uncostedQuantity += s.quantity;
    else { out.cost += r.cost; out.gain += r.gain!; }
  }
  return out;
}

/** Realised proceeds per collection as at a date, for the nightly history materialisation. */
export async function realisedAsOf(date: string): Promise<Map<number, number>> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT ci.collection_id AS id, SUM(s.quantity * s.unit_price - s.fees) AS proceeds
          FROM sales s JOIN collection_items ci ON ci.id = s.item_id
          WHERE s.sold_date <= ? GROUP BY ci.collection_id`,
    args: [date],
  });
  return new Map(r.rows.map((x) => [Number(x.id), Number(x.proceeds)]));
}

export { CONDITIONS };
