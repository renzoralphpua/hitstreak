"use client";
import { useMemo, useState } from "react";
import type { PublicHolding } from "@/lib/share";
import { formatMoney } from "@/lib/format";
import { useDisplay } from "@/components/currency/CurrencyProvider";
import { CardTile, EmptyState, SearchField, SectionHeading } from "@/components/ui";
import { COLLECTION_SORT_KEYS, sortCards, SORT_OPTIONS, type SortDir, type SortKey } from "@/lib/sort";
import { SortControl } from "@/components/ui";

/** Cost basis is not public, so the two sorts that depend on it are not offered here. */
const PUBLIC_SORT_KEYS: SortKey[] = COLLECTION_SORT_KEYS.filter((k) => k !== "paid" && k !== "gain");

/**
 * A shared collection's cards, as a grid.
 *
 * Grid only — no list toggle. A visitor is looking at someone else's collection to SEE it, and the
 * dense list view exists for the owner managing their own. Searchable for the same reason: a
 * three-hundred-card binder is unusable to a stranger without one, and they cannot fall back to
 * knowing what is in it.
 *
 * Local state rather than the URL: a shared link is something people paste around, and it should
 * not carry whatever the last reader happened to type into a filter box.
 */
export default function SharedCards({ holdings }: { holdings: PublicHolding[] }) {
  const display = useDisplay();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("price");
  const [sortDir, setSortDir] = useState<SortDir>(SORT_OPTIONS.price.defaultDir);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched =
      q === ""
        ? holdings
        : holdings.filter(
            (h) =>
              h.cardName.toLowerCase().includes(q) ||
              h.setName.toLowerCase().includes(q) ||
              (h.number ?? "").toLowerCase().includes(q) ||
              (h.rarity ?? "").toLowerCase().includes(q) ||
              h.subtype.toLowerCase().includes(q)
          );
    return sortCards(
      // No `paid` or `gain`: what the owner paid never reaches a public link, so there is nothing
      // to sort by and nothing to leak by accident.
      matched.map((h) => ({ ...h, name: h.cardName, price: h.value, owned: h.quantity })),
      sortKey,
      sortDir
    );
  }, [holdings, query, sortKey, sortDir]);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Cards"
        caption={shown.length === holdings.length ? `${holdings.length}` : `${shown.length} of ${holdings.length}`}
        trailing={
          <SortControl
            keys={PUBLIC_SORT_KEYS}
            sortKey={sortKey}
            dir={sortDir}
            onChange={(k, d) => { setSortKey(k); setSortDir(d); }}
          />
        }
      />
      <SearchField value={query} onChange={setQuery} placeholder="Search this collection…" />

      {shown.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          body={query.trim() === "" ? "This collection is empty." : `No card here matches “${query.trim()}”.`}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((h) => (
            <CardTile
              key={`${h.printingId}|${h.condition}`}
              name={h.cardName}
              subtitle={[h.setName, h.number, h.subtype].filter(Boolean).join(" · ")}
              price={formatMoney(h.value, { display })}
              quantity={h.quantity}
              imageUrl={h.imageUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}
