"use client";
import { useMemo } from "react";
import type { Holding } from "@/lib/collections";
import { VIEW_MODES, type ViewMode } from "@/lib/view-mode";
import { Pill, SearchField, SectionHeading, StickyBar } from "@/components/ui";
import { usePersisted } from "@/components/ui/usePersisted";
import CollectionGrid from "./CollectionGrid";
import HoldingsTable from "./HoldingsTable";

const asView = (raw: unknown): ViewMode | null =>
  typeof raw === "string" && (VIEW_MODES as readonly string[]).includes(raw) ? (raw as ViewMode) : null;

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

  return (
    <div className="flex flex-col gap-4">
      {/* bleed={false}: this bar lives in the right column of a two-column grid, so it must stop at
          the column edge rather than paint over the summary beside it. */}
      <StickyBar bleed={false}>
        <SectionHeading
          title="Cards"
          caption={shown.length === holdings.length ? "sorted by value" : `${shown.length} of ${holdings.length}`}
          trailing={
            <div className="flex gap-1.5">
              <Pill selected={view === "grid"} onClick={() => setView("grid")}>Grid</Pill>
              <Pill selected={view === "list"} onClick={() => setView("list")}>List</Pill>
            </div>
          }
        />
        <SearchField value={query} onChange={setQuery} placeholder="Filter these cards…" />
      </StickyBar>
      {shown.length === 0 ? (
        <p className="text-base text-dim">No card here matches “{query.trim()}”.</p>
      ) : view === "grid" ? (
        <CollectionGrid holdings={shown} from={href} />
      ) : (
        <HoldingsTable collectionId={collectionId} holdings={shown} />
      )}
    </div>
  );
}
