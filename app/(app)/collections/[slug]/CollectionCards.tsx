"use client";
import { useMemo } from "react";
import type { Holding } from "@/lib/collections";
import { VIEW_MODES, type ViewMode } from "@/lib/view-mode";
import { FoldSection, Pill, SearchField, SectionHeading, StickyBar } from "@/components/ui";
import { usePersisted } from "@/components/ui/usePersisted";
import CollectionGrid from "./CollectionGrid";
import HoldingsTable from "./HoldingsTable";

const asView = (raw: unknown): ViewMode | null =>
  typeof raw === "string" && (VIEW_MODES as readonly string[]).includes(raw) ? (raw as ViewMode) : null;
const asBool = (raw: unknown): boolean | null => (typeof raw === "boolean" ? raw : null);
const asClosed = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.every((x) => typeof x === "string") ? (raw as string[]) : null;

/** A collection mixes singles and sealed. Grouping tells them apart; it is OFF by default because
 *  most collections are overwhelmingly one or the other and a lone group is a heading for nothing. */
const SINGLES = "Singles";
const SEALED = "Sealed";

/**
 * Grid or list, and a filter over the cards already on screen.
 *
 * Both are local preferences rather than query parameters: a view is how you like to look at a
 * collection, not what the collection is, and a link you share should not carry it. The search
 * narrows what is rendered — it never goes to the server, so it is instant and works on the exact
 * set of holdings you are looking at.
 */
export default function CollectionCards({
  collectionId, href, holdings,
}: {
  collectionId: number;
  /** This collection's canonical URL. Distinct from `collectionId`: the id addresses rows, the
   *  slug addresses the page, and a card's back arrow must return to the page. */
  href: string;
  holdings: Holding[];
}) {
  const [view, setView] = usePersisted<ViewMode>("collection.view", "grid", asView);
  const [query, setQuery] = usePersisted<string>("collection.query", "", (r) => (typeof r === "string" ? r : null));
  const [grouped, setGrouped] = usePersisted<boolean>("collection.group", false, asBool);
  const [closed, setClosed] = usePersisted<string[]>("collection.closed", [], asClosed);

  const toggle = (name: string) =>
    setClosed(closed.includes(name) ? closed.filter((x) => x !== name) : [...closed, name]);

  // "20 cards · 9 sealed" beats "sorted by value": a collection holds both, and which of the two
  // you are looking at is the thing the old "Cards" heading got wrong.
  const breakdown = useMemo(() => {
    const sealed = holdings.filter((h) => h.number == null).reduce((n, h) => n + h.quantity, 0);
    const cards = holdings.reduce((n, h) => n + h.quantity, 0) - sealed;
    const parts = [`${cards} card${cards === 1 ? "" : "s"}`];
    if (sealed > 0) parts.push(`${sealed} sealed`);
    return parts.join(" · ");
  }, [holdings]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return holdings;
    return holdings.filter(
      (h) =>
        h.cardName.toLowerCase().includes(q) ||
        h.setName.toLowerCase().includes(q) ||
        (h.number ?? "").toLowerCase().includes(q) ||
        h.subtype.toLowerCase().includes(q)
    );
  }, [holdings, query]);

  // Singles first: they are what most collections are mostly made of, and sealed reads as the
  // addendum rather than the other way round.
  const groups = useMemo<[string, Holding[]][]>(
    () => [
      [SINGLES, shown.filter((h) => h.number != null)],
      [SEALED, shown.filter((h) => h.number == null)],
    ],
    [shown]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* bleed={false}: this bar lives in the right column of a two-column grid, so it must stop at
          the column edge rather than paint over the summary beside it. */}
      <StickyBar bleed={false}>
        <SectionHeading
          title="Items"
          caption={shown.length === holdings.length ? breakdown : `${shown.length} of ${holdings.length}`}
          trailing={
            <div className="flex gap-1.5">
              <Pill selected={view === "grid"} onClick={() => setView("grid")}>Grid</Pill>
              <Pill selected={view === "list"} onClick={() => setView("list")}>List</Pill>
            </div>
          }
        />
        <SearchField value={query} onChange={setQuery} placeholder="Filter these items…" />
        {/* One toggle, not an Off/On pair: there are exactly two states and the pill's own selected
            styling already says which. Named "type" rather than "Singles / sealed" so the control
            does not collide with the headings it produces. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill selected={grouped} onClick={() => setGrouped(!grouped)}>Group by type</Pill>
        </div>
      </StickyBar>
      {shown.length === 0 ? (
        <p className="text-base text-dim">Nothing here matches “{query.trim()}”.</p>
      ) : grouped ? (
        // A group with nothing in it is not rendered at all: an empty "Sealed" heading on a
        // collection of singles is the thing grouping-by-default would have produced everywhere.
        groups.map(([name, items]) =>
          items.length === 0 ? null : (
            <FoldSection
              key={name}
              title={name}
              caption={`${items.reduce((n, h) => n + h.quantity, 0)}`}
              open={!closed.includes(name)}
              onToggle={() => toggle(name)}
            >
              <Body view={view} holdings={items} href={href} collectionId={collectionId} />
            </FoldSection>
          )
        )
      ) : (
        <Body view={view} holdings={shown} href={href} collectionId={collectionId} />
      )}
    </div>
  );
}

/** Grid or list for one run of holdings — the two branches were identical apart from the component,
 *  and grouping made that three call sites. */
function Body({
  view, holdings, href, collectionId,
}: {
  view: ViewMode;
  holdings: Holding[];
  href: string;
  collectionId: number;
}) {
  return view === "grid" ? (
    <CollectionGrid holdings={holdings} from={href} />
  ) : (
    <HoldingsTable collectionId={collectionId} holdings={holdings} />
  );
}
