import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { getCardDetail } from "@/lib/catalog";
import { getCardHolders, getCardLots, getCollection, listCollections } from "@/lib/collections";
import { collectionIdFromPath, resolveBack } from "@/lib/back-link";
import { toPlainText, hasText } from "@/lib/card-text";
import {
  parseRange,
  rangeStart,
  chartFrom,
  seriesStats,
  getPrintingHistory,
  RANGE_CAPTION,
  type Range,
  type Point,
} from "@/lib/history";
import { formatMoney } from "@/lib/format";
import {
  SectionHeading,
  Panel,
  MoneyDisplay,
  PriceDelta,
  EmptyState,
  LineChart,
  RangePills,
  Pill,
  Button,
} from "@/components/ui";
import AddToCollection from "./AddToCollection";
import YourCopies from "./YourCopies";

// "You own" counts are per-user: never prerender or cache across users.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The card with the signed-in user's copies folded in, or `notFound()`. `cache` makes this one
 *  query per request even though both `generateMetadata` and the page ask for it. */
const load = cache(async (id: string) => {
  const cardId = parseRouteId(id);
  if (cardId == null) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const detail = await getCardDetail(session.user.id, cardId);
  if (!detail) notFound();
  return { userId: session.user.id, detail };
});

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const { detail } = await load(id);
  return { title: `${detail.card.name} — Hitstreak` };
}

const MAX_ATTRS = 8;
// Number and rarity already appear in the caption line.
const SKIP_ATTRS = new Set(["number", "rarity"]);

