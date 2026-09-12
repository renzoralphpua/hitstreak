"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AlertCard, Direction } from "@/lib/alerts";
import { formatMoney } from "@/lib/format";
import { Button, CardRow, Input, Pill, SearchField } from "@/components/ui";
import { useCardSearch, type CardHit } from "@/components/ui/useCardSearch";
import { createAlertAction } from "./actions";

type Picked = Omit<AlertCard, "printingId">;

/** Search → printing → direction → threshold → create. `preselected` (from `/alerts?printing=`)
 *  skips the search step and starts on that printing. */
export default function NewAlertForm({ preselected }: { preselected?: AlertCard | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [card, setCard] = useState<Picked | null>(preselected ?? null);
  const [printingId, setPrintingId] = useState<number | null>(preselected?.printingId ?? null);
  const [direction, setDirection] = useState<Direction>("below");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { hits, settled, error: searchError } = useCardSearch(q, card == null);

  const printing = card?.printings.find((p) => p.printingId === printingId) ?? null;
  const t = Number(threshold);
  const hint =
    printing?.market != null && printing.market > 0 && threshold.trim() !== "" && Number.isFinite(t) && t > 0
      ? `${Math.round((Math.abs(t - printing.market) / printing.market) * 100)}% ${t >= printing.market ? "over" : "under"} today`
      : null;

  function pick(h: CardHit) {
    setCard(h);
    setPrintingId(h.printings[0]?.printingId ?? null);
    setError(null);
  }

  async function submit() {
    if (printingId == null) {
      setError("Pick a printing first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createAlertAction({ printingId, direction, threshold: t });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCard(preselected ?? null);
      setPrintingId(preselected?.printingId ?? null);
      setThreshold("");
      setQ("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-title leading-none text-ink">New alert</h2>

      {card == null ? (
        <>
          <SearchField value={q} onChange={setQ} placeholder="Search cards…" />
          {hits.length > 0 && (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto overflow-x-clip">
              {hits.map((h) => (
                <li key={h.cardId}>
                  <CardRow name={h.name} subtitle={h.subtitle} imageUrl={h.imageUrl} onClick={() => pick(h)} />
                </li>
              ))}
            </ul>
          )}
          {settled && hits.length === 0 && <p className="text-base text-dim">No cards match “{q.trim()}”.</p>}
        </>
      ) : (
        <>
          <CardRow
            name={card.name}
            subtitle={card.subtitle}
            imageUrl={card.imageUrl}
            right={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCard(null);
                  setPrintingId(null);
                }}
              >
                Change
              </Button>
            }
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-dim">Printing</span>
            <div className="flex flex-wrap gap-2">
              {card.printings.map((p) => (
                <Pill key={p.printingId} selected={p.printingId === printingId} onClick={() => setPrintingId(p.printingId)}>
                  {p.subtype} · {formatMoney(p.market)}
                </Pill>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-dim">Notify me when the market price</span>
            <div className="grid grid-cols-2 gap-2">
              <Pill selected={direction === "above"} onClick={() => setDirection("above")}>
                rises above
              </Pill>
              <Pill selected={direction === "below"} onClick={() => setDirection("below")}>
                drops below
              </Pill>
            </div>
            <label className="flex flex-col gap-1.5 text-caption text-dim">
              Price (USD)
              <Input
                type="number"
                min={0.01}
                step={0.01}
                inputMode="decimal"
                placeholder={printing?.market != null ? formatMoney(printing.market).slice(1) : "0.00"}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </label>
            {hint && <span className="num text-caption text-dim">{hint}</span>}
          </div>

          <Button onClick={submit} disabled={busy || threshold.trim() === ""}>
            Create alert
          </Button>
        </>
      )}

      {(error ?? searchError) && (
        <p role="alert" className="text-base text-accent">
          {error ?? searchError}
        </p>
      )}
    </div>
  );
}
