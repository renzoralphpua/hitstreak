import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { getDeck } from "@/lib/decks/data";
import { loadOwnedByKey } from "@/lib/decks/gap";
import Builder from "./Builder";

// Ownership counts and the deck itself are per-user: never prerender or cache across users.
export const dynamic = "force-dynamic";

/** The caller's own deck, or `notFound()`. `cache` makes this one query per request even though
 *  both `generateMetadata` and the page ask for it. */
const load = cache(async (id: string) => {
  const deckId = parseRouteId(id);
  if (deckId == null) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const deck = await getDeck(deckId, session.user.id);
  // Curated decks are read-only: copy one first (see /decks/[id]).
  if (!deck || deck.isMeta) notFound();
  return { userId: session.user.id, deck };
});

export async function generateMetadata({ params }: PageProps<"/decks/mine/[id]">) {
  const { id } = await params;
  const { deck } = await load(id);
  return { title: `${deck.name} — Hitstreak` };
}

export default async function BuilderPage({ params }: PageProps<"/decks/mine/[id]">) {
  const { id } = await params;
  const { userId, deck } = await load(id);
  const owned = await loadOwnedByKey(userId, deck.gameSlug);
  return <Builder deck={deck} owned={Object.fromEntries(owned)} />;
}
