import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { parseView } from "@/lib/view-mode";
import { getPortfolio, getPortfolioHoldings, getPortfolioSummary } from "@/lib/portfolios";
import { getShareLink } from "@/lib/share";
import {
  parseRange,
  rangeStart,
  chartFrom,
  seriesStats,
  withLivePoint,
  getPortfolioHistory,
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
  Pill,
} from "@/components/ui";
import HoldingsTable from "./HoldingsTable";
import BinderGrid from "./BinderGrid";
import AddItemDialog from "./AddItemDialog";
import SharePanel from "./SharePanel";

// Per-user data valued from latest_prices: never prerender or cache across users.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The binder id and the owner, or `notFound()`. `cache` makes this one query per request even
 *  though both `generateMetadata` and the page ask for it. */
const load = cache(async (id: string) => {
  const portfolioId = parseRouteId(id);
  if (portfolioId == null) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const portfolio = await getPortfolio(session.user.id, portfolioId);
  if (!portfolio) notFound();
  return { userId: session.user.id, portfolioId, portfolio };
});

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const { portfolio } = await load(id);
  return { title: `${portfolio.name} — Hitstreak` };
}

export default async function PortfolioDetailPage({ params, searchParams }: PageProps<"/portfolios/[id]">) {
  const { id } = await params;
  const { userId, portfolioId, portfolio } = await load(id);
  const { range: rawRange, view: rawView } = await searchParams;
  const range = parseRange(rawRange);
  const view = parseView(rawView);
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeStart(range, today);
  const [holdings, summary, shareLink] = await Promise.all([
    getPortfolioHoldings(userId, portfolioId),
    getPortfolioSummary(userId, portfolioId),
    getShareLink(userId, portfolioId),
  ]);
  // portfolio_history is materialized nightly; tonight's live value is the final point until then.
  const history = withLivePoint(await getPortfolioHistory(userId, portfolioId, from, today), today, summary.value);
  const stats = seriesStats(history);
  const gainSign = summary.gain >= 0 ? "+" : "−";

  return (
    <div className="grid gap-10 md:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-4">
        <Link href="/portfolios" className="text-caption text-muted hover:text-ink">
          ← Binders
        </Link>

        <SectionHeading
          as="h1"
          title={portfolio.name}
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
            label={`${portfolio.name} value, ${RANGE_CAPTION[range]}`}
          />
          <RangePills current={range} hrefFor={(r) => `/portfolios/${portfolioId}?range=${r}&view=${view}`} />
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

        {holdings.length > 0 && <AddItemDialog portfolioId={portfolioId} />}

        <SharePanel portfolioId={portfolioId} link={shareLink} />
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeading
          title="Cards"
          caption="sorted by value"
          trailing={
            holdings.length > 0 ? (
              <div className="flex gap-1.5">
                {/* Grid is for recognising a card, the list is for changing it — which is why the
                    stepper and Remove exist only in the list. `scroll={false}` keeps your place
                    when you flip between them. */}
                <Pill href={`/portfolios/${portfolioId}?range=${range}&view=grid`} selected={view === "grid"} scroll={false}>
                  Grid
                </Pill>
                <Pill href={`/portfolios/${portfolioId}?range=${range}&view=list`} selected={view === "list"} scroll={false}>
                  List
                </Pill>
              </div>
            ) : undefined
          }
        />
        {holdings.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="Add a card to start tracking this binder's value."
            action={<AddItemDialog portfolioId={portfolioId} label="Add your first card" />}
          />
        ) : view === "grid" ? (
          <BinderGrid holdings={holdings} />
        ) : (
          <HoldingsTable portfolioId={portfolioId} holdings={holdings} />
        )}
      </div>
    </div>
  );
}
