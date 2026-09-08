"use client";
import { useCallback, useEffect, useState } from "react";
import type { PrintingPrice, SearchHit } from "@/lib/catalog";

/** A search hit as the pickers want it: the raw catalog fields the deck builder reads (number, set,
 *  rarity, attrs) plus the `subtitle` the card rows render. */
export interface CardHit {
  cardId: number; name: string; subtitle: string; imageUrl: string | null;
  number: string | null; setName: string; rarity: string | null; attrs: Record<string, string>;
  printings: PrintingPrice[];
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 10;

/** Debounced type-ahead against /api/search, optionally limited to one game. Results are tagged with
 *  the query (and game) they answer, so a stale page is simply not returned (`hits` is [] until the
 *  current query has settled). */
export function useCardSearch(query: string, enabled = true, gameSlug?: string) {
  const q = query.trim();
  const [results, setResults] = useState<{ query: string; cards: CardHit[] } | null>(null);
  // Tagged like `results`, and for the same reason: a failure belongs to the query that failed, so it
  // stops being shown the moment the inputs move — including back under MIN_QUERY, which fetches
  // nothing and so would otherwise leave the message on screen for good.
  const [failed, setFailed] = useState<string | null>(null);
  // One tag for both inputs: switching game re-fetches instead of showing the other game's hits.
  const tag = `${q}|${gameSlug ?? ""}`;

  useEffect(() => {
    if (!enabled || q.length < MIN_QUERY) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${gameSlug ? `&game=${encodeURIComponent(gameSlug)}` : ""}`);
        if (!res.ok) throw new Error("search failed");
        const body = await res.json();
        if (!live) return;
        const cards: CardHit[] = (body.hits ?? []).slice(0, MAX_RESULTS).map((h: SearchHit) => ({
          cardId: h.cardId,
          name: h.name,
          subtitle: [h.setName, h.number].filter(Boolean).join(" · "),
          imageUrl: h.imageUrl,
          number: h.number ?? null,
          setName: h.setName,
          rarity: h.rarity ?? null,
          attrs: h.attrs ?? {},
          printings: h.printings,
        }));
        setResults({ query: tag, cards });
      } catch {
        if (live) setFailed(tag);
      }
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, enabled, gameSlug, tag]);

  // Stable, so a caller can fold it into its own memoised handlers (AddItemDialog's `close`).
  const reset = useCallback(() => { setResults(null); setFailed(null); }, []);

  const settled = results?.query === tag;
  const error = failed === tag ? "Could not search right now. Try again." : null;
  return { hits: settled ? results!.cards : [], settled, error, reset };
}
