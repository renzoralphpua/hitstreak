"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { deletePortfolioAction } from "./actions";

/** Deleting a binder takes its cards with it, so confirm with the count first. */
export default function DeletePortfolioButton({ id, name, count }: { id: number; name: string; count: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!window.confirm(`Delete "${name}" and its ${count} cards?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deletePortfolioAction(id);
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
        <p role="alert" className="text-[13px] text-accent">
          {error}
        </p>
      )}
    </>
  );
}
