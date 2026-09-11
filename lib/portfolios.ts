// lib/portfolios.ts
// User collections. Every function takes userId first and scopes through portfolios.user_id;
// a wrong owner sees "not found" (false / empty), never someone else's data.
import { db } from "@/lib/db";

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Portfolio { id: number; name: string; createdAt: string }

/**
 * One acquisition. Buying the same card twice at different prices makes two lots, because that is
 * what happened — a holding's cost basis is the sum over its lots, never one price times a total.
 */
export interface Lot {
  itemId: number;
  quantity: number;
  acquiredPrice: number | null;   // dollars, per copy in THIS lot
  acquiredDate: string | null;
  cost: number | null;            // quantity × acquiredPrice, null when the price was never recorded
}

/** One printing+condition you own, with the lots it is made of. */
export interface Holding {
  printingId: number; cardId: number; cardName: string; setName: string; number: string | null;
  subtype: string; imageUrl: string | null; condition: Condition;
  quantity: number;       // summed across lots
  market: number | null; priceDate: string | null;
  value: number | null;   // quantity × market, null when unpriced
  /** Summed over lots that HAVE a price. Null only when no lot does. Read it with
   *  `uncostedQuantity`: cost covers `quantity - uncostedQuantity` copies, not all of them. */
  cost: number | null;
  /** Copies whose purchase price was never recorded. They inflate gain, so the UI prompts for one
   *  (the grid tile's "Add cost"). */
  uncostedQuantity: number;
  lots: Lot[];            // newest first
}
export interface PortfolioSummary { cards: number; value: number; cost: number; gain: number; unpriced: number }

const NAME_MAX = 80;
function cleanName(name: string): string {
  const n = name.trim();
  if (n.length === 0 || n.length > NAME_MAX) throw new Error(`Portfolio name must be 1–${NAME_MAX} characters`);
  return n;
}

export async function listPortfolios(userId: string): Promise<Portfolio[]> {
  const c = await db();
  const r = await c.execute({ sql: "SELECT id, name, created_at FROM portfolios WHERE user_id = ? ORDER BY created_at, id", args: [userId] });
  return r.rows.map((x) => ({ id: Number(x.id), name: String(x.name), createdAt: String(x.created_at) }));
}

export async function getPortfolio(userId: string, id: number): Promise<Portfolio | null> {
  const c = await db();
  const r = await c.execute({ sql: "SELECT id, name, created_at FROM portfolios WHERE id = ? AND user_id = ?", args: [id, userId] });
  if (r.rows.length === 0) return null;
  const x = r.rows[0];
  return { id: Number(x.id), name: String(x.name), createdAt: String(x.created_at) };
}

export async function createPortfolio(userId: string, name: string): Promise<Portfolio> {
  const c = await db();
  const r = await c.execute({ sql: "INSERT INTO portfolios (user_id, name) VALUES (?, ?) RETURNING id, name, created_at", args: [userId, cleanName(name)] });
  const x = r.rows[0];
  return { id: Number(x.id), name: String(x.name), createdAt: String(x.created_at) };
}

export async function renamePortfolio(userId: string, id: number, name: string): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: "UPDATE portfolios SET name = ? WHERE id = ? AND user_id = ?", args: [cleanName(name), id, userId] });
  return r.rowsAffected === 1;
}

export async function deletePortfolio(userId: string, id: number): Promise<boolean> {
  const c = await db();
  const own = await c.execute({ sql: "SELECT 1 FROM portfolios WHERE id = ? AND user_id = ?", args: [id, userId] });
  if (own.rows.length === 0) return false;
  await c.batch(
    [
      { sql: "DELETE FROM collection_items WHERE portfolio_id = ?", args: [id] },
      { sql: "DELETE FROM portfolio_history WHERE portfolio_id = ?", args: [id] },
      { sql: "DELETE FROM share_links WHERE portfolio_id = ?", args: [id] },
      { sql: "DELETE FROM portfolios WHERE id = ? AND user_id = ?", args: [id, userId] },
    ],
    "write"
  );
  return true;
}

async function assertOwnsPortfolio(userId: string, portfolioId: number) {
  const c = await db();
  const r = await c.execute({ sql: "SELECT 1 FROM portfolios WHERE id = ? AND user_id = ?", args: [portfolioId, userId] });
  if (r.rows.length === 0) throw new Error("Portfolio not found");
}

