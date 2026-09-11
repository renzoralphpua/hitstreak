import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { getSetDetail } from "@/lib/catalog";
import { listCollections } from "@/lib/collections";
import { formatMoney } from "@/lib/format";
import { SectionHeading, ProgressBar } from "@/components/ui";
import SetGrid from "./SetGrid";

// Owned counts and values are per-user: never prerender or cache across users.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The set with the signed-in user's ownership folded in, or `notFound()`. `cache` makes this one
 *  query per request even though both `generateMetadata` and the page ask for it. */
const load = cache(async (id: string) => {
  const setId = parseRouteId(id);
  if (setId == null) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const detail = await getSetDetail(session.user.id, setId);
  if (!detail) notFound();
  return { userId: session.user.id, detail };
});

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const { detail } = await load(id);
  return { title: `${detail.set.name} — Hitstreak` };
}

export default async function SetDetailPage({ params }: Params) {
  const { id } = await params;
  const { userId, detail } = await load(id);
  const { set, stats } = detail;
  const collections = await listCollections(userId);
  const ratio = stats.totalCards > 0 ? stats.ownedCards / stats.totalCards : 0;
  const pct = Math.round(ratio * 100);

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/sets?game=${set.gameSlug}`} className="text-caption text-muted hover:text-ink">
        ← Sets
      </Link>

      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-dim">
            {/* Ingested release dates are full ISO timestamps; show the day only. */}
            {set.gameName} · Released {set.releaseDate?.slice(0, 10) ?? "—"}
          </span>
          <SectionHeading as="h1" title={set.name} />
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
