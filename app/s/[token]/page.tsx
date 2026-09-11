import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedPortfolio } from "@/lib/share";
import { getPortfolioHistory, parseRange, rangeStart, chartFrom, withLivePoint, seriesStats, RANGE_CAPTION } from "@/lib/history";
import { formatMoney } from "@/lib/format";
import { SectionHeading, MoneyDisplay, PriceDelta, CardRow, LineChart, RangePills, EmptyState } from "@/components/ui";

// The token is the credential: no caching across requests, and never indexed.
export const dynamic = "force-dynamic";

/** One lookup per request even though generateMetadata and the page both ask (same pattern as the
 *  other detail pages). */
const load = cache((token: string) => getSharedPortfolio(token));

export async function generateMetadata({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const shared = await load(token);
  return { title: shared ? `${shared.name} — Hitstreak` : "Hitstreak", robots: { index: false, follow: false } };
}

export default async function SharedPortfolioPage({ params, searchParams }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const { range: rawRange } = await searchParams;
  const shared = await load(token);
  if (!shared) notFound();
  const range = parseRange(rawRange);
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeStart(range, today);
  const history = withLivePoint(await getPortfolioHistory(shared.ownerId, shared.portfolioId, from, today), today, shared.value);
  const stats = seriesStats(history);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center gap-4 border-b border-hairline px-6 md:px-10">
        <Link href="/" className="font-display text-wordmark text-ink">Hitstreak</Link>
        <span className="text-caption text-dim">Shared binder · read-only</span>
      </header>
      <main className="grid grow gap-10 px-6 py-6 md:grid-cols-[380px_1fr] md:px-10">
        <div className="flex flex-col gap-4">
          <SectionHeading as="h1" title={shared.name} caption={`${shared.cards} card${shared.cards === 1 ? "" : "s"}`} />
          <MoneyDisplay size="lg" amount={shared.value} />
          {stats?.change && <PriceDelta amount={stats.change.amount} ratio={stats.change.ratio} caption={RANGE_CAPTION[range]} />}
          <div className="flex flex-col gap-2">
            <LineChart
              points={history}
              from={chartFrom(range, from, history, today)}
              to={today}
              height={120}
              label={`${shared.name} value, ${RANGE_CAPTION[range]}`}
            />
            <RangePills current={range} hrefFor={(r) => `/s/${token}?range=${r}`} />
          </div>
          {shared.unpriced > 0 && <p className="text-caption text-dim">{shared.unpriced} {shared.unpriced === 1 ? "copy has" : "copies have"} no market price yet.</p>}
        </div>
        <div className="flex flex-col gap-4">
          <SectionHeading title="Cards" caption="sorted by value" />
          {shared.holdings.length === 0 ? (
            <EmptyState title="Nothing here yet" />
          ) : (
            <ul className="flex flex-col gap-2">
              {shared.holdings.map((h) => (
                <li key={`${h.printingId}|${h.condition}`}>
                  <CardRow
                    name={h.cardName}
                    subtitle={[h.setName, h.number, h.subtype, h.condition].filter(Boolean).join(" · ")}
                    imageUrl={h.imageUrl}
                    right={
                      <>
                        <span className="text-stat font-semibold text-ink">{formatMoney(h.value)}</span>
                        <span className="text-micro text-dim">×{h.quantity}</span>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
