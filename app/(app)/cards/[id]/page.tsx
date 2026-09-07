import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getCardDetail } from "@/lib/catalog";
import { listPortfolios } from "@/lib/portfolios";
import { formatDelta, formatMoney, formatPercent } from "@/lib/format";
import { SectionHeading, Panel, MoneyDisplay, PriceDelta, EmptyState } from "@/components/ui";
import AddToBinder from "./AddToBinder";

// "You own" counts are per-user: never prerender or cache across users.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The card with the signed-in user's copies folded in, or `notFound()`. */
async function load(params: Params["params"]) {
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isInteger(cardId)) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const detail = await getCardDetail(session.user.id, cardId);
  if (!detail) notFound();
  return { userId: session.user.id, detail };
}

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const cardId = Number(id);
  const session = Number.isInteger(cardId) ? await getSession() : null;
  const detail = session ? await getCardDetail(session.user.id, cardId) : null;
  return { title: detail ? `${detail.card.name} — Hitstreak` : "Card — Hitstreak" };
}

const MAX_ATTRS = 8;
// Number and rarity already appear in the caption line.
const SKIP_ATTRS = new Set(["number", "rarity"]);

export default async function CardDetailPage({ params }: Params) {
  const { userId, detail } = await load(params);
  const { card, printings } = detail;
  const portfolios = await listPortfolios(userId);

  // The headline price is the card's most valuable printing (the one people mean by "the card").
  const primary =
    printings.reduce<(typeof printings)[number] | null>(
      (best, p) => (p.market != null && (best?.market == null || p.market > best.market) ? p : best),
      null
    ) ?? printings[0] ?? null;

  const change = primary?.change30d ?? null;
  const changeText = change
    ? `30-day change: ${formatDelta(change.amount)} (${formatPercent(change.ratio)})`
    : "Not enough history yet.";

  const attrs = Object.entries(card.attrs)
    .filter(([k, v]) => !SKIP_ATTRS.has(k.toLowerCase()) && String(v).trim() !== "")
    .slice(0, MAX_ATTRS);

  return (
    <div className="grid gap-11 md:grid-cols-[340px_1fr]">
      <div className="flex flex-col gap-3.5">
        <Link href={`/sets/${card.setId}`} className="text-[13px] text-muted hover:text-ink">
          ← {card.setName}
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
        <AddToBinder
          portfolios={portfolios}
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
          <span className="text-[13px] text-muted">
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
              caption="past 30 days"
            />
          </div>
          <span className="text-xs text-dim">Market price · as of {primary?.priceDate ?? "—"}</span>
        </div>

        <Panel className="flex flex-col gap-2.5">
          <span className="font-semibold text-ink">Printings</span>
          <div className="flex flex-col">
            <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3 border-b border-hairline-soft pb-2 text-xs text-dim">
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

        <Panel className="flex flex-col gap-2.5">
          <span className="font-semibold text-ink">Price history</span>
          <EmptyState title="Charts arrive in Phase 3" body={changeText} />
        </Panel>

        {attrs.length > 0 && (
          <Panel className="flex flex-col gap-2">
            <span className="font-semibold text-ink">Details</span>
            <dl className="flex flex-col gap-1 text-[13px]">
              {attrs.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-dim">{k}:</dt>
                  <dd className="text-ink">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        )}
      </div>
    </div>
  );
}

