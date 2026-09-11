import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { getCollection, getCollectionHoldings, getCollectionSummary } from "@/lib/collections";
import { getShareLink } from "@/lib/share";
import {
  parseRange,
  rangeStart,
  chartFrom,
  seriesStats,
  withLivePoint,
  getCollectionHistory,
  RANGE_CAPTION,
} from "@/lib/history";
import { formatMoney } from "@/lib/format";
import {
  SectionHeading,
  StatTile,
  PriceDelta,
  MoneyDisplay,
  EmptyState,
  LineChart,
  RangePills,
} from "@/components/ui";
import CollectionCards from "./CollectionCards";
import AddItemDialog from "./AddItemDialog";
import SharePanel from "./SharePanel";

// Per-user data valued from latest_prices: never prerender or cache across users.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The collection id and the owner, or `notFound()`. `cache` makes this one query per request even
 *  though both `generateMetadata` and the page ask for it. */
const load = cache(async (id: string) => {
  const collectionId = parseRouteId(id);
  if (collectionId == null) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const collection = await getCollection(session.user.id, collectionId);
  if (!collection) notFound();
  return { userId: session.user.id, collectionId, collection };
});

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const { collection } = await load(id);
  return { title: `${collection.name} — Hitstreak` };
}

export default async function CollectionDetailPage({ params, searchParams }: PageProps<"/collections/[id]">) {
  const { id } = await params;
  const { userId, collectionId, collection } = await load(id);
  const { range: rawRange } = await searchParams;
  const range = parseRange(rawRange);
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeStart(range, today);
  const [holdings, summary, shareLink] = await Promise.all([
    getCollectionHoldings(userId, collectionId),
    getCollectionSummary(userId, collectionId),
    getShareLink(userId, collectionId),
  ]);
  // collection_history is materialized nightly; tonight's live value is the final point until then.
  const history = withLivePoint(await getCollectionHistory(userId, collectionId, from, today), today, summary.value);
  const stats = seriesStats(history);
  const gainSign = summary.gain >= 0 ? "+" : "−";

  return (
    <div className="grid gap-10 md:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-4">
        <Link href="/collections" className="text-caption text-muted hover:text-ink">
          ← Collections
        </Link>

        <SectionHeading
          as="h1"
          title={collection.name}
          caption={`${summary.cards} card${summary.cards === 1 ? "" : "s"}`}
        />

        <MoneyDisplay size="lg" amount={summary.value} />
        <PriceDelta
          amount={summary.gain}
          ratio={summary.cost > 0 ? summary.gain / summary.cost : null}
          caption="vs. paid"
        />
        {stats?.change && (
          <PriceDelta amount={stats.change.amount} ratio={stats.change.ratio} caption={RANGE_CAPTION[range]} />
        )}
        <div className="flex flex-col gap-2">
          <LineChart
            points={history}
            from={chartFrom(range, from, history, today)}
            to={today}
            height={120}
            label={`${collection.name} value, ${RANGE_CAPTION[range]}`}
          />
          <RangePills current={range} hrefFor={(r) => `/collections/${collectionId}?range=${r}`} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Paid" value={formatMoney(summary.cost)} />
          <StatTile
            label="Gain"
            value={`${gainSign}${formatMoney(Math.abs(summary.gain))}`}
            tone={summary.gain >= 0 ? "gain" : "loss"}
          />
          {summary.unpriced > 0 && (
            <StatTile label="Unpriced" value={String(summary.unpriced)} className="col-span-2" />
          )}
        </div>
        {summary.unpriced > 0 && (
          <p className="text-caption text-dim">
            {summary.unpriced} {summary.unpriced === 1 ? "copy has" : "copies have"} no market price yet, so
            they are left out of the total.
          </p>
        )}

        {holdings.length > 0 && <AddItemDialog collectionId={collectionId} />}

        <SharePanel collectionId={collectionId} link={shareLink} />
      </div>

      <div className="flex flex-col gap-4">
        {holdings.length === 0 ? (
          <div className="flex flex-col gap-4">
            <SectionHeading title="Cards" caption="sorted by value" />
            <EmptyState
              title="Nothing here yet"
              body="Add a card to start tracking this collection's value."
              action={<AddItemDialog collectionId={collectionId} label="Add your first card" />}
            />
          </div>
        ) : (
          <CollectionCards collectionId={collectionId} holdings={holdings} />
        )}
      </div>
    </div>
  );
}
