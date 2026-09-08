"use client";
// The deck builder (docs/design/Builder.dc.html): search on the left, the deck in the middle, legality
// and cost on the right. Everything below the search re-computes on every keystroke, which is why the
// gap arithmetic and the validators are db-free (lib/decks/gap-math.ts, lib/decks/validate.ts) — see
// tests/ranges.test.ts. The server re-validates the save from the catalog's own attrs and its verdict,
// not this one, is what the header finally reports.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DeckDetail, DeckLine } from "@/lib/decks/data";
import type { PrintingPrice } from "@/lib/catalog";
import { QTY_MAX, ZONES, ZONE_LABEL, type Zone, type ValidationResult } from "@/lib/decks/types";
import { analyzeGap, type GapLine } from "@/lib/decks/gap-math";
import { validationItems } from "@/lib/decks/validate";
import { defaultZone, isSingleCardZone } from "@/lib/decks/zone";
import { identityKey } from "@/lib/decks/identity";
import { formatMoney } from "@/lib/format";
import { Button, CardRow, Panel, SearchField, SectionHeading, StatTile, ValidationList } from "@/components/ui";
import { useCardSearch, type CardHit } from "@/components/ui/useCardSearch";
import { saveDeckAction } from "../../actions";

/** "clean" = as loaded, "dirty" = edited since the last save, otherwise the server's own verdict. */
type Saved = "clean" | "dirty" | ValidationResult;
/** A deck line is unique by (card, zone) — see `checkLines` in lib/decks/data.ts. */
type LineKey = { cardId: number; zone: Zone };
type OnQuantity = (line: LineKey, n: number) => void;

function cheapest(printings: PrintingPrice[]): number | null {
  let low: number | null = null;
  for (const p of printings) if (p.market != null && (low == null || p.market < low)) low = p.market;
  return low;
}

const lineFromHit = (hit: CardHit, zone: Zone): DeckLine => ({
  cardId: hit.cardId, zone, quantity: 1, name: hit.name, setName: hit.setName, number: hit.number,
  rarity: hit.rarity, imageUrl: hit.imageUrl, attrs: hit.attrs, market: cheapest(hit.printings),
});

