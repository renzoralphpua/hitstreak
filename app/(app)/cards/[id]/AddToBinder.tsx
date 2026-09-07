"use client";
import { useState } from "react";
import type { Portfolio } from "@/lib/portfolios";
import { Button, Pill } from "@/components/ui";
import AddItemDialog, { type DialogCard } from "../../portfolios/[id]/AddItemDialog";

/** Picks which binder the card detail page adds to, then hands the card to `AddItemDialog`
 *  preselected (so the dialog opens straight on the printing/quantity step). */
export default function AddToBinder({ portfolios, card }: { portfolios: Portfolio[]; card: DialogCard }) {
  const [target, setTarget] = useState<number | null>(portfolios[0]?.id ?? null);

  if (portfolios.length === 0) {
    return (
      <Button href="/portfolios" variant="secondary">
        Create a binder first
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-dim">Add to:</span>
        {portfolios.map((p) => (
          <Pill key={p.id} selected={p.id === target} onClick={() => setTarget(p.id)}>
            {p.name}
          </Pill>
        ))}
      </div>
      {target != null && <AddItemDialog portfolioId={target} preselected={card} label="Add to binder" />}
    </div>
  );
}
