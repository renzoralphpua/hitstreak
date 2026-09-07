"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { PrintingPrice } from "@/lib/catalog";
import { CONDITIONS } from "@/lib/portfolios";
import { formatMoney } from "@/lib/format";
import { Button, CardRow, Panel, Pill, SearchField } from "@/components/ui";
import { addItemAction } from "../actions";

/** A card the dialog can add: either picked from search, or handed in preselected (card detail). */
export interface DialogCard {
  name: string;
  subtitle: string;
  imageUrl: string | null;
  printings: PrintingPrice[];
}

type Props = { portfolioId: number; label?: string; preselected?: DialogCard };

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 10;

const field =
  "h-11 w-full rounded-tile border border-hairline bg-surface px-3.5 text-ink outline-none focus:border-ink";

function lowestMarket(printings: PrintingPrice[]): number | null {
  let low: number | null = null;
  for (const p of printings) if (p.market != null && (low == null || p.market < low)) low = p.market;
  return low;
}

/** Search → printing → quantity/condition/price, then `addItemAction`. No portal, no modal
 *  library: a fixed overlay with a Panel, closed by Escape or Cancel. */
export default function AddItemDialog({ portfolioId, label, preselected }: Props) {
  const router = useRouter();
  const headingId = useId();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Results are tagged with the query they answer, so a stale page of hits is simply not rendered
  // (no clearing setState in the debounce effect).
  const [results, setResults] = useState<{ query: string; cards: Array<DialogCard & { cardId: number }> } | null>(null);
  const [selected, setSelected] = useState<DialogCard | null>(preselected ?? null);
  const [printingId, setPrintingId] = useState<number | null>(preselected?.printings[0]?.printingId ?? null);
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState<string>(CONDITIONS[0]);
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = q.trim();
  const hits = results && results.query === query ? results.cards : [];

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setResults(null);
    setSelected(preselected ?? null);
    setPrintingId(preselected?.printings[0]?.printingId ?? null);
    setQuantity("1");
    setCondition(CONDITIONS[0]);
    setPrice("");
    setError(null);
  }, [preselected]);

  // Escape closes, wherever focus happens to be inside the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Debounced type-ahead. Skipped entirely once a card is chosen (or preselected).
  useEffect(() => {
    if (!open || selected || query.length < MIN_QUERY) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("search failed");
        const body = await res.json();
        if (!live) return;
        const cards = (body.hits ?? []).slice(0, MAX_RESULTS).map(
          (h: { cardId: number; name: string; setName: string; number: string | null; imageUrl: string | null; printings: PrintingPrice[] }) => ({
            cardId: h.cardId,
            name: h.name,
            subtitle: [h.setName, h.number].filter(Boolean).join(" · "),
            imageUrl: h.imageUrl,
            printings: h.printings,
          })
        );
        setResults({ query, cards });
        setError(null);
      } catch {
        if (live) setError("Could not search right now. Try again.");
      }
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, open, selected]);

  function pick(card: DialogCard) {
    setSelected(card);
    setPrintingId(card.printings[0]?.printingId ?? null);
    setError(null);
  }

  async function submit() {
    if (printingId == null) {
      setError("Pick a printing first.");
      return;
    }
    const qty = Number(quantity);
    const paid = price.trim() === "" ? null : Number(price);
    setBusy(true);
    setError(null);
    try {
      const res = await addItemAction(portfolioId, {
        printingId,
        quantity: qty,
        condition,
        acquiredPrice: paid,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>{label ?? "Add a card"}</Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-16">
          <Panel role="dialog" aria-modal="true" aria-labelledby={headingId} className="w-full max-w-lg">
            <div className="flex flex-col gap-4">
              <h2 id={headingId} className="font-display text-[22px] leading-none text-ink">
                Add a card
              </h2>

              {selected == null ? (
                <>
                  <SearchField value={q} onChange={setQ} placeholder="Search cards…" autoFocus />
                  {hits.length > 0 && (
                    <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                      {hits.map((h) => (
                        <li key={h.cardId}>
                          <CardRow
                            name={h.name}
                            subtitle={h.subtitle}
                            imageUrl={h.imageUrl}
                            onClick={() => pick(h)}
                            right={<span className="text-sm font-semibold text-ink">{formatMoney(lowestMarket(h.printings))}</span>}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {results?.query === query && hits.length === 0 && (
                    <p className="text-[13px] text-dim">No cards match “{query}”.</p>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-4">
                  <CardRow name={selected.name} subtitle={selected.subtitle} imageUrl={selected.imageUrl} />

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-dim">Printing</span>
                    <div className="flex flex-wrap gap-2">
                      {selected.printings.map((p) => (
                        <Pill
                          key={p.printingId}
                          selected={p.printingId === printingId}
                          onClick={() => setPrintingId(p.printingId)}
                        >
                          {p.subtype} · {formatMoney(p.market)}
                        </Pill>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-dim">Condition</span>
                    <div className="flex flex-wrap gap-2">
                      {CONDITIONS.map((c) => (
                        <Pill key={c} selected={c === condition} onClick={() => setCondition(c)}>
                          {c}
                        </Pill>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5 text-xs text-dim">
                      Quantity
                      <input
                        className={field}
                        type="number"
                        min={1}
                        step={1}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs text-dim">
                      Price paid (each, optional)
                      <input
                        className={field}
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="—"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </label>
                  </div>

                  {preselected == null && (
                    <Button variant="secondary" className="self-start" onClick={() => setSelected(null)}>
                      Pick a different card
                    </Button>
                  )}
                </div>
              )}

              {error && (
                <p role="alert" className="text-[13px] text-accent">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={busy || selected == null}>
                  Add to binder
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
