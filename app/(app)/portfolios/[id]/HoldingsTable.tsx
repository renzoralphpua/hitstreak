"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Holding } from "@/lib/portfolios";
import { formatMoney } from "@/lib/format";
import { Button, CardRow, PriceDelta } from "@/components/ui";
import { addItemAction, decrementHoldingAction, removeHoldingAction } from "../actions";

/** A holding is one printing+condition; its lots share a row, so the row keys on both. */
const keyOf = (h: Holding) => `${h.printingId}|${h.condition}`;

/**
 * One binder's cards, value first. A row is a HOLDING — every lot of that printing and condition
 * folded together — so its controls are holding-level.
 *
 * `+` records a NEW LOT with no purchase price rather than bumping an existing one. Bumping would
 * silently value the new copy at an older copy's price, which is precisely the bug that made
 * acquisitions lots in the first place; an uncosted lot is honest and the UI can prompt for the
 * price later. `−` takes a copy off the newest lot. Per-lot editing lives on the card page.
 */
export default function HoldingsTable({ portfolioId, holdings }: { portfolioId: number; holdings: Holding[] }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function run(key: string, call: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>) {
    setBusyKey(key);
    setErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
    try {
      const res = await call();
      if (!res.ok) {
        setErrors((e) => ({ ...e, [key]: res.error }));
        return;
      }
      router.refresh();
    } catch {
      setErrors((e) => ({ ...e, [key]: "Could not reach the server. Try again." }));
    } finally {
      setBusyKey(null);
    }
  }

  const addCopy = (h: Holding) =>
    run(keyOf(h), () =>
      addItemAction(portfolioId, { printingId: h.printingId, quantity: 1, condition: h.condition })
    );
  const removeCopy = (h: Holding) =>
    run(keyOf(h), () => decrementHoldingAction(portfolioId, h.printingId, h.condition));

  function remove(h: Holding) {
    const lots = h.lots.length > 1 ? ` (${h.lots.length} purchases)` : "";
    if (!window.confirm(`Remove ${h.quantity} × ${h.cardName}${lots} from this binder?`)) return;
    return run(keyOf(h), () => removeHoldingAction(portfolioId, h.printingId, h.condition));
  }

  return (
    <ul className="flex flex-col gap-2">
      {holdings.map((h) => {
        const key = keyOf(h);
        const busy = busyKey === key;
        const error = errors[key];
        return (
          <li key={key} className="flex flex-col gap-1">
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
                  {/* Cost covers only the priced lots, so a partly-uncosted holding's gain is
                      overstated. Say so rather than letting the number quietly mislead. */}
                  {h.uncostedQuantity > 0 && (
                    <span className="text-[11px] text-dim">
                      {h.uncostedQuantity === h.quantity
                        ? "no cost recorded"
                        : `${h.uncostedQuantity} of ${h.quantity} without a cost`}
                    </span>
                  )}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Button
                      variant="secondary"
                      aria-label={`Remove one ${h.cardName}`}
                      size="sm"
                      className="min-w-11 px-2.5 md:min-w-0"
                      disabled={busy || h.quantity <= 1}
                      onClick={() => removeCopy(h)}
                    >
                      −
                    </Button>
                    <span className="num min-w-6 text-center text-sm font-semibold text-ink">{h.quantity}</span>
                    <Button
                      variant="secondary"
                      aria-label={`Add one ${h.cardName}`}
                      size="sm"
                      className="min-w-11 px-2.5 md:min-w-0"
                      disabled={busy}
                      onClick={() => addCopy(h)}
                    >
                      +
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={`Remove ${h.cardName} from binder`}
                      size="sm"
                      className="ml-1 text-[13px] font-normal"
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
