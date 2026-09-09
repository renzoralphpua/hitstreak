import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames } from "@/lib/catalog";
import { isAdminUser, listMetaDecks, getDeck } from "@/lib/decks/data";
import { formatDecklist } from "@/lib/decks/resolve";
import { GAME_SLUGS, isGameSlug } from "@/lib/decks/types";
import { SectionHeading, Panel, EmptyState } from "@/components/ui";
import CurationForm from "./CurationForm";
import MetaDeckRow from "./MetaDeckRow";

export const metadata = { title: "Curate meta decks — Hitstreak" };
export const dynamic = "force-dynamic";

export default async function AdminDecksPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  // Not a redirect: a non-admin should not learn that this route exists. Every action re-checks too.
  if (!(await isAdminUser(session.user.id))) notFound();

  // Only games the validators know: a pill for any other catalog row could only ever fail as "Unknown game".
  const games = (await listGames()).filter((g) => isGameSlug(g.slug));
  const perGame = await Promise.all(GAME_SLUGS.map(async (slug) => ({ slug, decks: await listMetaDecks(slug) })));
  const all = perGame.flatMap((g) => g.decks);
  // Each row can hand the form its current list to edit. A deck deleted between the list and its read
  // comes back null and simply edits as an empty list.
  const texts = Object.fromEntries(
    await Promise.all(all.map(async (d) => {
      const full = await getDeck(d.id, null);
      return [d.id, full ? formatDecklist(full) : ""] as const;
    }))
  ) as Record<number, string>;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading as="h1" title="Curate meta decks" caption={`${all.length} curated`} />
      <Panel>
        <CurationForm games={games.map((g) => ({ slug: g.slug, name: g.name }))} />
      </Panel>
      {all.length === 0 ? (
        <EmptyState title="Nothing curated yet" body="Paste a decklist above, or use scripts/import-deck.mts." />
      ) : (
        <div className="flex flex-col gap-3">
          {perGame.filter((g) => g.decks.length > 0).map((g) => (
            <div key={g.slug} className="flex flex-col gap-2">
              {/* Same group label as AlertList and the meta browser — a §13 `GroupLabel` primitive candidate. */}
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                {games.find((x) => x.slug === g.slug)?.name ?? g.slug}
              </span>
              {g.decks.map((d) => <MetaDeckRow key={d.id} deck={d} decklist={texts[d.id] ?? ""} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
