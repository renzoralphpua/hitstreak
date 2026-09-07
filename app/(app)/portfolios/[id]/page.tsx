import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPortfolio, getPortfolioHoldings, getPortfolioSummary } from "@/lib/portfolios";
import { formatMoney } from "@/lib/format";
import { SectionHeading, StatTile, PriceDelta, MoneyDisplay, EmptyState } from "@/components/ui";
import HoldingsTable from "./HoldingsTable";
import AddItemDialog from "./AddItemDialog";

// Per-user data valued from latest_prices: never prerender or cache across users.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The binder id and the owner, or `notFound()`. `cache` makes this one query per request even
 *  though both `generateMetadata` and the page ask for it. */
const load = cache(async (id: string) => {
  const portfolioId = Number(id);
  if (!Number.isInteger(portfolioId)) notFound();
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

export default async function PortfolioDetailPage({ params }: Params) {
  const { id } = await params;
  const { userId, portfolioId, portfolio } = await load(id);
  const [holdings, summary] = await Promise.all([
    getPortfolioHoldings(userId, portfolioId),
    getPortfolioSummary(userId, portfolioId),
  ]);
  const gainSign = summary.gain >= 0 ? "+" : "−";

  return (
    <div className="grid gap-10 md:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-4">
        <Link href="/portfolios" className="text-[13px] text-muted hover:text-ink">
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
          <p className="text-[13px] text-dim">
            {summary.unpriced} {summary.unpriced === 1 ? "copy has" : "copies have"} no market price yet, so
            they are left out of the total.
          </p>
        )}

        {holdings.length > 0 && <AddItemDialog portfolioId={portfolioId} />}
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeading title="Cards" caption="sorted by value" />
        {holdings.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="Add a card to start tracking this binder's value."
            action={<AddItemDialog portfolioId={portfolioId} label="Add your first card" />}
          />
        ) : (
          <HoldingsTable portfolioId={portfolioId} holdings={holdings} />
        )}
      </div>
    </div>
  );
}
