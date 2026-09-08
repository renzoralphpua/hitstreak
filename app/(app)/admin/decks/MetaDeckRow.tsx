"use client";
// One curated deck in the admin list. It is a sibling of CurationForm, not a child, so "Edit" hands
// the deck over on a window CustomEvent: that keeps the page a Server Component (no per-keystroke
// state above it) and neither island has to know the other's shape beyond EditDeckDetail.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeckSummary } from "@/lib/decks/data";
import { Button, Panel, TierBadge } from "@/components/ui";
import { deleteMetaDeckAction } from "./actions";
import { EDIT_EVENT, type EditDeckDetail } from "./edit-event";

export default function MetaDeckRow({ deck, decklist }: { deck: DeckSummary; decklist: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit() {
    const detail: EditDeckDetail = {
      id: deck.id, gameSlug: deck.gameSlug, name: deck.name, archetype: deck.archetype,
      tier: deck.tier, format: deck.format, sourceNote: deck.sourceNote, decklist,
    };
    window.dispatchEvent(new CustomEvent<EditDeckDetail>(EDIT_EVENT, { detail }));
  }

  async function remove() {
    if (!window.confirm(`Delete "${deck.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteMetaDeckAction(deck.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate font-semibold text-ink">{deck.name}</span>
        <span className="truncate text-xs text-dim">
          {deck.gameName} · <span className="num">{deck.cardCount}</span> cards
          {deck.archetype ? ` · ${deck.archetype}` : ""}
          {deck.format ? ` · ${deck.format}` : ""}
        </span>
      </div>
      {deck.tier != null && <TierBadge tier={deck.tier} />}
      <Button variant="secondary" size="sm" onClick={edit}>
        Edit
      </Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={remove}>
        Delete
      </Button>
      {error && (
        <p role="alert" className="w-full text-[13px] text-accent">
          {error}
        </p>
      )}
    </Panel>
  );
}
