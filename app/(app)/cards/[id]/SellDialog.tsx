"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CardLot } from "@/lib/collections";
import { formatMoney } from "@/lib/format";
import { fromUsd, inputCurrency, toUsd } from "@/lib/money-input";
import { useDisplay } from "@/components/currency/CurrencyProvider";
import { Button, Dialog, Input, PriceDelta } from "@/components/ui";
import { sellLotAction } from "@/app/(app)/collections/sale-actions";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Record a sale against ONE lot.
 *
 * Per-lot because cost basis is per-lot: selling "an Umbreon" is ambiguous when you hold two bought
 * at different prices, and which one left decides what you made. The dialog shows that lot's cost so
 * the profit is visible before it is committed, not discovered afterwards.
 *
 * Price is typed in the display currency and stored in USD, like every other money field.
 */
export default function SellDialog({ lot, onDone }: { lot: CardLot; onDone?: () => void }) {
  const display = useDisplay();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  // Seeded with the market price: at a table you price off the market and adjust, rather than from zero.
  const [price, setPrice] = useState(() => fromUsd(lot.market, display));
  const [fees, setFees] = useState("");
  const [date, setDate] = useState(today);
  const [venue, setVenue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const qty = Number(quantity);
  const unitUsd = toUsd(price, display);
  const feesUsd = toUsd(fees, display) ?? 0;
  // What this sale would realise, shown BEFORE committing. Null cost means null profit: a lot with no
  // recorded price cannot produce one, and guessing zero would invent a gain.
  const proceeds = unitUsd == null || !Number.isFinite(qty) ? null : qty * unitUsd - feesUsd;
  const gain = proceeds == null || lot.acquiredPrice == null ? null : proceeds - qty * lot.acquiredPrice;

  const valid = Number.isInteger(qty) && qty > 0 && qty <= lot.quantity && unitUsd != null && unitUsd >= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sellLotAction({
        itemId: lot.itemId, quantity: qty, unitPrice: unitUsd!, fees: feesUsd,
        soldDate: date, venue: venue.trim() || null,
      });
      if (!res.ok) { setError(res.error); return; }
      setOpen(false);
      router.refresh();
      onDone?.();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const cur = inputCurrency(display);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={lot.quantity === 0}>
        Sell
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Record a sale" className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-caption text-dim">
            From {lot.collectionName} · {lot.quantity} held ·{" "}
            {lot.acquiredPrice == null
              ? "no recorded cost"
              : `paid ${formatMoney(lot.acquiredPrice, { display })} each`}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-caption text-dim">
              Copies
              <Input type="number" min={1} max={lot.quantity} step={1} value={quantity} autoFocus
                onChange={(e) => setQuantity(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-caption text-dim">
              Sold for, each{cur ? ` (${cur})` : ""}
              <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-caption text-dim">
              Date
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-caption text-dim">
              {/* Optional and last: selling in person usually has no cut, but a table fee exists. */}
              Fees{cur ? ` (${cur})` : ""}
              <Input type="number" min={0} step="0.01" placeholder="0" value={fees}
                onChange={(e) => setFees(e.target.value)} />
            </label>
          </div>

          <label className="flex flex-col gap-1.5 text-caption text-dim">
            Where (optional)
            <Input placeholder="Manila Card Con" maxLength={120} value={venue}
              onChange={(e) => setVenue(e.target.value)} />
          </label>

          {proceeds != null && (
            <div className="flex items-baseline justify-between rounded-tile border border-hairline bg-ground px-3 py-2">
              <span className="text-caption text-dim">You receive</span>
              <span className="flex items-baseline gap-2">
                <span className="num font-semibold text-ink">{formatMoney(proceeds, { display })}</span>
                {gain == null ? (
                  <span className="text-caption text-dim">no cost recorded</span>
                ) : (
                  <PriceDelta amount={gain} ratio={null} />
                )}
              </span>
            </div>
          )}

          {qty > lot.quantity && (
            <p role="alert" className="text-base text-accent">You only hold {lot.quantity}.</p>
          )}
          {error && <p role="alert" className="text-base text-accent">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !valid}>Record sale</Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
