// lib/share.ts
// Read-only share links. One per binder; the token is the only credential (spec §9: token lookup
// only, disabled links 404). A visitor sees the binder at market value — never cost basis or gain,
// and nothing else about the owner.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getPortfolioHoldings, getPortfolioSummary, type Holding } from "@/lib/portfolios";

export interface ShareLink { token: string; enabled: boolean; createdAt: string }

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes as base64url
export const isShareToken = (s: string): boolean => TOKEN_RE.test(s);
const newToken = () => randomBytes(16).toString("base64url");

async function assertOwnsPortfolio(userId: string, portfolioId: number) {
  const c = await db();
  const r = await c.execute({ sql: "SELECT 1 FROM portfolios WHERE id = ? AND user_id = ?", args: [portfolioId, userId] });
  if (r.rows.length === 0) throw new Error("Portfolio not found");
}

export async function getShareLink(userId: string, portfolioId: number): Promise<ShareLink | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT sl.token, sl.enabled, sl.created_at FROM share_links sl
          JOIN portfolios po ON po.id = sl.portfolio_id AND po.user_id = ?
          WHERE sl.portfolio_id = ?`,
    args: [userId, portfolioId],
  });
  if (r.rows.length === 0) return null;
  const x = r.rows[0];
  return { token: String(x.token), enabled: Number(x.enabled) === 1, createdAt: String(x.created_at) };
}

/** Turns sharing on: creates the link on first use, re-enables the SAME token afterwards. */
export async function enableShare(userId: string, portfolioId: number): Promise<ShareLink> {
  await assertOwnsPortfolio(userId, portfolioId);
  const c = await db();
  await c.execute({
    sql: "INSERT INTO share_links (portfolio_id, token, enabled) VALUES (?, ?, 1) ON CONFLICT(portfolio_id) DO UPDATE SET enabled = 1",
    args: [portfolioId, newToken()],
  });
  return (await getShareLink(userId, portfolioId))!;
}

/** Replaces the token (every old URL stops working) and leaves sharing on. */
export async function regenerateShare(userId: string, portfolioId: number): Promise<ShareLink> {
  await assertOwnsPortfolio(userId, portfolioId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO share_links (portfolio_id, token, enabled) VALUES (?, ?, 1)
          ON CONFLICT(portfolio_id) DO UPDATE SET token = excluded.token, enabled = 1`,
    args: [portfolioId, newToken()],
  });
  return (await getShareLink(userId, portfolioId))!;
}

export async function disableShare(userId: string, portfolioId: number): Promise<boolean> {
  const c = await db();
  const r = await c.execute({
    sql: "UPDATE share_links SET enabled = 0 WHERE portfolio_id = ? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id = ?)",
    args: [portfolioId, userId],
  });
  return r.rowsAffected === 1;
}

/** What a visitor may see. Everything the owner paid is deliberately absent. */
export type PublicHolding = Omit<Holding, "cost" | "uncostedQuantity" | "lots">;
export interface SharedPortfolio { ownerId: string; portfolioId: number; name: string; holdings: PublicHolding[]; value: number; cards: number; unpriced: number }

// Lots carry acquisition prices and dates, so they are dropped wholesale rather than filtered —
// what the owner paid must never reach a public link, and neither must when they bought it.
const toPublic = (h: Holding): PublicHolding => ({
  printingId: h.printingId, cardId: h.cardId, cardName: h.cardName, setName: h.setName, number: h.number,
  subtype: h.subtype, imageUrl: h.imageUrl, quantity: h.quantity, condition: h.condition, market: h.market, priceDate: h.priceDate, value: h.value,
});

/** The binder behind an enabled token, or null for unknown, malformed, or disabled tokens. */
export async function getSharedPortfolio(token: string): Promise<SharedPortfolio | null> {
  if (!isShareToken(token)) return null;
  const c = await db();
  const r = await c.execute({
    sql: `SELECT po.id, po.user_id, po.name FROM share_links sl
          JOIN portfolios po ON po.id = sl.portfolio_id
          WHERE sl.token = ? AND sl.enabled = 1`,
    args: [token],
  });
  if (r.rows.length === 0) return null;
  const ownerId = String(r.rows[0].user_id), portfolioId = Number(r.rows[0].id);
  const [holdings, summary] = await Promise.all([getPortfolioHoldings(ownerId, portfolioId), getPortfolioSummary(ownerId, portfolioId)]);
  return { ownerId, portfolioId, name: String(r.rows[0].name), holdings: holdings.map(toPublic), value: summary.value, cards: summary.cards, unpriced: summary.unpriced };
}
