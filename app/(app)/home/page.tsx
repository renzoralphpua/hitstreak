import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getHomeSummary, getMovers, getHomeHistory } from "@/lib/home";
import { listMyDecks } from "@/lib/decks/data";
import { listAlerts } from "@/lib/alerts";
import { parseRange, rangeStart, chartFrom, RANGE_CAPTION } from "@/lib/history";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  SectionHeading, Panel, StatTile, PriceDelta, MoneyDisplay, EmptyState,
  LineChart, RangePills, Button, CardRow,
} from "@/components/ui";

export const metadata = { title: "Home — Hitstreak" };
// Every figure here is this user's own holdings valued from latest_prices.
export const dynamic = "force-dynamic";

const MOVERS_PER_COLUMN = 3;
const ALERTS_SHOWN = 3;
const DECKS_SHOWN = 3;

/**
 * Home is what you READ (decision 1). Nothing on this page edits anything — every control is a link
 * to the screen that owns the change. The collection rows are a breakdown, not a switcher, which is why
 * none of them is drawn as the selected ink chip.
 *
 * Every figure is against cost basis (decision 1a). The range pills move the CHART's window only:
 * the headline gain is a level, not a window figure, so it does not move when the range changes —
 * what changes is how much of the value-against-cost story you can see.
 */
