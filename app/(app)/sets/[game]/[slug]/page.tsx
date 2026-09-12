import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { isNumericId } from "@/lib/slug";
import { getSetDetail, resolveSetSlug } from "@/lib/catalog";
import { listCollections } from "@/lib/collections";
import { formatMoney } from "@/lib/format";
import { SectionHeading, ProgressBar } from "@/components/ui";
import SetGrid from "./SetGrid";

// Owned counts and values are per-user: never prerender or cache across users.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ game: string; slug: string }> };

/**
 * The set with the signed-in user's ownership folded in, or `notFound()`.
 *
 * A NUMERIC segment is still accepted and redirected to the canonical slug URL — every link in the
 * app used /sets/<id> until now, and old bookmarks should land rather than 404. `cache` makes this
 * one query per request even though both `generateMetadata` and the page ask for it.
 */
const load = cache(async (game: string, slug: string) => {
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id

  const bySlug = isNumericId(slug) ? null : await resolveSetSlug(game, slug);
  const setId = bySlug ?? (isNumericId(slug) ? parseRouteId(slug) : null);
  if (setId == null) notFound();

  const detail = await getSetDetail(session.user.id, setId);
  if (!detail) notFound();
  // Reached by id, or under the wrong game: send the reader to the one true URL for this set.
  if (bySlug == null && detail.set.slug) redirect(`/sets/${detail.set.gameSlug}/${detail.set.slug}`);
  if (detail.set.gameSlug !== game) notFound();
  return { userId: session.user.id, detail };
});

export async function generateMetadata({ params }: Params) {
  const { game, slug } = await params;
  const { detail } = await load(game, slug);
  return { title: `${detail.set.name} — Hitstreak` };
}

export default async function SetDetailPage({ params }: Params) {
  const { game, slug } = await params;
  const { userId, detail } = await load(game, slug);
  const { set, stats } = detail;
  const collections = await listCollections(userId);
  const ratio = stats.totalCards > 0 ? stats.ownedCards / stats.totalCards : 0;
  const pct = Math.round(ratio * 100);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-dim">
            {/* Ingested release dates are full ISO timestamps; show the day only. */}
            {set.gameName} · Released {set.releaseDate?.slice(0, 10) ?? "—"}
          </span>
          <SectionHeading as="h1" title={set.name} back={{ href: `/sets/${set.gameSlug}`, label: "Sets" }} />
          <p className="text-muted">
            You own{" "}
            <span className="num font-semibold text-ink">
              {stats.ownedCards} of {stats.totalCards}
            </span>{" "}
            cards · set value <span className="num font-semibold text-ink">{formatMoney(stats.setValue)}</span> ·
            your copies worth <span className="num font-semibold text-ink">{formatMoney(stats.ownedValue)}</span>
          </p>
        </div>

        <div className="flex w-[220px] flex-col gap-1.5 md:ml-auto">
          <div className="flex items-baseline justify-between text-caption text-muted">
            <span>Set completion</span>
            <span className="num font-semibold text-ink">{pct}%</span>
          </div>
          <ProgressBar
            value={ratio}
            label={`${set.name} completion`}
            tone={stats.ownedCards === stats.totalCards && stats.totalCards > 0 ? "gain" : stats.ownedCards > 0 ? "accent" : "muted"}
            className="h-2"
          />
          <span className="text-caption text-dim">
            Missing cards cost <span className="num font-semibold text-ink">{formatMoney(stats.missingCost)}</span>{" "}
            to complete
          </span>
        </div>
      </div>

      <SetGrid cards={detail.cards} collections={collections} setId={detail.set.id} />
    </div>
  );
}
