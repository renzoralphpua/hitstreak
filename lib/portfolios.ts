// lib/portfolios.ts
// User collections. Every function takes userId first and scopes through portfolios.user_id;
// a wrong owner sees "not found" (false / empty), never someone else's data.
import { db } from "@/lib/db";

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Portfolio { id: number; name: string; createdAt: string }
export interface Holding {
  itemId: number; printingId: number; cardId: number; cardName: string; setName: string; number: string | null;
  subtype: string; imageUrl: string | null; quantity: number; condition: Condition;
  acquiredPrice: number | null; acquiredDate: string | null;
  market: number | null; priceDate: string | null;
  value: number | null;   // quantity × market, null when unpriced
  cost: number | null;    // quantity × acquiredPrice, null when unknown
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

function checkQuantity(q: number) {
  if (!Number.isInteger(q) || q <= 0 || q > 9999) throw new Error("Quantity must be a whole number from 1 to 9999");
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

/** Adds copies; an existing row for the same (portfolio, printing, condition) is merged (quantity
 *  summed, acquired price/date kept unless the existing row has none). */
export async function addItem(userId: string, portfolioId: number, input: AddItemInput): Promise<void> {
  await assertOwnsPortfolio(userId, portfolioId);
  checkQuantity(input.quantity);
  const condition = checkCondition(input.condition);
  const price = checkPrice(input.acquiredPrice);
  const acquiredDate = checkDate(input.acquiredDate);
  await assertPrintingExists(input.printingId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO collection_items (portfolio_id, printing_id, quantity, condition, acquired_price, acquired_date)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(portfolio_id, printing_id, condition) DO UPDATE SET
            quantity = MIN(quantity + excluded.quantity, 9999),
            acquired_price = COALESCE(collection_items.acquired_price, excluded.acquired_price),
            acquired_date = COALESCE(collection_items.acquired_date, excluded.acquired_date)`,
    args: [portfolioId, input.printingId, input.quantity, condition, price, acquiredDate],
  });
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
          ORDER BY (ci.quantity * COALESCE(lp.market, 0)) DESC, ca.name`,
    args: [userId, portfolioId],
  });
  return r.rows.map((x) => {
    const quantity = Number(x.quantity);
    const market = x.market == null ? null : Number(x.market);
    const acquiredPrice = x.acquired_price == null ? null : Number(x.acquired_price);
    return {
      itemId: Number(x.item_id), printingId: Number(x.printing_id), cardId: Number(x.card_id),
      cardName: String(x.card_name), setName: String(x.set_name), number: x.number == null ? null : String(x.number),
      subtype: String(x.subtype), imageUrl: x.image_url == null ? null : String(x.image_url),
      quantity, condition: String(x.condition) as Condition, acquiredPrice, acquiredDate: x.acquired_date == null ? null : String(x.acquired_date),
      market, priceDate: x.price_date == null ? null : String(x.price_date),
      value: market == null ? null : quantity * market,
      cost: acquiredPrice == null ? null : quantity * acquiredPrice,
    };
  });
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
