"use client";
import { useState } from "react";
import type { Collection } from "@/lib/collections";
import { Button, Pill } from "@/components/ui";
import AddItemDialog, { type DialogCard } from "../../collections/[slug]/AddItemDialog";

/** Picks which collection the card detail page adds to, then hands the card to `AddItemDialog`
 *  preselected (so the dialog opens straight on the printing/quantity step). */
export default function AddToCollection({ collections, card }: { collections: Collection[]; card: DialogCard }) {
  const [target, setTarget] = useState<number | null>(collections[0]?.id ?? null);

  if (collections.length === 0) {
    return (
      <Button href="/collections" variant="secondary">
        Create a collection first
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-caption text-dim">Add to:</span>
        {collections.map((p) => (
          <Pill key={p.id} selected={p.id === target} onClick={() => setTarget(p.id)}>
            {p.name}
          </Pill>
        ))}
      </div>
      {target != null && <AddItemDialog collectionId={target} preselected={card} label="Add to collection" />}
    </div>
  );
}
