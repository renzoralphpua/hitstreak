import { EmptyState, Button } from "@/components/ui";

export const metadata = { title: "Not found — Hitstreak" };

/** Every notFound() in the app lands here — including the deliberate 404 a non-admin gets on
 *  /admin/decks, which is why the copy says nothing about permissions. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <EmptyState
        title="Not found"
        body="That page doesn't exist, or it isn't yours to see."
        action={<Button href="/binders">Back to your binders</Button>}
        className="max-w-md"
      />
    </div>
  );
}
