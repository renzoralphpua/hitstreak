import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames, listSetsWithCompletion } from "@/lib/catalog";
import SetBrowser from "./SetBrowser";

export const metadata = { title: "Sets — Hitstreak" };
// Completion counts come from the signed-in user's collections: never prerender or cache across users.
export const dynamic = "force-dynamic";

const DEFAULT_GAME = "pokemon";

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** Fetches; SetBrowser decides how it is shown. `?game=` is the only thing the server needs — view,
 *  filter, search and folds are local preferences and live in localStorage, not the URL. */
export default async function SetsPage({ searchParams }: Props) {
  const { game } = await searchParams;
  const gameSlug = typeof game === "string" ? game : DEFAULT_GAME;

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
