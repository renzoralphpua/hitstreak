import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames } from "@/lib/catalog";
import { listMyDecks } from "@/lib/decks/data";
import { SectionHeading, Panel, Button, EmptyState } from "@/components/ui";
import NewDeckForm from "./NewDeckForm";
import DeckActions from "./DeckActions";

export const metadata = { title: "My decks — Hitstreak" };
// The list is per-user: never prerender or cache across users.
export const dynamic = "force-dynamic";

export default async function MyDecksPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const [decks, games] = await Promise.all([listMyDecks(session.user.id), listGames()]);
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        as="h1"
        title="My decks"
        caption={`${decks.length} deck${decks.length === 1 ? "" : "s"}`}
        trailing={<Button href="/decks" variant="secondary" size="sm">Meta decks</Button>}
      />
      {decks.length === 0 ? (
        <EmptyState title="No decks yet" body="Start one below, or copy a meta deck from the browser." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {decks.map((d) => (
            <Panel key={d.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/decks/mine/${d.id}`} className="font-semibold text-ink">{d.name}</Link>
                <span className="text-[13px] text-dim">{d.gameName}</span>
              </div>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="num text-muted">{d.cardCount} card{d.cardCount === 1 ? "" : "s"}</span>
                <span className={d.isDraft ? "text-accent" : "text-gain"}>{d.isDraft ? "Draft" : "Legal"}</span>
              </div>
              <DeckActions id={d.id} name={d.name} />
            </Panel>
          ))}
        </div>
      )}
      <Panel><NewDeckForm games={games.map((g) => ({ slug: g.slug, name: g.name }))} /></Panel>
    </div>
  );
}
