"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Holding } from "@/lib/portfolios";
import { formatMoney } from "@/lib/format";
import { Button, CardRow, PriceDelta } from "@/components/ui";
import { updateItemAction, removeItemAction } from "../actions";

/** One binder's cards, value first (the data layer already sorts by value). Quantity edits and
 *  removals go through the server actions, then `router.refresh()` re-reads the valuation. */
export default function HoldingsTable({ portfolioId, holdings }: { portfolioId: number; holdings: Holding[] }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  async function run(itemId: number, call: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>) {
    setBusyId(itemId);
    setErrors((e) => {
      if (!(itemId in e)) return e;
      const rest = { ...e };
      delete rest[itemId];
      return rest;
    });
    try {
      const res = await call();
      if (!res.ok) {
        setErrors((e) => ({ ...e, [itemId]: res.error }));
        return;
      }
      router.refresh();
    } catch {
      setErrors((e) => ({ ...e, [itemId]: "Could not reach the server. Try again." }));
    } finally {
      setBusyId(null);
    }
  }

  const setQuantity = (h: Holding, quantity: number) =>
    run(h.itemId, () => updateItemAction(portfolioId, h.itemId, { quantity }));

  function remove(h: Holding) {
    if (!window.confirm(`Remove ${h.quantity} × ${h.cardName} from this binder?`)) return;
    return run(h.itemId, () => removeItemAction(portfolioId, h.itemId));
  }

  return (
    <ul className="flex flex-col gap-2">
      {holdings.map((h) => {
        const busy = busyId === h.itemId;
        const error = errors[h.itemId];
        return (
          <li key={h.itemId} className="flex flex-col gap-1">
            <CardRow
              name={h.cardName}
              subtitle={[h.setName, h.number, h.subtype, h.condition].filter(Boolean).join(" · ")}
              imageUrl={h.imageUrl}
              right={
                <>
                  {h.value == null ? (
                    <>
                      <span className="text-lg font-semibold text-dim">—</span>
                      <span className="text-[11px] text-dim">no price</span>
                    </>
                  ) : (
                    <span className="text-lg font-semibold text-ink">{formatMoney(h.value)}</span>
                  )}
                  <PriceDelta amount={h.value != null && h.cost != null ? h.value - h.cost : null} />
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Button
                      variant="secondary"
                      aria-label={`Remove one ${h.cardName}`}
                      className="min-h-8 px-2.5 py-1"
                      disabled={busy || h.quantity <= 1}
                      onClick={() => setQuantity(h, h.quantity - 1)}
                    >
                      −
                    </Button>
                    <span className="num min-w-6 text-center text-sm font-semibold text-ink">{h.quantity}</span>
                    <Button
                      variant="secondary"
                      aria-label={`Add one ${h.cardName}`}
                      className="min-h-8 px-2.5 py-1"
                      disabled={busy}
                      onClick={() => setQuantity(h, h.quantity + 1)}
                    >
                      +
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={`Remove ${h.cardName} from binder`}
                      className="ml-1 min-h-8 px-2.5 py-1 text-[13px] font-normal"
                      disabled={busy}
                      onClick={() => remove(h)}
                    >
                      Remove
                    </Button>
                  </div>
                </>
              }
            />
            {error && (
              <p role="alert" className="px-2.5 text-[13px] text-accent">
                {error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
