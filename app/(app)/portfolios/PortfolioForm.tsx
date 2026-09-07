"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { createPortfolioAction, renamePortfolioAction } from "./actions";

type Props = { mode: "create" } | { mode: "rename"; id: number; name: string; onDone?: () => void };

/** Create a binder, or rename one inline. Errors from the action surface as role="alert". */
export default function PortfolioForm(props: Props) {
  const router = useRouter();
  const [name, setName] = useState(props.mode === "rename" ? props.name : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        props.mode === "create"
          ? await createPortfolioAction(name.trim())
          : await renamePortfolioAction(props.id, name.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (props.mode === "create") setName("");
      router.refresh();
      if (props.mode === "rename") props.onDone?.();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          className="max-w-xs"
          aria-label="Binder name"
          placeholder="New binder…"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {props.mode === "create" ? (
          <Button type="submit" disabled={busy} className="shrink-0">
            Create binder
          </Button>
        ) : (
          <>
            <Button type="submit" disabled={busy} className="shrink-0">
              Save
            </Button>
            <Button type="button" variant="secondary" className="shrink-0" onClick={() => props.onDone?.()}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-accent">
          {error}
        </p>
      )}
    </form>
  );
}

/** "Rename" button that swaps itself for the inline rename form. */
export function RenameToggle({ id, name }: { id: number; name: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <PortfolioForm mode="rename" id={id} name={name} onDone={() => setOpen(false)} />;
  return (
    <Button variant="secondary" onClick={() => setOpen(true)}>
      Rename
    </Button>
  );
}