export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const userId = session.user.id;

  const { range: rawRange } = await searchParams;
  const range = parseRange(rawRange);
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeStart(range, today);

  const [summary, movers, history, myDecks, alerts] = await Promise.all([
    getHomeSummary(userId),
    getMovers(userId, MOVERS_PER_COLUMN),
    getHomeHistory(userId, from, today),
    listMyDecks(userId),
    listAlerts(userId),
  ]);

  if (summary.collections === 0) {
    return (
      <EmptyState
        title="Nothing tracked yet"
        body="Create a collection and add the first card you own. Everything on this page is measured against what you paid, so add what it cost you and the rest follows."
        action={<Button href="/collections">Create a collection</Button>}
      />
    );
  }

  const triggered = alerts.filter((a) => !a.armed).slice(0, ALERTS_SHOWN);
  const decks = myDecks.slice(0, DECKS_SHOWN);

  return (
    <div className="grid gap-10 md:grid-cols-[380px_1fr]">
      {/* Everything you own */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="num text-caption text-muted">
            Everything you own · {summary.collections} collection{summary.collections === 1 ? "" : "s"} · {summary.cards} card
            {summary.cards === 1 ? "" : "s"}
          </span>
          <MoneyDisplay size="lg" amount={summary.value} />
          <PriceDelta amount={summary.gain} ratio={summary.ratio} caption="vs paid" />
        </div>

        <div className="flex flex-col gap-2">
          <LineChart
            points={history.value}
            baseline={history.cost}
            from={chartFrom(range, from, history.value, today)}
            to={today}
            height={120}
            label={`Collection value against cost basis, ${RANGE_CAPTION[range]}`}
          />
          <RangePills current={range} hrefFor={(r) => `/home?range=${r}`} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Paid" value={formatMoney(summary.cost)} />
          {/* Not "Gain" — that is the headline above, and a stat tile restating its own headline is
              the duplication the UI audit already flagged on the collection page. */}
          <StatTile
            label="In profit"
            value={summary.comparable === 0 ? "—" : `${summary.inProfit} of ${summary.comparable}`}
          />
        </div>

        {summary.uncostedQuantity > 0 && (
          <p className="text-caption text-dim">
            {summary.uncostedQuantity} {summary.uncostedQuantity === 1 ? "copy has" : "copies have"} no recorded
            cost, so the gain above is overstated by whatever they cost you.
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          <span className="text-caption font-semibold uppercase tracking-label text-muted">By collection</span>
          <div className="flex flex-col gap-2">
            {summary.lines.map((l) => (
              <Link
                key={l.collectionId}
                href={`/collections/${l.collectionId}`}
                className="flex items-center gap-3 rounded-tile border border-hairline bg-surface px-3.5 py-2.5 hover:border-hairline-strong"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">{l.name}</span>
                  <span className="num text-caption text-dim">
                    {l.cards} card{l.cards === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="ml-auto flex flex-col items-end">
                  <span className="num font-semibold text-ink">{formatMoney(l.value)}</span>
                  {l.cost > 0 ? (
                    <PriceDelta format="percent" amount={l.gain} ratio={l.ratio} />
                  ) : (
                    <span className="text-micro text-dim">no cost recorded</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* What happened */}
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <SectionHeading title="Winners and losers" caption="vs what you paid" />
          {movers.winners.length === 0 && movers.losers.length === 0 ? (
            <EmptyState
              title="Nothing to compare yet"
              body="Record what you paid for a card and it will show up here once its price moves."
            />
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              <MoverColumn title="Biggest winners" movers={movers.winners} />
              <MoverColumn title="Biggest losers" movers={movers.losers} />
            </div>
          )}
        </div>

        <div className="grid gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <SectionHeading
              title="Decks"
              trailing={<Link href="/decks/mine" className="text-caption font-semibold text-accent">All decks</Link>}
            />
            {decks.length === 0 ? (
              <EmptyState title="No decks yet" body="Build one to see how close you are to finishing it." />
            ) : (
              <div className="flex flex-col gap-2.5">
                {decks.map((d) => (
                  <Panel key={d.id} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/decks/mine/${d.id}`} className="font-semibold text-ink">
                        {d.name}
                      </Link>
                      <span className="num text-caption text-dim">{d.cardCount} cards</span>
                    </div>
                    <span className="text-caption text-dim">
                      {d.gameName}
                      {d.isDraft ? " · draft" : ""}
                    </span>
                  </Panel>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <SectionHeading
              title="Alerts"
              trailing={
                <Link href="/alerts" className="text-caption font-semibold text-accent">
                  All {alerts.length} alert{alerts.length === 1 ? "" : "s"}
                </Link>
              }
            />
            {triggered.length === 0 ? (
              <EmptyState title="Nothing triggered" body="Alerts you set will show here when a price crosses them." />
            ) : (
              <ul className="flex flex-col gap-2">
                {triggered.map((a) => (
                  <li key={a.id}>
                    <Link href={`/cards/${a.cardId}`} className="block">
                      <CardRow
                        name={a.cardName}
                        subtitle={`${a.direction === "above" ? "Rises above" : "Drops below"} ${formatMoney(a.threshold)}`}
                        imageUrl={a.imageUrl}
                        right={<span className="num font-semibold text-ink">{formatMoney(a.market)}</span>}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Winners and losers share a shape; only the order and the sign differ. */
function MoverColumn({ title, movers }: { title: string; movers: Awaited<ReturnType<typeof getMovers>>["winners"] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-caption font-semibold uppercase tracking-label text-muted">{title}</span>
      {movers.length === 0 ? (
        <span className="text-caption text-dim">None.</span>
      ) : (
        <ul className="flex flex-col gap-2">
          {movers.map((m) => (
            <li key={m.printingId}>
              <Link href={`/cards/${m.cardId}`} className="block">
                <CardRow
                  name={m.quantity > 1 ? `${m.cardName} ×${m.quantity}` : m.cardName}
                  subtitle={[m.setName, m.number, m.subtype].filter(Boolean).join(" · ")}
                  imageUrl={m.imageUrl}
                  right={
                  <>
                    <span className="num font-semibold text-ink">{formatMoney(m.value)}</span>
                    <span className={`num text-caption font-medium ${m.gain > 0 ? "text-gain" : "text-accent"}`}>
                      {m.gain > 0 ? "+" : "−"}
                      {formatMoney(Math.abs(m.gain))} · {formatPercent(m.ratio)}
                    </span>
                    </>
                  }
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
