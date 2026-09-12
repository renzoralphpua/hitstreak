import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { isNumericId } from "@/lib/slug";
import { getCollection, getCollectionHoldings, getCollectionSummary, resolveCollectionSlug } from "@/lib/collections";
import { getShareLink } from "@/lib/share";
import { realisedFor } from "@/lib/sales";
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
import CollectionHeading from "./CollectionHeading";
import AddItemDialog from "./AddItemDialog";
import SharePanel from "./SharePanel";

import { getDisplay } from "@/lib/display";
// Per-user data valued from latest_prices: never prerender or cache across users.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * The collection, its id and its owner, or `notFound()`.
 *
 * A NUMERIC segment is still accepted and redirected to the slug — every link in the app used
 * `/collections/<id>` until now, and `?from=` parameters already out in the wild carry that shape.
 * `cache` makes this one query per request even though both `generateMetadata` and the page ask.
 */
const load = cache(async (slug: string) => {
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const userId = session.user.id;

  const bySlug = isNumericId(slug) ? null : await resolveCollectionSlug(userId, slug);
  const collectionId = bySlug ?? (isNumericId(slug) ? parseRouteId(slug) : null);
  if (collectionId == null) notFound();

  const collection = await getCollection(userId, collectionId);
  if (!collection) notFound();
  // Reached by id: send the reader to the one true URL for this collection.
  if (bySlug == null && collection.slug) redirect(`/collections/${collection.slug}`);
  return { userId, collectionId, collection };
});

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const { collection } = await load(slug);
  return { title: `${collection.name} — Hitstreak` };
}

export default async function CollectionDetailPage({ params, searchParams }: PageProps<"/collections/[slug]">) {
  const display = await getDisplay();
  const { slug } = await params;
  const { userId, collectionId, collection } = await load(slug);
  const { range: rawRange } = await searchParams;
  const range = parseRange(rawRange);
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeStart(range, today);
  const [holdings, summary, shareLink, realised] = await Promise.all([
    getCollectionHoldings(userId, collectionId),
    getCollectionSummary(userId, collectionId),
    getShareLink(userId, collectionId),
    realisedFor(userId, collectionId),
  ]);
  // collection_history is materialized nightly; tonight's live value is the final point until then.
  const history = withLivePoint(await getCollectionHistory(userId, collectionId, from, today), today, summary.value);
  const stats = seriesStats(history);
  const gainSign = summary.gain >= 0 ? "+" : "−";

  return (
    <div className="grid gap-10 md:grid-cols-[380px_1fr]">
      {/* overflow-x-clip is not decoration: CSS makes the OTHER axis compute to `auto` whenever one
          axis is not `visible`, so `overflow-y-auto` alone put a horizontal scrollbar under this
          column. `clip` is the one value that does not force its counterpart.

          The summary stays in view while you scroll the cards: it is the answer to "what is this
          worth", and scrolling past it to look at a card makes you scroll back to see it again.
          Single-column below md, where a pinned 380px block would BE the screen. */}
      <div className="flex flex-col gap-4 md:sticky md:top-16 md:max-h-[calc(100dvh-4rem)] md:self-start md:overflow-y-auto md:overflow-x-clip md:pt-3 md:pb-6">
        <CollectionHeading
          id={collectionId}
          name={collection.name}
          caption={
            summary.sealed > 0
              ? `${summary.cards} card${summary.cards === 1 ? "" : "s"} · ${summary.sealed} sealed`
              : `${summary.cards} card${summary.cards === 1 ? "" : "s"}`
          }
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
          <RangePills current={range} hrefFor={(r) => `/collections/${collection.slug ?? collectionId}?range=${r}`} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Paid" value={formatMoney(summary.cost, { display })} />
          <StatTile
            label="Gain"
            value={`${gainSign}${formatMoney(Math.abs(summary.gain), { display })}`}
            tone={summary.gain >= 0 ? "gain" : "loss"}
          />
          {summary.unpriced > 0 && (
            <StatTile label="Unpriced" value={String(summary.unpriced)} className="col-span-2" />
          )}
        </div>
        {/* Realised sits beside unrealised rather than inside it: one is what the collection might
            make, the other is what it already has, and adding them would be a third number that is
            neither. Absent entirely until something has actually sold. */}
        {realised.quantity > 0 && (
          <div className="flex flex-col gap-1.5 rounded-tile border border-hairline bg-ground px-3 py-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-caption font-semibold uppercase tracking-label text-muted">Realised</span>
              <span className="num text-caption text-dim">
                {realised.quantity} sold
              </span>
            </div>
            <MoneyDisplay amount={realised.proceeds} />
            {realised.uncostedQuantity === realised.quantity ? (
              <span className="text-caption text-dim">No cost recorded, so there is no profit to show.</span>
            ) : (
              <PriceDelta
                amount={realised.gain}
                ratio={realised.cost > 0 ? realised.gain / realised.cost : null}
                caption="vs. paid"
              />
            )}
            {realised.uncostedQuantity > 0 && realised.uncostedQuantity < realised.quantity && (
              <span className="text-caption text-dim">
                {realised.uncostedQuantity} of them had no recorded cost, so the profit above leaves them out.
              </span>
            )}
            {realised.fees > 0 && (
              <span className="num text-caption text-dim">after {formatMoney(realised.fees, { display })} in fees</span>
            )}
          </div>
        )}

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
            <SectionHeading title="Items" caption="sorted by value" />
            <EmptyState
              title="Nothing here yet"
              body="Add a card or a sealed product to start tracking this collection's value."
              action={<AddItemDialog collectionId={collectionId} label="Add your first item" />}
            />
          </div>
        ) : (
          <CollectionCards collectionId={collectionId} href={`/collections/${collection.slug ?? collectionId}`} holdings={holdings} />
        )}
      </div>
    </div>
  );
}
