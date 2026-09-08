import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames } from "@/lib/catalog";
import { listMetaDecks, getDeck } from "@/lib/decks/data";
import { loadOwnedByKey, analyzeGap } from "@/lib/decks/gap";
import { isGameSlug } from "@/lib/decks/types";
import { SectionHeading, Pill, EmptyState } from "@/components/ui";
import DeckSummaryPanel from "./DeckSummaryPanel";

export const metadata = { title: "Decks — Hitstreak" };
// Gap analysis is against the signed-in user's binders: never prerender or cache across users.
export const dynamic = "force-dynamic";

const DEFAULT_GAME = "pokemon";
const tierLabel = (t: number | null) => (t == null ? "Other" : `Tier ${t}`);

export default async function DecksPage({ searchParams }: PageProps<"/decks">) {
  const { game } = await searchParams;
  const gameSlug = isGameSlug(game) ? game : DEFAULT_GAME;

  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id

  const games = await listGames();
  const current = games.find((g) => g.slug === gameSlug);
  if (!current) notFound();

  const [decks, owned] = await Promise.all([listMetaDecks(gameSlug), loadOwnedByKey(session.user.id, gameSlug)]);
  // Gap needs each deck's lines; curated lists are few, so one detail read per deck is fine here.
  const gaps = await Promise.all(decks.map(async (d) => analyzeGap((await getDeck(d.id, null))!, owned)));
  const tiers = [...new Set(decks.map((d) => d.tier))].sort((a, b) => (a ?? 99) - (b ?? 99));

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading as="h1" title="Meta decks" caption={`${decks.length} curated for ${current.name}`} />

      <div className="flex flex-wrap gap-1.5">
        {games.map((g) => (
          <Pill key={g.slug} href={`/decks?game=${g.slug}`} selected={g.slug === gameSlug}>
            {g.name}
          </Pill>
        ))}
      </div>

      {decks.length === 0 ? (
        <EmptyState title="No curated decks yet" body={`Meta decks for ${current.name} appear here once they are curated.`} />
      ) : (
        tiers.map((t) => (
          <div key={String(t)} className="flex flex-col gap-2.5">
            {/* Same group label as AlertList — a §13 `GroupLabel` primitive candidate, not promoted yet. */}
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{tierLabel(t)}</span>
            <div className="grid gap-3 md:grid-cols-2">
              {decks.map((d, i) => (d.tier === t ? <DeckSummaryPanel key={d.id} deck={d} gap={gaps[i]} /> : null))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
