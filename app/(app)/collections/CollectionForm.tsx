"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Input } from "@/components/ui";
import { createCollectionAction, renameCollectionAction } from "./actions";

type Props =
  /** `variant: "button"` is the header affordance: a Create button that opens the field in a dialog,
   *  because a full form does not belong beside a page title. */
  | { mode: "create"; variant?: "form" | "button" }
  | { mode: "rename"; id: number; name: string; onDone?: () => void };

/** Create a collection, or rename one inline. Errors from the action surface as role="alert". */
export default function CollectionForm(props: Props) {
  const router = useRouter();
  const [name, setName] = useState(props.mode === "rename" ? props.name : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const asButton = props.mode === "create" && props.variant === "button";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        props.mode === "create"
          ? await createCollectionAction(name.trim())
          : await renameCollectionAction(props.id, name.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (props.mode === "create") {
        setName("");
        setOpen(false);
      }
      router.refresh();
      if (props.mode === "rename") props.onDone?.();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          className={asButton ? undefined : "max-w-xs"}
          aria-label="Collection name"
          placeholder="New collection…"
          maxLength={80}
          autoFocus={asButton}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {props.mode === "create" ? (
          <Button type="submit" disabled={busy} className="shrink-0">
            {asButton ? "Create" : "Create collection"}
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
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      )}
    </form>
  );

  if (!asButton) return field;

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New collection" className="max-w-md">
        {field}
      </Dialog>
    </>
  );
}
