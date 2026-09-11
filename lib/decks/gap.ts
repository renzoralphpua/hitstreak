// lib/decks/gap.ts — spec §5: gap analysis at read time. Ownership is the user's copies across ALL collections,
// aggregated by identity key (any printing counts), allocated to the deck's lines in order.
// The arithmetic itself lives in ./gap-math (db-free, so the builder can run it in the browser) and is
// re-exported here so every server-side import site keeps reading `analyzeGap` from this module.
import { db } from "@/lib/db";
import { identityKey } from "./identity";
import type { GameSlug } from "./types";

export * from "./gap-math";

/** identity key → total copies the user owns of that card (any printing, any collection) within one game. */
export async function loadOwnedByKey(userId: string, gameSlug: GameSlug): Promise<Map<string, number>> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT ca.name, ca.attrs, SUM(ci.quantity) AS n
          FROM collection_items ci
          JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
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