export default async function CardDetailPage({ params, searchParams }: PageProps<"/cards/[id]">) {
  const { id } = await params;
  const { userId, detail } = await load(id);
  const { card, printings } = detail;

  // The headline price is the card's most valuable printing (the one people mean by "the card").
  // Null for the ~4% of cards with no printings yet (printings are created by the price ingest).
  const primary =
    printings.reduce<(typeof printings)[number] | null>(
      (best, p) => (p.market != null && (best?.market == null || p.market > best.market) ? p : best),
      null
    ) ?? printings[0] ?? null;

  const { range: rawRange, p: rawP, from: rawFrom } = await searchParams;
  const range = parseRange(rawRange);
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeStart(range, today);
  const requested = typeof rawP === "string" ? parseRouteId(rawP) : null;
  // PrintingPrice | null: `?p=` when it names one of this card's printings, else the headline one.
  const chartPrinting = printings.find((x) => x.printingId === requested) ?? primary;
  const [collections, history, holders, lots] = await Promise.all([
    listCollections(userId),
    chartPrinting ? getPrintingHistory(chartPrinting.printingId, from, today) : Promise.resolve<Point[]>([]),
    getCardHolders(userId, card.id),
    getCardLots(userId, card.id),
  ]);
  const stats = seriesStats(history);

  // Where "back" goes. The set is the fallback because a card does belong to one, but arriving from
  // a collection, from Home or from an alert and being offered the set is a dead end.
  const fromPath = typeof rawFrom === "string" ? rawFrom : "";
  const fromCollectionId = collectionIdFromPath(fromPath);
  const fromCollection = fromCollectionId == null ? null : await getCollection(userId, fromCollectionId);
  const back = resolveBack(
    rawFrom,
    { href: `/sets/${card.setId}`, label: card.setName },
    { collectionName: fromCollection?.name }
  );
  const hrefFor = (r: Range, printingId: number) =>
    `/cards/${card.id}?range=${r}${printingId === primary?.printingId ? "" : `&p=${printingId}`}`;

  // Follows the range pills, exactly as the collection page does — a 1Y chart with a "past 30 days"
  // delta beside it was the old behaviour. Falls back to the printing's stored 30-day change when
  // the window holds too little history to derive one.
  const change = stats?.change ?? primary?.change30d ?? null;
  const changeCaption = stats?.change ? RANGE_CAPTION[range] : "past 30 days";

  // TCGplayer ships these as HTML fragments — ~29,000 cards carry <br>, <strong> or <em> in
  // CardText and the attack lines — so they are stripped to text here rather than rendered. Never
  // dangerouslySetInnerHTML: this is third-party content the ingest does not control.
  const attrs = Object.entries(card.attrs)
    .filter(([k, v]) => !SKIP_ATTRS.has(k.toLowerCase()) && hasText(v))
    .map(([k, v]) => [k, toPlainText(v)] as const)
    .slice(0, MAX_ATTRS);

  return (
    <div className="mx-auto grid w-full max-w-read gap-11 md:grid-cols-[340px_1fr]">
      <div className="flex flex-col gap-3.5">
        <Link href={back.href} className="text-caption text-muted hover:text-ink">
          ← {back.label}
        </Link>
        <div
          role="img"
          aria-label={card.name}
          className="aspect-[5/7] rounded-[16px] border border-hairline bg-hairline-soft shadow-tile"
          style={
            card.imageUrl
              ? { backgroundImage: `url(${card.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        />
        <AddToCollection
          collections={collections}
          card={{
            name: card.name,
            subtitle: `${card.setName} · ${card.number ?? ""}`,
            imageUrl: card.imageUrl,
            printings,
          }}
        />
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-muted">
            {card.gameName} · {card.setName} · {card.number ?? "—"} · {card.rarity ?? "—"}
          </span>
          <SectionHeading as="h1" title={card.name} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <MoneyDisplay amount={primary?.market ?? null} />
            <PriceDelta
              amount={change?.amount ?? null}
              ratio={change?.ratio ?? null}
              caption={changeCaption}
            />
          </div>
          <span className="text-caption text-dim">Market price · as of {primary?.priceDate ?? "—"}</span>
        </div>

        <Panel className="flex flex-col gap-2.5">
          <span className="font-semibold text-ink">Printings</span>
          <div className="flex flex-col">
            <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3 border-b border-hairline-soft pb-2 text-caption text-dim">
              <span>Printing</span>
              <span className="text-right">Market</span>
              <span className="text-right">You own</span>
            </div>
            {printings.map((p) => (
              <div
                key={p.printingId}
                className="grid grid-cols-[1.6fr_1fr_1fr] items-center gap-3 border-b border-hairline-soft py-2 last:border-b-0"
              >
                <span className="text-ink">{p.subtype}</span>
                <span className="num text-right font-semibold text-ink">{formatMoney(p.market)}</span>
                <span className={p.owned > 0 ? "num text-right text-ink" : "num text-right text-dim"}>
                  {p.owned > 0 ? p.owned : "—"}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-wrap items-center gap-3 text-caption">
          {holders.length === 0 ? (
            <span className="text-dim">Not in any of your collections yet.</span>
          ) : (
            <span className="text-muted">
              In your collections:{" "}
              {holders.map((h, i) => (
                <span key={h.collectionId}>
                  {i > 0 && ", "}
                  <Link href={`/collections/${h.collectionId}`} className="text-ink">
                    {h.name}
                  </Link>
                  <span className="num text-dim"> ×{h.quantity}</span>
                </span>
              ))}
            </span>
          )}
          {primary && (
            <Button href={`/alerts?printing=${primary.printingId}`} variant="secondary" size="sm" className="ml-auto">
              Set a price alert
            </Button>
          )}
        </div>

        {/* One row per acquisition. Everywhere else folds lots into a holding and shows the total;
            this is the only place the folding comes apart, and the only place a single purchase can
            be corrected without touching the others. */}
        {lots.length > 0 && <YourCopies lots={lots} />}

        <Panel className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-ink">Price history</span>
            {stats && (
              <span className="num ml-auto text-caption text-dim">
                Low {formatMoney(stats.low)} · High {formatMoney(stats.high)}
              </span>
            )}
          </div>
          {chartPrinting ? (
            <>
              {printings.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {printings.map((p) => (
                    <Pill
                      key={p.printingId}
                      href={hrefFor(range, p.printingId)}
                      selected={p.printingId === chartPrinting.printingId}
                      scroll={false}
                    >
                      {p.subtype}
                    </Pill>
                  ))}
                </div>
              )}
              <LineChart
                points={history}
                from={chartFrom(range, from, history, today)}
                to={today}
                label={`${card.name} (${chartPrinting.subtype}) market price, ${RANGE_CAPTION[range]}`}
              />
              <RangePills current={range} hrefFor={(r) => hrefFor(r, chartPrinting.printingId)} />
            </>
          ) : (
            <EmptyState title="No price history yet" body="This card has no priced printings." />
          )}
        </Panel>

        {attrs.length > 0 && (
          <Panel className="flex flex-col gap-2">
            <span className="font-semibold text-ink">Details</span>
            <dl className="flex flex-col gap-1 text-caption">
              {attrs.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="shrink-0 text-dim">{k}:</dt>
                  {/* whitespace-pre-line keeps the line breaks that were <br> before stripping. */}
                  <dd className="whitespace-pre-line text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        )}
      </div>
    </div>
  );
}

