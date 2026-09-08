// lib/decks/gap.ts — spec §5: gap analysis at read time. Ownership is the user's copies across ALL binders,
// aggregated by identity key (any printing counts), allocated to the deck's lines in order.
import { db } from "@/lib/db";
import { identityKey } from "./identity";
import type { GameSlug } from "./types";
import type { DeckDetail, DeckLine } from "./data";

export interface GapLine extends DeckLine { key: string; owned: number; missing: number; missingCost: number | null }
export interface GapAnalysis { lines: GapLine[]; total: number; owned: number; missing: number; missingCost: number; unpricedMissing: number }

/** identity key → total copies the user owns of that card (any printing, any binder) within one game. */
export async function loadOwnedByKey(userId: string, gameSlug: GameSlug): Promise<Map<string, number>> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT ca.name, ca.attrs, SUM(ci.quantity) AS n
          FROM collection_items ci
          JOIN portfolios po ON po.id = ci.portfolio_id AND po.user_id = ?
          JOIN printings p ON p.id = ci.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          JOIN games g ON g.id = se.game_id AND g.slug = ?
          GROUP BY ca.id`,
    args: [userId, gameSlug],
  })).rows;
  const owned = new Map<string, number>();
  for (const r of rows) {
    let attrs: Record<string, string> = {};
    try { attrs = JSON.parse(String(r.attrs ?? "{}")); } catch { /* keep {} */ }
    const k = identityKey(gameSlug, { name: String(r.name), attrs });
    owned.set(k, (owned.get(k) ?? 0) + Number(r.n));
  }
  return owned;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: allocate `owned` copies to the deck's lines in order; price missing copies at the line's market. */
export function analyzeGap(deck: DeckDetail, owned: Map<string, number>): GapAnalysis {
  const left = new Map(owned); // never drain the caller's map
  const lines: GapLine[] = deck.cards.map((l) => {
    const key = identityKey(deck.gameSlug, l);
    const have = left.get(key) ?? 0;
    const use = Math.min(have, l.quantity);
    left.set(key, have - use);
    const missing = l.quantity - use;
    return { ...l, key, owned: use, missing, missingCost: missing === 0 ? 0 : l.market == null ? null : round2(missing * l.market) };
  });
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const ownedN = lines.reduce((n, l) => n + l.owned, 0);
  const missingCost = round2(lines.reduce((n, l) => n + (l.missingCost ?? 0), 0));
  const unpricedMissing = lines.filter((l) => l.missing > 0 && l.market == null).reduce((n, l) => n + l.missing, 0);
  return { lines, total, owned: ownedN, missing: total - ownedN, missingCost, unpricedMissing };
}
