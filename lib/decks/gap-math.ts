// lib/decks/gap-math.ts
// Pure gap arithmetic, split out of lib/decks/gap.ts so the builder ("use client") can reuse it without
// dragging lib/db into the client bundle (same reason as lib/ranges.ts). Nothing here may import a
// db-backed module at runtime — tests/ranges.test.ts guards that; `import type` is erased and allowed.
import { identityKey } from "./identity";
import type { GameSlug } from "./types";
import type { DeckLine } from "./data";

export interface GapLine extends DeckLine { key: string; owned: number; missing: number; missingCost: number | null }
export interface GapAnalysis { lines: GapLine[]; total: number; owned: number; missing: number; missingCost: number; unpricedMissing: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Allocate `owned` copies to the deck's lines in order; price missing copies at the line's market.
 *  Takes the structural minimum, not a whole DeckDetail, so the builder can pass unsaved lines. */
export function analyzeGap(deck: { gameSlug: GameSlug; cards: DeckLine[] }, owned: Map<string, number>): GapAnalysis {
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
