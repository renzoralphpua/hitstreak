"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { renameDeckAction, deleteDeckAction } from "../actions";

/** Rename (inline, like PortfolioForm's RenameToggle) and delete for one deck row. */
export default function DeckActions({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(call: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => renameDeckAction(id, draft.trim()))) setRenaming(false);
  }

  function remove() {
    if (!window.confirm(`Delete "${name}"?`)) return;
    return run(() => deleteDeckAction(id));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {renaming ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <Input
            className="max-w-[14rem]"
            aria-label={`Rename ${name}`}
            maxLength={80}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft(name);
              setRenaming(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button href={`/decks/mine/${id}`} variant="secondary" size="sm">
            Open
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRenaming(true)}>
            Rename
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={remove}>
            Delete
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
