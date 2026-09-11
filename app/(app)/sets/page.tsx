import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames, listSetsWithCompletion, type SetCompletion } from "@/lib/catalog";
import { SectionHeading, Panel, Pill, ProgressBar, EmptyState } from "@/components/ui";

export const metadata = { title: "Sets — Hitstreak" };
// Completion counts come from the signed-in user's binders: never prerender or cache across users.
export const dynamic = "force-dynamic";

const DEFAULT_GAME = "pokemon";

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** One set: name, completion counts and the bar. Sealed-only sets (no numbered cards) say so
 *  instead of showing a 0 / 0 bar. */
function SetPanel({ set }: { set: SetCompletion }) {
  const sealedOnly = set.totalCards === 0;
  // Ingested release dates are full ISO timestamps; the day is all this caption wants.
  const caption = [set.code, set.releaseDate?.slice(0, 10)].filter(Boolean).join(" · ");
  return (
    <Link href={`/sets/${set.id}`} className="block">
      <Panel className="flex flex-col gap-2 transition-colors hover:border-ink">
        <div className="flex items-baseline justify-between gap-3">
          <span className={sealedOnly ? "text-muted" : "font-semibold text-ink"}>{set.name}</span>
          {sealedOnly ? (
            <span className="text-caption text-dim">No singles</span>
          ) : (
            <span className="num text-caption text-muted">
              {set.ownedCards} / {set.totalCards}
            </span>
          )}
        </div>
        {caption && <span className="text-caption text-dim">{caption}</span>}
        {!sealedOnly && (
          <ProgressBar
            value={set.ownedCards / set.totalCards}
            label={`${set.name} completion`}
            tone={set.ownedCards === set.totalCards ? "gain" : set.ownedCards > 0 ? "accent" : "muted"}
          />
        )}
      </Panel>
    </Link>
  );
}

export default async function SetsPage({ searchParams }: Props) {
  const { game } = await searchParams;
  const gameSlug = typeof game === "string" ? game : DEFAULT_GAME;

  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id

  const games = await listGames();
  const current = games.find((g) => g.slug === gameSlug);
  if (!current) notFound();

  const sets = await listSetsWithCompletion(session.user.id, gameSlug);
  const withSingles = sets.filter((s) => s.totalCards > 0);
  const sealedOnly = sets.filter((s) => s.totalCards === 0);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading as="h1" title="Sets" caption={`${sets.length} in ${current.name}`} />

      <div className="flex gap-1.5">
        {games.map((g) => (
          <Pill key={g.slug} href={`/sets?game=${g.slug}`} selected={g.slug === gameSlug}>
            {g.name}
          </Pill>
        ))}
      </div>

      {sets.length === 0 ? (
        <EmptyState title="No sets yet" body="The nightly ingest fills this in." />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {withSingles.map((s) => (
              <SetPanel key={s.id} set={s} />
            ))}
          </div>

          {sealedOnly.length > 0 && (
            <div className="flex flex-col gap-3">
              <SectionHeading title="No singles" caption="sealed products only" className="text-muted" />
              <div className="grid gap-3 md:grid-cols-2">
                {sealedOnly.map((s) => (
                  <SetPanel key={s.id} set={s} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
