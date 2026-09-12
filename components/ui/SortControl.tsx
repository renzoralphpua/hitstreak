"use client";
import { SORT_OPTIONS, type SortDir, type SortKey } from "@/lib/sort";
import Icon from "./Icon";

/**
 * Choose what a grid is ordered by, and which way round.
 *
 * A select rather than pills: there are five or six options and pills would take a whole row of the
 * pinned bar. The direction is a separate button because it is a different question — "by price" and
 * "dearest first" are not one choice, and picking a new key should not silently reverse the list.
 *
 * Changing the key snaps the direction to that key's natural one (money high-to-low, a binder
 * low-to-high), which is what a reader means by "sort by price" without saying more.
 */
export default function SortControl({
  keys, sortKey, dir, onChange,
}: {
  keys: SortKey[];
  sortKey: SortKey;
  dir: SortDir;
  onChange: (key: SortKey, dir: SortDir) => void;
}) {
  const label = SORT_OPTIONS[sortKey]?.label ?? sortKey;
  return (
    <div className="flex items-center gap-1.5">
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Sort by</span>
        <select
          value={sortKey}
          onChange={(e) => {
            const next = e.target.value as SortKey;
            onChange(next, SORT_OPTIONS[next]?.defaultDir ?? "asc");
          }}
          className="rounded-full border border-hairline bg-surface px-2.5 py-1.5 text-caption text-ink"
        >
          {keys.map((k) => (
            <option key={k} value={k}>
              {SORT_OPTIONS[k].label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => onChange(sortKey, dir === "asc" ? "desc" : "asc")}
        // The accessible name says what pressing it DOES, not what the arrow looks like.
        aria-label={dir === "asc" ? `${label}: lowest first. Reverse` : `${label}: highest first. Reverse`}
        className="inline-flex size-8 items-center justify-center rounded-full border border-hairline text-muted transition-colors hover:bg-hairline-soft hover:text-ink"
      >
        <Icon name={dir === "asc" ? "chevron-up" : "chevron-down"} size="md" />
      </button>
    </div>
  );
}
