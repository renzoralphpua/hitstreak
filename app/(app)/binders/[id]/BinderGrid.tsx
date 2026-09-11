import Link from "next/link";
import type { Holding } from "@/lib/portfolios";
import { formatMoney } from "@/lib/format";
import { CardTile, PriceDelta } from "@/components/ui";

/**
 * A binder as card art. This is the READING view — there are no controls on a tile, because the
 * quantity stepper, per-lot editing and removal all live in the list. A tile is a link to the card
 * page, which is where anything you might want to do about a card already is.
 *
 * The three things a tile can say under the value, in order of what matters:
 *
 * 1. **Add cost** — no lot of this holding records what it cost. Showing 0% here would claim the
 *    card is worth exactly what you paid; the truth is that it is silently distorting the binder's
 *    gain, so the tile asks for the missing figure instead.
 * 2. **no price** — the ingest has never priced this printing, so there is no value to compare.
 * 3. the vs-paid percent, without the dollar figure: at ~183px a tile cannot hold both, and the
 *    dollar delta is one click away in the list.
 */
export default function BinderGrid({ holdings }: { holdings: Holding[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {holdings.map((h) => {
        const costed = h.cost != null && h.uncostedQuantity === 0;
        return (
          <li key={`${h.printingId}|${h.condition}`}>
            <Link href={`/cards/${h.cardId}`} className="block rounded-tile hover:opacity-95">
              <CardTile
                name={h.cardName}
                subtitle={[h.setName, h.number, h.subtype].filter(Boolean).join(" · ")}
                price={h.value == null ? "—" : formatMoney(h.value)}
                quantity={h.quantity}
                quantityDisplay="multiple"
                imageUrl={h.imageUrl}
                delta={
                  h.value == null ? (
                    <span className="text-caption text-dim">no price</span>
                  ) : !costed ? (
                    <span className="text-caption font-semibold text-accent">Add cost</span>
                  ) : (
                    <PriceDelta
                      format="percent"
                      amount={h.value - h.cost!}
                      ratio={h.cost! > 0 ? (h.value - h.cost!) / h.cost! : null}
                    />
                  )
                }
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
