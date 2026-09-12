"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PrintingPrice } from "@/lib/catalog";
import { CONDITIONS } from "@/lib/collections";
import { formatMoney } from "@/lib/format";
import { Button, CardRow, Input, Panel, Pill, SearchField } from "@/components/ui";
import { useCardSearch } from "@/components/ui/useCardSearch";
import { addItemAction } from "../actions";
import { useDisplay } from "@/components/currency/CurrencyProvider";
import { inputCurrency, toUsd } from "@/lib/money-input";

/** A card the dialog can add: either picked from search, or handed in preselected (card detail). */
export interface DialogCard {
  name: string;
  subtitle: string;
  imageUrl: string | null;
  printings: PrintingPrice[];
}

type Props = { collectionId: number; label?: string; preselected?: DialogCard };

// Everything the browser lets you tab to, in document order, for the focus trap.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusablesIn = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));

function lowestMarket(printings: PrintingPrice[]): number | null {
  let low: number | null = null;
  for (const p of printings) if (p.market != null && (low == null || p.market < low)) low = p.market;
  return low;
}

/** Search → printing → quantity/condition/price, then `addItemAction`. No portal, no modal
 *  library: a fixed overlay with a Panel, closed by Escape or Cancel. */
export default function AddItemDialog({ collectionId, label, preselected }: Props) {
  const display = useDisplay();
  const router = useRouter();
  const headingId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<DialogCard | null>(preselected ?? null);
  const [printingId, setPrintingId] = useState<number | null>(preselected?.printings[0]?.printingId ?? null);
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState<string>(CONDITIONS[0]);
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Debounced type-ahead (components/ui/useCardSearch.ts). Skipped entirely while the dialog is
  // closed or once a card is chosen (or preselected).
  const query = q.trim();
  const { hits, settled, error: searchError, reset } = useCardSearch(q, open && selected == null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    reset();
    setSelected(preselected ?? null);
    setPrintingId(preselected?.printings[0]?.printingId ?? null);
    setQuantity("1");
    setCondition(CONDITIONS[0]);
    setPrice("");
    setError(null);
    // Focus goes back where it came from, so the keyboard doesn't land at the top of the page.
    triggerRef.current?.focus();
  }, [preselected, reset]);

  // On open, put focus inside the panel: the search variant's field carries autoFocus, the
  // preselected variant has no field, so take its first focusable control instead.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    focusablesIn(panel)[0]?.focus();
  }, [open]);

  // Escape closes, wherever focus happens to be inside the overlay; Tab wraps within the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusablesIn(panel);
      if (items.length === 0) return;
      const edge = e.shiftKey ? items[0] : items[items.length - 1];
      const wrapTo = e.shiftKey ? items[items.length - 1] : items[0];
      if (document.activeElement === edge || !panel.contains(document.activeElement)) {
        e.preventDefault();
        wrapTo.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

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
    // Typed in the display currency, stored in USD — see lib/money-input.ts.
    const paid = toUsd(price.trim(), display);
    setBusy(true);
    setError(null);
    try {
      const res = await addItemAction(collectionId, {
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
      <Button ref={triggerRef} onClick={() => setOpen(true)}>
        {label ?? "Add a card"}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-16">
          <Panel
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="w-full max-w-lg"
          >
            <div className="flex flex-col gap-4">
              <h2 id={headingId} className="font-display text-title leading-none text-ink">
                Add a card
              </h2>

              {selected == null ? (
                <>
                  <SearchField value={q} onChange={setQ} placeholder="Search cards…" autoFocus />
                  {hits.length > 0 && (
                    <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto overflow-x-clip">
                      {hits.map((h) => (
                        <li key={h.cardId}>
                          <CardRow
                            name={h.name}
                            subtitle={h.subtitle}
                            imageUrl={h.imageUrl}
                            onClick={() => pick(h)}
                            right={<span className="text-base font-semibold text-ink">{formatMoney(lowestMarket(h.printings), { display })}</span>}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {settled && hits.length === 0 && (
                    <p className="text-base text-dim">No cards match “{query}”.</p>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-4">
                  <CardRow name={selected.name} subtitle={selected.subtitle} imageUrl={selected.imageUrl} />

                  <div className="flex flex-col gap-1.5">
                    <span className="text-caption text-dim">Printing</span>
                    <div className="flex flex-wrap gap-2">
                      {selected.printings.map((p) => (
                        <Pill
                          key={p.printingId}
                          selected={p.printingId === printingId}
                          onClick={() => setPrintingId(p.printingId)}
                        >
                          {p.subtype} · {formatMoney(p.market, { display })}
                        </Pill>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-caption text-dim">Condition</span>
                    <div className="flex flex-wrap gap-2">
                      {CONDITIONS.map((c) => (
                        <Pill key={c} selected={c === condition} onClick={() => setCondition(c)}>
                          {c}
                        </Pill>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5 text-caption text-dim">
                      Quantity
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-caption text-dim">
                      {/* The currency is named whenever it is not dollars: 8500 means a very
                          different purchase in pesos than in USD, and the field has to say which. */}
                      Price paid (each, optional){inputCurrency(display) ? ` — ${inputCurrency(display)}` : ""}
                      <Input
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

              {(searchError ?? error) && (
                <p role="alert" className="text-base text-accent">
                  {searchError ?? error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={busy || selected == null}>
                  Add to collection
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
