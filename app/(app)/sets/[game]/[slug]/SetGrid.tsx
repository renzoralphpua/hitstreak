"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SetCard } from "@/lib/catalog";
import type { Collection } from "@/lib/collections";
import { formatMoney } from "@/lib/format";
import { CardTile, EmptyState, Pill, SectionHeading } from "@/components/ui";
import { addItemAction } from "../../../collections/actions";

type Filter = "all" | "owned" | "missing";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "owned", label: "Owned" },
  { key: "missing", label: "Missing" },
];

/** The set's cards as owned/missing tiles. Tapping a tile adds one NM copy of its first printing
 *  to the target collection: the count bumps immediately, then `router.refresh()` re-reads the truth
 *  (the optimistic bumps are dropped as soon as new server data arrives). A failed add is reverted
 *  and reported above the grid. */
export default function SetGrid({
  cards, sealed, collections, setId,
}: {
  cards: SetCard[];
  /** The set's ETBs, booster boxes and bundles. Same shape, same add behaviour, own section — they
   *  are part of the set, but they are not cards and must not be counted as though they were. */
  sealed: SetCard[];
  collections: Collection[];
  setId: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [targetCollectionId, setTargetCollectionId] = useState<number | null>(collections[0]?.id ?? null);
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
  const keep = (c: SetCard) =>
    filter === "all" ? true : filter === "owned" ? quantityOf(c) > 0 : quantityOf(c) === 0;
  // The pills count everything the filter acts on, cards and sealed together, because that is what
  // choosing one changes on screen.
  const everything = [...cards, ...sealed];
  const ownedCount = everything.filter((c) => quantityOf(c) > 0).length;
  const counts: Record<Filter, number> = {
    all: everything.length,
    owned: ownedCount,
    missing: everything.length - ownedCount,
  };
  const visible = cards.filter(keep);
  const visibleSealed = sealed.filter(keep);

  const canAdd = targetCollectionId != null;

  async function add(card: SetCard) {
    const printingId = card.printings[0]?.printingId;
    if (targetCollectionId == null || printingId == null) return;
    const bump = (by: number) =>
      setAdded((a) => {
        const counts = a.base === cards ? { ...a.counts } : {};
        counts[card.cardId] = Math.max(0, (counts[card.cardId] ?? 0) + by);
        return { base: cards, counts };
      });
    setError(null);
    bump(1);
    try {
      const res = await addItemAction(targetCollectionId, { printingId, quantity: 1, condition: "NM" });
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
          {collections.length === 0 ? (
            <Link href="/collections" className="text-caption text-accent">
              Create a collection to start marking cards owned
            </Link>
          ) : (
            <>
              <span className="text-caption text-dim">Add to:</span>
              {collections.map((p) => (
                <Pill
                  key={p.id}
                  selected={p.id === targetCollectionId}
                  onClick={() => setTargetCollectionId(p.id)}
                >
                  {p.name}
                </Pill>
              ))}
              <span className="ml-1.5 text-caption text-dim">Tap a card to add one copy</span>
            </>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      )}

      {visible.length + visibleSealed.length === 0 ? (
        <EmptyState
          title={filter === "owned" ? "You don't own any of these yet" : "Nothing missing here"}
          body={
            filter === "owned"
              ? "Tap a card in the full set to add your first copy."
              : "You own everything in this set."
          }
        />
      ) : (
        <>
          <Tiles items={visible} quantityOf={quantityOf} setId={setId} onAdd={canAdd ? add : undefined} />

          {visibleSealed.length > 0 && (
            <div className="flex flex-col gap-3">
              {/* Sealed sits BELOW the cards, under its own heading, rather than mixed into the grid:
                  a booster box next to a card reads as another card, and it is priced nothing like
                  one. Inside the set, though — it is part of this release, not a separate product. */}
              <SectionHeading
                title="Sealed"
                caption={`${visibleSealed.length} product${visibleSealed.length === 1 ? "" : "s"}`}
                className="border-b border-hairline pb-1.5"
              />
              <Tiles items={visibleSealed} quantityOf={quantityOf} setId={setId} onAdd={canAdd ? add : undefined} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One grid of tiles. Cards and sealed products render identically — only the heading above them
 *  differs — so the layout lives in one place. */
function Tiles({
  items, quantityOf, setId, onAdd,
}: {
  items: SetCard[];
  quantityOf: (c: SetCard) => number;
  setId: number;
  onAdd?: (c: SetCard) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {items.map((c) => (
        <div key={c.cardId} className="flex flex-col gap-1">
          <CardTile
            name={c.name}
            // A sealed product has no card number; its subtitle is what it IS.
            subtitle={c.number ?? "Sealed"}
            price={formatMoney(c.lowestMarket)}
            quantity={quantityOf(c)}
            imageUrl={c.imageUrl}
            onClick={onAdd ? () => onAdd(c) : undefined}
          />
          <Link href={`/cards/${c.cardId}?from=${encodeURIComponent(`/sets/${setId}`)}`} className="text-caption text-accent">
            Details
          </Link>
        </div>
      ))}
    </div>
  );
}
