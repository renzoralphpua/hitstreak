"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { deleteCollectionAction } from "./actions";

/** Deleting a collection takes its cards with it, so confirm with the count first. */
export default function DeleteCollectionButton({ id, name, count }: { id: number; name: string; count: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!window.confirm(`Delete "${name}" and its ${count} cards?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteCollectionAction(id);
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
    <>
      <Button variant="secondary" onClick={onDelete} disabled={busy}>
        Delete
      </Button>
      {error && (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      )}
    </>
  );
}
