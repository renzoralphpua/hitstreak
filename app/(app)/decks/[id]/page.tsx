import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { getDeck } from "@/lib/decks/data";
import { loadOwnedByKey, analyzeGap } from "@/lib/decks/gap";
import { describeRules } from "@/lib/decks/validate";
import { ZONES, ZONE_LABEL } from "@/lib/decks/types";
import { formatMoney } from "@/lib/format";
import { SectionHeading, Panel, StatTile, TierBadge, ValidationList, CardRow, Button } from "@/components/ui";
import CopyDeckButton from "./CopyDeckButton";

import { getDisplay } from "@/lib/display";
// Owned / missing / cost are per-user: never prerender or cache across users.
export const dynamic = "force-dynamic";

/** The deck (a meta deck, or the signed-in user's own), or `notFound()`. `cache` makes this one
 *  query per request even though both `generateMetadata` and the page ask for it. */
const load = cache(async (id: string) => {
  const deckId = parseRouteId(id);
  if (deckId == null) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const deck = await getDeck(deckId, session.user.id);
  if (!deck) notFound();
  return { userId: session.user.id, deck };
});

export async function generateMetadata({ params }: PageProps<"/decks/[id]">) {
  const { id } = await params;
  const { deck } = await load(id);
  return { title: `${deck.name} — Hitstreak` };
}

export default async function DeckDetailPage({ params }: PageProps<"/decks/[id]">) {
  const display = await getDisplay();
  const { id } = await params;
  const { userId, deck } = await load(id);
  const gap = analyzeGap(deck, await loadOwnedByKey(userId, deck.gameSlug));
  const rules = describeRules({
    gameSlug: deck.gameSlug,
    cards: deck.cards.map((l) => ({ cardId: l.cardId, name: l.name, zone: l.zone, quantity: l.quantity, attrs: l.attrs, rarity: l.rarity })),
  });
  // Priciest gaps first: that is where the "cost to complete" comes from.
  const missing = gap.lines.filter((l) => l.missing > 0).sort((a, b) => (b.missingCost ?? 0) - (a.missingCost ?? 0));
  const caption = [deck.tier != null ? `Tier ${deck.tier}` : null, deck.format, deck.sourceNote ? `curated from ${deck.sourceNote}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-5">
      {/* getDeck serves a curated deck OR one of your own, so the way back and the primary action
          both depend on which this is — otherwise your own deck is a dead end here. */}
      <Link
        href={deck.isMeta ? `/decks?game=${deck.gameSlug}` : "/decks/mine"}
        className="text-caption text-muted hover:text-ink"
      >
        ← {deck.isMeta ? "Meta decks" : "My decks"}
      </Link>

      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted">
          {deck.gameName}
          {caption ? ` · ${caption}` : ""}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <SectionHeading as="h1" title={deck.name} />
          {deck.tier != null && <TierBadge tier={deck.tier} />}
          {deck.isMeta ? (
            <CopyDeckButton sourceId={deck.id} />
          ) : (
            <Button href={`/decks/mine/${deck.id}`} size="sm">Open in builder</Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="You own" value={`${gap.owned} / ${gap.total}`} />
        <StatTile label="Missing" value={`${gap.missing} card${gap.missing === 1 ? "" : "s"}`} />
        <StatTile label="Cost to complete" value={formatMoney(gap.missingCost, { display })} tone={gap.missing === 0 ? "gain" : "default"} />
      </div>
      {gap.unpricedMissing > 0 && (
        <p className="text-caption text-dim">
          {gap.unpricedMissing} missing {gap.unpricedMissing === 1 ? "copy has" : "copies have"} no market price and{" "}
          {gap.unpricedMissing === 1 ? "is" : "are"} left out of the cost.
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        <Panel className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-ink">Missing cards</span>
            <span className="text-caption text-dim">· priced at market</span>
          </div>
          {missing.length === 0 ? (
            <p className="text-base text-gain">You own every card in this deck.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {missing.map((l) => (
                <li key={`${l.zone}-${l.cardId}`}>
                  <CardRow
                    name={l.name}
                    subtitle={[l.setName, l.number, l.zone !== "main" ? ZONE_LABEL[l.zone] : null].filter(Boolean).join(" · ")}
                    imageUrl={l.imageUrl}
                    right={
                      <>
                        <span className="text-base font-semibold text-ink">×{l.missing}</span>
                        <span className="text-micro text-dim">{l.missingCost == null ? "no price" : formatMoney(l.missingCost, { display })}</span>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <details className="text-caption">
            <summary className="flex min-h-11 cursor-pointer items-center text-muted hover:text-ink md:min-h-8">Show full list ({gap.total})</summary>
            <div className="mt-2 flex flex-col gap-3">
              {ZONES[deck.gameSlug].map((z) => {
                const lines = gap.lines.filter((l) => l.zone === z);
                if (lines.length === 0) return null;
                return (
                  <div key={z} className="flex flex-col gap-1">
                    <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted">{ZONE_LABEL[z]}</span>
                    {lines.map((l) => (
                      <div key={l.cardId} className="flex items-baseline justify-between gap-3 border-b border-hairline-soft py-1 last:border-b-0">
                        <span className={l.missing === 0 ? "text-ink" : "text-muted"}>
                          <span className="num text-dim">×{l.quantity}</span> {l.name}{" "}
                          <span className="text-caption text-dim">
                            {l.setName} · {l.number ?? "—"}
                          </span>
                        </span>
                        <span className={`num text-caption ${l.missing === 0 ? "text-gain" : "text-dim"}`}>
                          {l.missing === 0 ? "owned" : `${l.owned} of ${l.quantity}`}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </details>
        </Panel>

        <Panel className="flex flex-col gap-2.5">
          <span className="font-semibold text-ink">Legality</span>
          <ValidationList items={rules} />
        </Panel>
      </div>
    </div>
  );
}
