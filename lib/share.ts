// lib/share.ts
// Read-only share links. One per collection; the token is the only credential (spec §9: token lookup
// only, disabled links 404). A visitor sees the collection at market value — never cost basis or gain,
// and nothing else about the owner.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getCollectionHoldings, getCollectionSummary, type Holding } from "@/lib/collections";

export interface ShareLink { token: string; enabled: boolean; createdAt: string }

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes as base64url
export const isShareToken = (s: string): boolean => TOKEN_RE.test(s);
const newToken = () => randomBytes(16).toString("base64url");

async function assertOwnsCollection(userId: string, collectionId: number) {
  const c = await db();
  const r = await c.execute({ sql: "SELECT 1 FROM collections WHERE id = ? AND user_id = ?", args: [collectionId, userId] });
  if (r.rows.length === 0) throw new Error("Collection not found");
}

export async function getShareLink(userId: string, collectionId: number): Promise<ShareLink | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT sl.token, sl.enabled, sl.created_at FROM share_links sl
          JOIN collections po ON po.id = sl.collection_id AND po.user_id = ?
          WHERE sl.collection_id = ?`,
    args: [userId, collectionId],
  });
  if (r.rows.length === 0) return null;
  const x = r.rows[0];
  return { token: String(x.token), enabled: Number(x.enabled) === 1, createdAt: String(x.created_at) };
}

/** Turns sharing on: creates the link on first use, re-enables the SAME token afterwards. */
export async function enableShare(userId: string, collectionId: number): Promise<ShareLink> {
  await assertOwnsCollection(userId, collectionId);
  const c = await db();
  await c.execute({
    sql: "INSERT INTO share_links (collection_id, token, enabled) VALUES (?, ?, 1) ON CONFLICT(collection_id) DO UPDATE SET enabled = 1",
    args: [collectionId, newToken()],
  });
  return (await getShareLink(userId, collectionId))!;
}

/** Replaces the token (every old URL stops working) and leaves sharing on. */
export async function regenerateShare(userId: string, collectionId: number): Promise<ShareLink> {
  await assertOwnsCollection(userId, collectionId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO share_links (collection_id, token, enabled) VALUES (?, ?, 1)
          ON CONFLICT(collection_id) DO UPDATE SET token = excluded.token, enabled = 1`,
    args: [collectionId, newToken()],
  });
  return (await getShareLink(userId, collectionId))!;
}

export async function disableShare(userId: string, collectionId: number): Promise<boolean> {
  const c = await db();
  const r = await c.execute({
    sql: "UPDATE share_links SET enabled = 0 WHERE collection_id = ? AND collection_id IN (SELECT id FROM collections WHERE user_id = ?)",
    args: [collectionId, userId],
  });
  return r.rowsAffected === 1;
}

/** What a visitor may see. Everything the owner paid is deliberately absent. */
export type PublicHolding = Omit<Holding, "cost" | "uncostedQuantity" | "lots">;
export interface SharedCollection { ownerId: string; collectionId: number; name: string; holdings: PublicHolding[]; value: number; cards: number; unpriced: number }

// Lots carry acquisition prices and dates, so they are dropped wholesale rather than filtered —
// what the owner paid must never reach a public link, and neither must when they bought it.
const toPublic = (h: Holding): PublicHolding => ({
  printingId: h.printingId, cardId: h.cardId, cardName: h.cardName, setName: h.setName, number: h.number,
  subtype: h.subtype, imageUrl: h.imageUrl, quantity: h.quantity, condition: h.condition, market: h.market, priceDate: h.priceDate, value: h.value,
});

/** The collection behind an enabled token, or null for unknown, malformed, or disabled tokens. */
export async function getSharedCollection(token: string): Promise<SharedCollection | null> {
  if (!isShareToken(token)) return null;
  const c = await db();
  const r = await c.execute({
    sql: `SELECT po.id, po.user_id, po.name FROM share_links sl
          JOIN collections po ON po.id = sl.collection_id
          WHERE sl.token = ? AND sl.enabled = 1`,
    args: [token],
  });
  if (r.rows.length === 0) return null;
  const ownerId = String(r.rows[0].user_id), collectionId = Number(r.rows[0].id);
  const [holdings, summary] = await Promise.all([getCollectionHoldings(ownerId, collectionId), getCollectionSummary(ownerId, collectionId)]);
  return { ownerId, collectionId, name: String(r.rows[0].name), holdings: holdings.map(toPublic), value: summary.value, cards: summary.cards, unpriced: summary.unpriced };
}
