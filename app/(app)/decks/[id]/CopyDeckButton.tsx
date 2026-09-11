"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { copyDeckAction } from "../actions";

/** The mockup's "Copy to my decks" and "Open in builder" in one control: curated decks are read-only,
 *  so editing one means taking a copy first. */
export default function CopyDeckButton({ sourceId }: { sourceId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setBusy(true);
    setError(null);
    try {
      const res = await copyDeckAction(sourceId);
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
    <span className="flex flex-col gap-1">
      <Button variant="secondary" size="sm" disabled={busy} onClick={copy}>
        Copy to my decks
      </Button>
      {error && (
        <span role="alert" className="text-base text-accent">
          {error}
        </span>
      )}
    </span>
  );
}
