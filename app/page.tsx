import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  if (await getSession()) redirect("/portfolios");
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ground px-6 py-12 text-center">
      <span className="font-display text-3xl text-ink">Hitstreak</span>
      <p className="max-w-sm text-[15px] text-muted">
        Track your collection, prices, and decks — Pokémon, One Piece, Riftbound.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/sign-in"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-chip px-4 py-2.5 text-sm font-semibold text-chip-ink transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-hairline bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-hairline-soft"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}
