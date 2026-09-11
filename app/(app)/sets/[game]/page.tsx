import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames, listSetsWithCompletion } from "@/lib/catalog";
import SetBrowser from "../SetBrowser";

export const metadata = { title: "Sets — Hitstreak" };
// Completion counts come from the signed-in user's collections: never prerender or cache across users.
export const dynamic = "force-dynamic";

/** Fetches; SetBrowser decides how it is shown. The game is in the PATH — /sets/pokemon — which is
 *  what lets a set slug only have to be unique within its game. View, filter, search and folds are
 *  local preferences and live in localStorage, not the URL. */
type Props = { params: Promise<{ game: string }> };

export default async function SetsPage({ params }: Props) {
  const { game: gameSlug } = await params;

  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id

  const games = await listGames();
  const current = games.find((g) => g.slug === gameSlug);
  if (!current) notFound();

  const sets = await listSetsWithCompletion(session.user.id, gameSlug);
  return (
    <SetBrowser
      sets={sets}
      gameName={current.name}
      gameSlug={gameSlug}
      games={games.map((g) => ({ slug: g.slug, name: g.name }))}
    />
  );
}
