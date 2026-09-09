import Link from "next/link";
import type { DeckSummary } from "@/lib/decks/data";
import type { GapAnalysis } from "@/lib/decks/gap";
import { formatMoney } from "@/lib/format";
import { Panel, ProgressBar, TierBadge } from "@/components/ui";

/** One meta deck in the browser: name, archetype, You own x / N, $ to complete, completion bar.
 *  Server component — no hooks; a `Link` around a `Panel`, like `SetPanel` on /sets. */
export default function DeckSummaryPanel({ deck, gap }: { deck: DeckSummary; gap: GapAnalysis }) {
  const ratio = gap.total > 0 ? gap.owned / gap.total : 0;
  const complete = gap.missing === 0 && gap.total > 0;
  return (
    <Link href={`/decks/${deck.id}`} className="block">
      <Panel className="flex flex-col gap-2.5 transition-colors hover:border-ink">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-center gap-2 font-semibold text-ink">
            {deck.name}
            {deck.tier != null && <TierBadge tier={deck.tier} />}
          </span>
          {deck.archetype && deck.archetype !== deck.name && <span className="text-[13px] text-dim">{deck.archetype}</span>}
        </div>
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-muted">
            You own <span className="num font-semibold text-ink">{gap.owned} / {gap.total}</span>
          </span>
          <span className="num">
            {complete ? (
              <span className="font-semibold text-gain">Complete</span>
            ) : (
              <>
                <span className="font-semibold text-ink">{formatMoney(gap.missingCost)}</span> <span className="text-muted">to complete</span>
              </>
            )}
          </span>
        </div>
        <ProgressBar value={ratio} label={`${deck.name} completion`} tone={complete ? "gain" : gap.owned > 0 ? "accent" : "muted"} />
        {gap.unpricedMissing > 0 && (
          <span className="text-xs text-dim">
            {gap.unpricedMissing} missing {gap.unpricedMissing === 1 ? "copy has" : "copies have"} no market price
          </span>
        )}
      </Panel>
    </Link>
  );
}
