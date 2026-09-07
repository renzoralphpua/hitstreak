"use client";
import { useState } from "react";
import Link from "next/link";
import type { Portfolio } from "@/lib/portfolios";
import { Pill } from "@/components/ui";
import AddItemDialog, { type DialogCard } from "../../portfolios/[id]/AddItemDialog";

// `Button` renders a <button> only, so the no-binder case is a Link wearing the secondary skin.
const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-full border border-hairline bg-surface px-4 py-2.5 text-sm font-semibold text-ink min-h-11 hover:bg-hairline-soft";

/** Picks which binder the card detail page adds to, then hands the card to `AddItemDialog`
 *  preselected (so the dialog opens straight on the printing/quantity step). */
export default function AddToBinder({ portfolios, card }: { portfolios: Portfolio[]; card: DialogCard }) {
  const [target, setTarget] = useState<number | null>(portfolios[0]?.id ?? null);

  if (portfolios.length === 0) {
    return (
      <Link href="/portfolios" className={secondaryButton}>
        Create a binder first
      </Link>
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
