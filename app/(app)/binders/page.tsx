import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listPortfolios, getPortfolioSummary } from "@/lib/portfolios";
import { formatMoney } from "@/lib/format";
import { SectionHeading, Panel, StatTile, PriceDelta, MoneyDisplay, EmptyState } from "@/components/ui";
import PortfolioForm, { RenameToggle } from "./PortfolioForm";
import DeletePortfolioButton from "./DeletePortfolioButton";

export const metadata = { title: "Binders — Hitstreak" };
// Per-user data valued from latest_prices: never prerender or cache across users.
export const dynamic = "force-dynamic";

export default async function PortfoliosPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const userId = session.user.id;

  const portfolios = await listPortfolios(userId);
  const summaries = await Promise.all(portfolios.map((p) => getPortfolioSummary(userId, p.id)));
  const n = portfolios.length;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading as="h1" title="Your binders" caption={`${n} binder${n === 1 ? "" : "s"}`} />

      {n === 0 ? (
        <EmptyState
          title="No binders yet"
          body="Create one to start tracking the cards you own."
          action={<PortfolioForm mode="create" />}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {portfolios.map((p, i) => {
              const s = summaries[i];
              return (
                <Panel key={p.id} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <Link href={`/binders/${p.id}`} className="font-semibold text-ink">
                      {p.name}
                    </Link>
                    <div className="flex flex-col items-end gap-1">
                      <MoneyDisplay amount={s.value} />
                      <PriceDelta
                        amount={s.gain}
                        ratio={s.cost > 0 ? s.gain / s.cost : null}
                        caption="vs. paid"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <StatTile label="Paid" value={formatMoney(s.cost)} />
                    <StatTile label="Cards" value={String(s.cards)} />
                    {s.unpriced > 0 ? (
                      <StatTile label="Unpriced" value={String(s.unpriced)} />
                    ) : (
                      <StatTile label="Priced" value={String(s.cards - s.unpriced)} />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <RenameToggle id={p.id} name={p.name} />
                    <DeletePortfolioButton id={p.id} name={p.name} count={s.cards} />
                  </div>
                </Panel>
              );
            })}
          </div>

          <Panel>
            <PortfolioForm mode="create" />
          </Panel>
        </>
      )}
    </div>
  );
}