export default function Builder({ deck, owned }: { deck: DeckDetail; owned: Record<string, number> }) {
  const router = useRouter();
  const [lines, setLines] = useState<DeckLine[]>(deck.cards);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved>("clean");

  const { hits, settled, error: searchError } = useCardSearch(q, true, deck.gameSlug);
  const ownedByKey = useMemo(() => new Map(Object.entries(owned)), [owned]);
  const gap = useMemo(() => analyzeGap({ gameSlug: deck.gameSlug, cards: lines }, ownedByKey), [deck.gameSlug, lines, ownedByKey]);
  const rules = useMemo(
    () => validationItems({
      gameSlug: deck.gameSlug,
      cards: lines.map((l) => ({ cardId: l.cardId, name: l.name, zone: l.zone, quantity: l.quantity, attrs: l.attrs, rarity: l.rarity })),
    }),
    [deck.gameSlug, lines]
  );

  const edit = (next: DeckLine[]) => {
    setLines(next);
    setSaved("dirty");
  };

  /** A search hit joins the zone its type says it belongs in, given what the deck already holds (a
   *  second Riftbound Champion Unit goes to the main deck rather than replacing the Chosen Champion);
   *  a second copy bumps the line it is already on, except in the one-card zones, where it replaces
   *  what is there. */
  function add(hit: CardHit) {
    const zone = defaultZone(deck.gameSlug, hit, lines);
    if (isSingleCardZone(zone)) {
      edit([...lines.filter((l) => l.zone !== zone), lineFromHit(hit, zone)]);
      return;
    }
    const i = lines.findIndex((l) => l.cardId === hit.cardId && l.zone === zone);
    if (i === -1) {
      edit([...lines, lineFromHit(hit, zone)]);
      return;
    }
    const next = [...lines];
    next[i] = { ...next[i], quantity: Math.min(next[i].quantity + 1, QTY_MAX) };
    edit(next);
  }

  /** Identified by (card, zone), not by object identity: the rows render the gap analysis' copies. */
  function setQuantity(target: LineKey, n: number) {
    const hit = (l: DeckLine) => l.cardId === target.cardId && l.zone === target.zone;
    if (n <= 0) {
      edit(lines.filter((l) => !hit(l)));
      return;
    }
    const quantity = isSingleCardZone(target.zone) ? 1 : Math.min(n, QTY_MAX);
    edit(lines.map((l) => (hit(l) ? { ...l, quantity } : l)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await saveDeckAction(deck.id, lines.map(({ cardId, zone, quantity }) => ({ cardId, zone, quantity })));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(res.data ?? { valid: true, errors: [] });
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const ownedOfHit = (hit: CardHit) => owned[identityKey(deck.gameSlug, { name: hit.name, attrs: hit.attrs })] ?? 0;
  const status =
    saved === "clean" ? (deck.isDraft ? "Draft" : "Legal")
      : saved === "dirty" ? "Unsaved changes"
        : saved.valid ? "Saved · legal" : "Saved as draft";

  return (
    <div className="flex flex-col gap-5">
      <Link href="/decks/mine" className="text-[13px] text-muted hover:text-ink">
        ← My decks
      </Link>

      <SectionHeading
        as="h1"
        title={deck.name}
        caption={`${deck.gameName} · ${deck.format ?? "no format"}`}
        trailing={
          <>
            <span className="text-muted">{status}</span>
            <Button size="sm" disabled={busy} onClick={save}>
              Save deck
            </Button>
          </>
        }
      />
      {error && (
        <p role="alert" className="text-[13px] text-accent">
          {error}
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-2.5">
          <SearchField value={q} onChange={setQ} placeholder={`Search ${deck.gameName}…`} />
          {hits.length > 0 && (
            <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.cardId}>
                  <CardRow
                    name={h.name}
                    subtitle={`${h.setName} · ${h.number ?? "—"} · own ${ownedOfHit(h)} · ${formatMoney(cheapest(h.printings))}`}
                    imageUrl={h.imageUrl}
                    onClick={() => add(h)}
                  />
                </li>
              ))}
            </ul>
          )}
          {settled && hits.length === 0 && <p className="text-[13px] text-dim">No cards match “{q.trim()}”.</p>}
          {searchError && (
            <p role="alert" className="text-[13px] text-accent">
              {searchError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3.5">
          {lines.length === 0 && <p className="text-[13px] text-dim">Search for a card to start this deck.</p>}
          {ZONES[deck.gameSlug].map((zone) => {
            const zoneLines = gap.lines.filter((l) => l.zone === zone);
            if (zoneLines.length === 0) return null;
            return <ZoneGroup key={zone} zone={zone} lines={zoneLines} onQuantity={setQuantity} />;
          })}
        </div>

        <div className="flex flex-col gap-3">
          <Panel className="flex flex-col gap-2.5">
            <span className="font-semibold text-ink">Legality</span>
            <ValidationList items={rules} />
          </Panel>
          <div className="grid gap-3">
            <StatTile label="Cards" value={String(gap.total)} />
            <StatTile label="You own" value={`${gap.owned} / ${gap.total}`} tone={gap.missing === 0 && gap.total > 0 ? "gain" : "default"} />
            <StatTile label="Cost to complete" value={formatMoney(gap.missingCost)} tone={gap.missing === 0 ? "gain" : "default"} />
          </div>
          {gap.unpricedMissing > 0 && (
            <p className="text-[13px] text-dim">
              {gap.unpricedMissing} missing {gap.unpricedMissing === 1 ? "copy has" : "copies have"} no market price and{" "}
              {gap.unpricedMissing === 1 ? "is" : "are"} left out of the cost.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** One zone's lines under the shared uppercase group label, with the zone's card subtotal. */
function ZoneGroup({ zone, lines, onQuantity }: { zone: Zone; lines: GapLine[]; onQuantity: OnQuantity }) {
  const subtotal = lines.reduce((n, l) => n + l.quantity, 0);
  return (
    <div className="flex flex-col gap-1.5">
      {/* Same group label as AlertList and the meta browser — a §13 `GroupLabel` primitive candidate. */}
      <div className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-[0.06em] text-muted">
        <span>{ZONE_LABEL[zone]}</span>
        <span className="num">{subtotal}</span>
      </div>
      <ul className="flex flex-col divide-y divide-hairline-soft rounded-panel border border-hairline bg-surface">
        {lines.map((l) => (
          <LineRow key={`${l.zone}-${l.cardId}`} line={l} onQuantity={onQuantity} />
        ))}
      </ul>
    </div>
  );
}

function LineRow({ line, onQuantity }: { line: GapLine; onQuantity: OnQuantity }) {
  const single = isSingleCardZone(line.zone);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="px-2.5"
          aria-label={`Remove one ${line.name}`}
          onClick={() => onQuantity(line, line.quantity - 1)}
        >
          −
        </Button>
        <span className="num min-w-6 text-center text-sm font-semibold text-ink">{line.quantity}</span>
        <Button
          variant="secondary"
          size="sm"
          className="px-2.5"
          aria-label={`Add one ${line.name}`}
          disabled={single || line.quantity >= QTY_MAX}
          onClick={() => onQuantity(line, line.quantity + 1)}
        >
          +
        </Button>
      </div>
      <span className="min-w-0 grow text-ink">
        {line.name} <span className="text-xs text-dim">{line.setName} · {line.number ?? "—"}</span>
      </span>
      <span className={`num text-xs ${line.missing === 0 ? "text-gain" : "text-accent"}`}>own {line.owned}</span>
      <span className="num w-16 text-right text-xs text-muted">{formatMoney(line.market)}</span>
    </li>
  );
}
