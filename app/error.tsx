"use client";
import { useEffect } from "react";
import { EmptyState, Button } from "@/components/ui";

/** The app-wide error boundary. Next remounts this on a thrown render/data error; `reset` retries
 *  the segment. The message itself is never shown — it can carry internals — only logged. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <EmptyState
        title="Something went wrong"
        body="That didn't load. Try again — if it keeps happening, the price sync or the database may be down."
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button href="/portfolios" variant="secondary">Back to your binders</Button>
          </div>
        }
        className="max-w-md"
      />
    </div>
  );
}
