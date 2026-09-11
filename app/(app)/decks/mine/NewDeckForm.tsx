"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Pill } from "@/components/ui";
import { createDeckAction } from "../actions";

/** Pick a game, name the deck, land in the builder. The game is a pill row rather than a select:
 *  there are three of them and the rest of the app picks games the same way. */
export default function NewDeckForm({ games }: { games: Array<{ slug: string; name: string }> }) {
  const router = useRouter();
  const [gameSlug, setGameSlug] = useState(games[0]?.slug ?? "");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await createDeckAction(gameSlug, name.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/decks/mine/${res.data}`);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <span className="font-semibold text-ink">Start a deck</span>
      <div className="flex flex-wrap gap-1.5">
        {games.map((g) => (
          <Pill key={g.slug} selected={g.slug === gameSlug} onClick={() => setGameSlug(g.slug)}>
            {g.name}
          </Pill>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          aria-label="Deck name"
          placeholder="New deck…"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" size="sm" className="shrink-0" disabled={busy || name.trim() === ""}>
          Create deck
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      )}
    </form>
  );
}
