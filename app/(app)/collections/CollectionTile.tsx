"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Collection, CollectionSummary } from "@/lib/collections";
import type { ShareLink } from "@/lib/share";
import { formatMoney } from "@/lib/format";
import { Dialog, MenuButton, MenuItem, MoneyDisplay, Panel, PriceDelta } from "@/components/ui";
import CollectionForm from "./CollectionForm";
import SharePanel from "./[slug]/SharePanel";
import { deleteCollectionAction } from "./actions";

/**
 * One collection, as a tile.
 *
 * The whole tile is the link; rename, share and delete live behind the overflow menu in its corner
 * rather than as three buttons along the bottom, which is what made the old stacked panel tall
 * enough that two collections filled the screen.
 *
 * Value reads against cost basis, like everything else in the app — a figure with no comparison is
 * the thing this app exists to avoid.
 */
export default function CollectionTile({
  collection, summary, shareLink,
}: {
  collection: Collection;
  summary: CollectionSummary;
  shareLink: ShareLink | null;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const href = `/collections/${collection.slug ?? collection.id}`;
  const items = summary.cards + summary.sealed;

  async function remove() {
    const what = items === 0 ? "it" : `its ${items} item${items === 1 ? "" : "s"}`;
    if (!window.confirm(`Delete “${collection.name}” and ${what}?`)) return;
    setError(null);
    try {
      const res = await deleteCollectionAction(collection.id);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    }
  }

  return (
    <Panel className="relative flex flex-col gap-3">
      {/* Above the tile link in the stacking order, so the menu is clickable rather than navigating. */}
      <div className="absolute right-3 top-3 z-10">
        <MenuButton label={`Actions for ${collection.name}`}>
          <MenuItem onClick={() => setRenaming(true)}>Rename</MenuItem>
          <MenuItem onClick={() => setSharing(true)}>
            {shareLink?.enabled ? "Sharing…" : "Share"}
          </MenuItem>
          <MenuItem tone="danger" onClick={remove}>Delete</MenuItem>
        </MenuButton>
      </div>

      {renaming ? (
        <div className="flex flex-col gap-2">
          <span className="text-caption text-dim">Rename</span>
          <CollectionForm mode="rename" id={collection.id} name={collection.name} onDone={() => setRenaming(false)} />
        </div>
      ) : (
        <>
          {/* `after:absolute after:inset-0` makes the whole tile the hit area without nesting the
              counts inside the anchor, which would read them out as part of the link's name. */}
          <Link
            href={href}
            className="pr-10 font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:text-accent"
          >
            {collection.name}
          </Link>

          <div className="flex flex-col gap-1">
            <MoneyDisplay size="lg" amount={summary.value} />
            <PriceDelta
              amount={summary.gain}
              ratio={summary.cost > 0 ? summary.gain / summary.cost : null}
              caption="vs. paid"
            />
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-caption text-dim">
            <span className="num">
              <span className="font-semibold text-ink">{summary.cards}</span> card{summary.cards === 1 ? "" : "s"}
            </span>
            <span className="num">
              <span className="font-semibold text-ink">{summary.sealed}</span> sealed
            </span>
            <span className="num">paid {formatMoney(summary.cost)}</span>
            {summary.unpriced > 0 && <span className="num">{summary.unpriced} unpriced</span>}
          </div>
        </>
      )}

      {error && <p role="alert" className="text-base text-accent">{error}</p>}

      <Dialog open={sharing} onClose={() => setSharing(false)} title={`Share “${collection.name}”`}>
        <SharePanel collectionId={collection.id} link={shareLink} />
      </Dialog>
    </Panel>
  );
}
