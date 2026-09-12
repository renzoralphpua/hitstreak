"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CardLot } from "@/lib/collections";
import { formatMoney } from "@/lib/format";
import { Button, Input, Panel, PriceDelta } from "@/components/ui";
import { updateItemAction, removeItemAction } from "@/app/(app)/collections/actions";
import { useDisplay } from "@/components/currency/CurrencyProvider";
import { fromUsd, inputCurrency, toUsd } from "@/lib/money-input";

/**
 * One row per ACQUISITION, which is the only place in the app that shows them.
 *
 * A card bought last year and again today is two rows here — what you paid, when, and how many —
 * because that is what happened. Everywhere else folds them into a holding and shows the total; this
 * is where the folding comes apart, and where a lot is edited or removed.
 *
 * Editing is deliberately per-lot: correcting what you paid in 2025 must not touch the copy you
 * bought last week, and the collection screen's stepper cannot express that.
 */
export default function YourCopies({ lots }: { lots: CardLot[] }) {
  const display = useDisplay();
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<{ id: number; message: string } | null>(null);

  async function run(id: number, call: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(id);
    setError(null);
    try {
      const res = await call();
      if (!res.ok) return setError({ id, message: res.error });
      setEditing(null);
      router.refresh();
    } catch {
      setError({ id, message: "Could not reach the server. Try again." });
    } finally {
      setBusy(null);
    }
  }

  function save(lot: CardLot, form: HTMLFormElement) {
    const data = new FormData(form);
    const price = String(data.get("price") ?? "").trim();
    const date = String(data.get("date") ?? "").trim();
    const quantity = Number(data.get("quantity"));
    return run(lot.itemId, () =>
      updateItemAction(lot.collectionId, lot.itemId, {
        quantity,
        // Empty clears the figure rather than leaving the old one — "I do not know what I paid" has
        // to be expressible, or an accidental entry can never be undone. A value is read in the
        // display currency and stored in USD.
        acquiredPrice: toUsd(price, display),
        acquiredDate: date === "" ? null : date,
      })
    );
  }

  function remove(lot: CardLot) {
    const when = lot.acquiredDate ? ` from ${lot.acquiredDate}` : "";
    if (!window.confirm(`Remove this purchase of ${lot.quantity}${when}? Your other copies stay.`)) return;
    return run(lot.itemId, () => removeItemAction(lot.collectionId, lot.itemId));
  }

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink">Your copies</span>
        <span className="text-caption text-dim">
          {lots.length} purchase{lots.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="flex flex-col">
        {lots.map((lot) => {
          const gain = lot.value != null && lot.cost != null ? lot.value - lot.cost : null;
          const isEditing = editing === lot.itemId;
          return (
            <li key={lot.itemId} className="flex flex-col gap-2 border-b border-hairline-soft py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="num font-semibold text-ink">×{lot.quantity}</span>
                <span className="text-ink">{lot.collectionName}</span>
                <span className="text-caption text-dim">
                  {lot.subtype} · {lot.condition}
                  {lot.acquiredDate ? ` · bought ${lot.acquiredDate}` : " · no date recorded"}
                </span>
              </div>

              {isEditing ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(lot, e.currentTarget);
                  }}
                >
                  <Input
                    name="quantity" label="Copies" type="number" min={1} step={1}
                    defaultValue={lot.quantity} className="w-20" required
                  />
                  <Input
                    name="price"
                    label={`Paid each${inputCurrency(display) ? ` (${inputCurrency(display)})` : ""}`}
                    type="number" min={0} step="0.01"
                    // Converted out for editing, converted back on save: the field must show the
                    // same currency the rest of the row is read in.
                    defaultValue={fromUsd(lot.acquiredPrice, display)} placeholder="—" className="w-28"
                  />
                  <Input name="date" label="Bought" type="date" defaultValue={lot.acquiredDate ?? ""} className="w-40" />
                  <Button type="submit" size="sm" disabled={busy === lot.itemId}>Save</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="num text-caption text-muted">
                    Paid{" "}
                    {lot.acquiredPrice == null ? (
                      <span className="text-dim">not recorded</span>
                    ) : (
                      <span className="font-semibold text-ink">{formatMoney(lot.acquiredPrice, { display })}</span>
                    )}
                    {lot.quantity > 1 && lot.cost != null && (
                      <span className="text-dim"> · {formatMoney(lot.cost, { display })} total</span>
                    )}
                  </span>
                  <span className="num text-caption text-muted">
                    Now{" "}
                    <span className="font-semibold text-ink">
                      {lot.value == null ? "—" : formatMoney(lot.value, { display })}
                    </span>
                  </span>
                  {gain != null && lot.cost! > 0 && (
                    <PriceDelta amount={gain} ratio={gain / lot.cost!} />
                  )}
                  <div className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(lot.itemId)}>Edit</Button>
                    <Button size="sm" variant="secondary" disabled={busy === lot.itemId} onClick={() => remove(lot)}>
                      Remove
                    </Button>
                  </div>
                </div>
              )}

              {error?.id === lot.itemId && (
                <p role="alert" className="text-base text-accent">{error.message}</p>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