/** Ceiling on a single lot AND on a holding's total across lots. */
export const QUANTITY_MAX = 9999;
function checkQuantity(q: number) {
  if (!Number.isInteger(q) || q <= 0 || q > QUANTITY_MAX) throw new Error(`Quantity must be a whole number from 1 to ${QUANTITY_MAX}`);
}
function checkCondition(cnd: string): Condition {
  if (!(CONDITIONS as readonly string[]).includes(cnd)) throw new Error(`Condition must be one of ${CONDITIONS.join(", ")}`);
  return cnd as Condition;
}
function checkPrice(p: number | null | undefined): number | null {
  if (p == null) return null;
  if (!Number.isFinite(p) || p < 0) throw new Error("Price must be zero or more");
  return p;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function checkDate(d: string | null | undefined): string | null {
  if (d == null) return null;
  if (!DATE_RE.test(d)) throw new Error("Date must be in YYYY-MM-DD format");
  return d;
}
async function assertPrintingExists(printingId: number) {
  const c = await db();
  const r = await c.execute({ sql: "SELECT 1 FROM printings WHERE id = ?", args: [printingId] });
  if (r.rows.length === 0) throw new Error("Printing not found");
}

export interface AddItemInput { printingId: number; quantity: number; condition: string; acquiredPrice?: number | null; acquiredDate?: string | null }

/**
 * Records an acquisition as its own lot. Adding a card you already own NEVER merges into the
 * existing row: this used to upsert with `COALESCE(existing_price, new_price)`, which meant the
 * price you had just typed was discarded and every later copy was valued at the first copy's price.
 *
 * The 9999 ceiling now applies to the holding's total across lots rather than to one row, and it
 * rejects instead of silently clamping — quietly dropping copies is the same class of bug.
 */
export async function addItem(userId: string, portfolioId: number, input: AddItemInput): Promise<void> {
  await assertOwnsPortfolio(userId, portfolioId);
  checkQuantity(input.quantity);
  const condition = checkCondition(input.condition);
  const price = checkPrice(input.acquiredPrice);
  const acquiredDate = checkDate(input.acquiredDate);
  await assertPrintingExists(input.printingId);
  const c = await db();
  const held = await c.execute({
    sql: `SELECT COALESCE(SUM(quantity), 0) AS n FROM collection_items
          WHERE portfolio_id = ? AND printing_id = ? AND condition = ?`,
    args: [portfolioId, input.printingId, condition],
  });
  if (Number(held.rows[0].n) + input.quantity > QUANTITY_MAX) {
    throw new Error(`That would take this holding past ${QUANTITY_MAX} copies`);
  }
  await c.execute({
    sql: `INSERT INTO collection_items (portfolio_id, printing_id, quantity, condition, acquired_price, acquired_date)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [portfolioId, input.printingId, input.quantity, condition, price, acquiredDate],
  });
}

/**
 * Removes one copy, taking it from the NEWEST lot and deleting that lot when it empties.
 *
 * Newest-first is the honest default for an undo: the copy you most likely want gone is the one you
 * most recently recorded. Removing a copy needs no price, which is why this exists as a holding-level
 * operation while *adding* one does not — an addition is an acquisition and goes through `addItem`.
 */
export async function decrementHolding(userId: string, portfolioId: number, printingId: number, condition: string): Promise<boolean> {
  await assertOwnsPortfolio(userId, portfolioId);
  const c = await db();
  const r = await c.execute({
    sql: `SELECT id, quantity FROM collection_items
          WHERE portfolio_id = ? AND printing_id = ? AND condition = ?
          ORDER BY created_at DESC, id DESC LIMIT 1`,
    args: [portfolioId, printingId, checkCondition(condition)],
  });
  if (r.rows.length === 0) return false;
  const id = Number(r.rows[0].id);
  const quantity = Number(r.rows[0].quantity);
  await c.execute(
    quantity > 1
      ? { sql: "UPDATE collection_items SET quantity = quantity - 1 WHERE id = ?", args: [id] }
      : { sql: "DELETE FROM collection_items WHERE id = ?", args: [id] }
  );
  return true;
}

/** Removes a whole holding — every lot of that printing+condition. */
export async function removeHolding(userId: string, portfolioId: number, printingId: number, condition: string): Promise<boolean> {
  await assertOwnsPortfolio(userId, portfolioId);
  const c = await db();
  const r = await c.execute({
    sql: "DELETE FROM collection_items WHERE portfolio_id = ? AND printing_id = ? AND condition = ?",
    args: [portfolioId, printingId, checkCondition(condition)],
  });
  return r.rowsAffected > 0;
}

export async function updateItem(userId: string, itemId: number, patch: { quantity?: number; acquiredPrice?: number | null; acquiredDate?: string | null }): Promise<boolean> {
  if (patch.quantity !== undefined) checkQuantity(patch.quantity);
  const price = patch.acquiredPrice === undefined ? undefined : checkPrice(patch.acquiredPrice);
  const date = patch.acquiredDate === undefined ? undefined : checkDate(patch.acquiredDate);
  const c = await db();
  const r = await c.execute({
    sql: `UPDATE collection_items SET
            quantity = COALESCE(?, quantity),
            acquired_price = CASE WHEN ? THEN ? ELSE acquired_price END,
            acquired_date = CASE WHEN ? THEN ? ELSE acquired_date END
          WHERE id = ? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)`,
    args: [patch.quantity ?? null, price !== undefined ? 1 : 0, price ?? null, date !== undefined ? 1 : 0, date ?? null, itemId, userId],
  });
  return r.rowsAffected === 1;
}

export async function removeItem(userId: string, itemId: number): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: "DELETE FROM collection_items WHERE id = ? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)", args: [itemId, userId] });
  return r.rowsAffected === 1;
}

export async function getPortfolioHoldings(userId: string, portfolioId: number): Promise<Holding[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT ci.id AS item_id, ci.printing_id, ci.quantity, ci.condition, ci.acquired_price, ci.acquired_date,
                 ca.id AS card_id, ca.name AS card_name, ca.number, ca.image_url, se.name AS set_name, p.subtype,
                 lp.market, lp.date AS price_date
          FROM collection_items ci
          JOIN portfolios po ON po.id = ci.portfolio_id AND po.user_id = ?
          JOIN printings p ON p.id = ci.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE ci.portfolio_id = ?
          ORDER BY ci.created_at DESC, ci.id DESC`,
    args: [userId, portfolioId],
  });

  // Rows are lots; the binder shows one row per printing+condition, so fold them here and keep the
  // lots reachable underneath. Sorting by value has to happen after the fold — a single lot's value
  // says nothing about what the holding is worth.
  const byHolding = new Map<string, Holding>();
  for (const x of r.rows) {
    const printingId = Number(x.printing_id);
    const condition = String(x.condition) as Condition;
    const key = `${printingId}|${condition}`;
    const market = x.market == null ? null : Number(x.market);
    const quantity = Number(x.quantity);
    const acquiredPrice = x.acquired_price == null ? null : Number(x.acquired_price);
    const lot: Lot = {
      itemId: Number(x.item_id),
      quantity,
      acquiredPrice,
      acquiredDate: x.acquired_date == null ? null : String(x.acquired_date),
      cost: acquiredPrice == null ? null : quantity * acquiredPrice,
    };
    const existing = byHolding.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.lots.push(lot);
    } else {
      byHolding.set(key, {
        printingId, cardId: Number(x.card_id), cardName: String(x.card_name), setName: String(x.set_name),
        number: x.number == null ? null : String(x.number), subtype: String(x.subtype),
        imageUrl: x.image_url == null ? null : String(x.image_url), condition,
        quantity, market, priceDate: x.price_date == null ? null : String(x.price_date),
        value: null, cost: null, uncostedQuantity: 0, lots: [lot],
      });
    }
  }

  const holdings = [...byHolding.values()];
  for (const h of holdings) {
    h.value = h.market == null ? null : h.quantity * h.market;
    // A lot with no recorded price contributes copies but no cost, so it is counted separately
    // rather than folded in as zero — zero would read as "free", which is a different claim.
    const priced = h.lots.filter((l) => l.cost != null);
    h.cost = priced.length === 0 ? null : priced.reduce((sum, l) => sum + l.cost!, 0);
    h.uncostedQuantity = h.lots.reduce((n, l) => (l.cost == null ? n + l.quantity : n), 0);
  }
  holdings.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.cardName.localeCompare(b.cardName));
  return holdings;
}

