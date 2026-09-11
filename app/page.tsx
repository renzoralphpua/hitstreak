import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui";

export default async function Home() {
  if (await getSession()) redirect("/binders");
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ground px-6 py-12 text-center">
      <span className="font-display text-section text-ink">Hitstreak</span>
      <p className="max-w-sm text-base text-muted">
        Track your collection, prices, and decks — Pokémon, One Piece, Riftbound.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button href="/sign-in">Sign in</Button>
        <Button href="/sign-up" variant="secondary">
          Create account
        </Button>
      </div>
    </div>
  );
}
