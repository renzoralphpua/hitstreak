"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SetCard } from "@/lib/catalog";
import type { Portfolio } from "@/lib/portfolios";
import { formatMoney } from "@/lib/format";
import { CardTile, Pill } from "@/components/ui";
import { addItemAction } from "../../portfolios/actions";

type Filter = "all" | "owned" | "missing";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "owned", label: "Owned" },
  { key: "missing", label: "Missing" },
];

/** The set's cards as owned/missing tiles. Tapping a tile adds one NM copy of its first printing
 *  to the target binder: the count bumps immediately, then `router.refresh()` re-reads the truth
 *  (the optimistic bumps are dropped as soon as new server data arrives). A failed add is reverted
 *  and reported above the grid. */
export default function SetGrid({ cards, portfolios }: { cards: SetCard[]; portfolios: Portfolio[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [targetPortfolioId, setTargetPortfolioId] = useState<number | null>(portfolios[0]?.id ?? null);
  // Local "+1"s are tagged with the `cards` array they were counted on top of, so the first render
  // after `router.refresh()` (a new array, already including those copies) simply ignores them —
  // no effect, no double counting.
  const [added, setAdded] = useState<{ base: SetCard[]; counts: Record<number, number> }>({ base: cards, counts: {} });
  const [error, setError] = useState<string | null>(null);

  // Identity check, not a deep compare: `router.refresh()` hands down a brand-new `cards` array, so
  // `base !== cards` means the server has already counted these copies and the local bumps are
  // dropped. Known narrow race: two taps in flight when a refresh lands — the second one's bump is
  // discarded and its card can read one low until the next refresh, which self-heals it.
  const optimistic = added.base === cards ? added.counts : {};

  const quantityOf = (card: SetCard) => card.ownedQuantity + (optimistic[card.cardId] ?? 0);
  const ownedCount = cards.filter((c) => quantityOf(c) > 0).length;
  const counts: Record<Filter, number> = {
    all: cards.length,
    owned: ownedCount,
    missing: cards.length - ownedCount,
  };
  const visible = cards.filter((c) =>
    filter === "all" ? true : filter === "owned" ? quantityOf(c) > 0 : quantityOf(c) === 0
  );

  const canAdd = targetPortfolioId != null;

  async function add(card: SetCard) {
    const printingId = card.printings[0]?.printingId;
    if (targetPortfolioId == null || printingId == null) return;
    const bump = (by: number) =>
      setAdded((a) => {
        const counts = a.base === cards ? { ...a.counts } : {};
        counts[card.cardId] = Math.max(0, (counts[card.cardId] ?? 0) + by);
        return { base: cards, counts };
      });
    setError(null);
    bump(1);
    try {
      const res = await addItemAction(targetPortfolioId, { printingId, quantity: 1, condition: "NM" });
      if (!res.ok) {
        bump(-1);
        setError(res.error);
        return;
      }
      router.refresh();
    } catch {
      bump(-1);
      setError("Could not reach the server. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <Pill key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label} {counts[f.key]}
          </Pill>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {portfolios.length === 0 ? (
            <Link href="/portfolios" className="text-[13px] text-accent">
              Create a binder to start marking cards owned
            </Link>
          ) : (
            <>
              <span className="text-xs text-dim">Add to:</span>
              {portfolios.map((p) => (
                <Pill
                  key={p.id}
                  selected={p.id === targetPortfolioId}
                  onClick={() => setTargetPortfolioId(p.id)}
                >
                  {p.name}
                </Pill>
              ))}
              <span className="ml-1.5 text-xs text-dim">Tap a card to add one copy</span>
            </>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-accent">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {visible.map((c) => (
          <div key={c.cardId} className="flex flex-col gap-1">
            <CardTile
              name={c.name}
              subtitle={c.number}
              price={formatMoney(c.lowestMarket)}
              quantity={quantityOf(c)}
              imageUrl={c.imageUrl}
              onClick={canAdd ? () => add(c) : undefined}
            />
            <Link href={`/cards/${c.cardId}`} className="text-xs text-accent">
              Details
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