export async function getPortfolioSummary(userId: string, portfolioId: number): Promise<PortfolioSummary> {
  const h = await getPortfolioHoldings(userId, portfolioId);
  let cards = 0, value = 0, cost = 0, unpriced = 0;
  for (const x of h) {
    cards += x.quantity;
    if (x.value == null) unpriced += x.quantity; else value += x.value;
    if (x.cost != null) cost += x.cost;
  }
  return { cards, value, cost, gain: value - cost, unpriced };
}

export interface CardHolder {
  portfolioId: number; name: string; quantity: number;
  /** Summed over lots that have a price. Null when none does. */
  cost: number | null;
  /** Copies with no recorded purchase price — `cost` does not cover these. */
  uncostedQuantity: number;
}
/** The signed-in user's binders that hold any printing of `cardId`, with copies and what they cost. */
export async function getCardHolders(userId: string, cardId: number): Promise<CardHolder[]> {
  const c = await db();
  const r = await c.execute({
    // Summed per lot: quantity × that lot's price, so two purchases at different prices add up to
    // what was actually paid rather than to one price times the total.
    sql: `SELECT po.id, po.name,
                 SUM(ci.quantity) AS quantity,
                 SUM(CASE WHEN ci.acquired_price IS NULL THEN 0 ELSE ci.quantity * ci.acquired_price END) AS cost,
                 SUM(CASE WHEN ci.acquired_price IS NULL THEN ci.quantity ELSE 0 END) AS uncosted,
                 SUM(CASE WHEN ci.acquired_price IS NULL THEN 0 ELSE 1 END) AS priced_lots
          FROM collection_items ci
          JOIN portfolios po ON po.id = ci.portfolio_id AND po.user_id = ?
          JOIN printings p ON p.id = ci.printing_id
          WHERE p.card_id = ?
          GROUP BY po.id ORDER BY quantity DESC, po.name`,
    args: [userId, cardId],
  });
  return r.rows.map((x) => ({
    portfolioId: Number(x.id),
    name: String(x.name),
    quantity: Number(x.quantity),
    cost: Number(x.priced_lots) === 0 ? null : Number(x.cost),
    uncostedQuantity: Number(x.uncosted),
  }));
}
