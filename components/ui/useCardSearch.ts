"use client";
import { useCallback, useEffect, useState } from "react";
import type { PrintingPrice } from "@/lib/catalog";

export interface CardHit { cardId: number; name: string; subtitle: string; imageUrl: string | null; printings: PrintingPrice[] }

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 10;

/** Debounced type-ahead against /api/search. Results are tagged with the query they answer, so a
 *  stale page is simply not returned (`hits` is [] until the current query has settled). */
export function useCardSearch(query: string, enabled = true) {
  const q = query.trim();
  const [results, setResults] = useState<{ query: string; cards: CardHit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || q.length < MIN_QUERY) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("search failed");
        const body = await res.json();
        if (!live) return;
        const cards: CardHit[] = (body.hits ?? []).slice(0, MAX_RESULTS).map(
          (h: { cardId: number; name: string; setName: string; number: string | null; imageUrl: string | null; printings: PrintingPrice[] }) => ({
            cardId: h.cardId,
            name: h.name,
            subtitle: [h.setName, h.number].filter(Boolean).join(" · "),
            imageUrl: h.imageUrl,
            printings: h.printings,
          })
        );
        setResults({ query: q, cards });
        setError(null);
      } catch {
        if (live) setError("Could not search right now. Try again.");
      }
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, enabled]);

  // Stable, so a caller can fold it into its own memoised handlers (AddItemDialog's `close`).
  const reset = useCallback(() => setResults(null), []);

  const settled = results?.query === q;
  return { hits: settled ? results!.cards : [], settled, error, reset };
}
