// Sorting for card grids. Pure, so the interesting decisions can be checked without React.

/** Everything any grid sorts by. A surface supplies what it has and offers only the keys it filled. */
export interface SortableCard {
  name: string;
  number: string | null;
  rarity: string | null;
  /** Market price on a set grid; the holding's value on a collection grid. */
  price: number | null;
  /** Cost basis. Null on a set grid, and on a copy bought with no price recorded. */
  paid?: number | null;
  /** price − paid. Null wherever `paid` is. */
  gain?: number | null;
  /** Copies held. 0 on a set grid means you do not own it. */
  owned: number;
}

export type SortKey = "number" | "name" | "price" | "paid" | "gain" | "rarity" | "owned";
export type SortDir = "asc" | "desc";

/**
 * Card numbers in the order a binder is in.
 *
 * Plain string comparison puts "161/131" before "25/131", and "OP08-10" before "OP08-9". This walks
 * digit runs and non-digit runs in step, comparing numbers as numbers — so the prefix, the number
 * and the set total all sort the way they read.
 */
export function compareCardNumber(a: string | null, b: string | null): number {
  // A sealed product has no number; it sorts after every card rather than before all of them.
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  const re = /(\d+)|(\D+)/g;
  const as = a.toLowerCase().match(re) ?? [];
  const bs = b.toLowerCase().match(re) ?? [];
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const x = as[i], y = bs[i];
    const nx = Number(x), ny = Number(y);
    const bothNumeric = !Number.isNaN(nx) && !Number.isNaN(ny) && x.trim() !== "" && y.trim() !== "";
    const cmp = bothNumeric ? nx - ny : x.localeCompare(y);
    if (cmp !== 0) return cmp;
  }
  return as.length - bs.length;
}

const unknownNumber = (v: number | null | undefined): boolean => v == null || !Number.isFinite(v);

export interface SortOption {
  key: SortKey;
  label: string;
  /** Which way round the FIRST click should go — money reads high-to-low, a binder reads low-to-high. */
  defaultDir: SortDir;
}

export const SORT_OPTIONS: Record<SortKey, SortOption> = {
  number: { key: "number", label: "Card number", defaultDir: "asc" },
  name: { key: "name", label: "Name", defaultDir: "asc" },
  price: { key: "price", label: "Market price", defaultDir: "desc" },
  paid: { key: "paid", label: "Price paid", defaultDir: "desc" },
  gain: { key: "gain", label: "Gain", defaultDir: "desc" },
  rarity: { key: "rarity", label: "Rarity", defaultDir: "desc" },
  owned: { key: "owned", label: "Copies held", defaultDir: "desc" },
};

/** The keys a set grid offers. No paid or gain: a set is mostly cards you do not own, so those two
 *  columns would be blank for nearly every row. */
export const SET_SORT_KEYS: SortKey[] = ["number", "price", "name", "rarity", "owned"];

/** A collection is entirely things you own and paid for, so cost basis is worth sorting by. */
export const COLLECTION_SORT_KEYS: SortKey[] = ["price", "gain", "paid", "name", "number", "rarity"];

export const isSortKey = (v: unknown, allowed: SortKey[]): v is SortKey =>
  typeof v === "string" && (allowed as string[]).includes(v);
export const isSortDir = (v: unknown): v is SortDir => v === "asc" || v === "desc";

/**
 * Rarity, ordered by SCARCITY IN THE LIST BEING SORTED — rarest first.
 *
 * Deliberately not a rank table. The three games share no vocabulary (Pokemon "Secret Rare", One
 * Piece "SEC", Riftbound "Epic"), there are 40 distinct values today, and Riftbound added "Showcase"
 * after launch — a hand-maintained table would be wrong the week a set ships. Counting is
 * self-maintaining and, within a set, a good proxy: a set really does hold a hundred commons and
 * three secret rares.
 *
 * Its weakness is honest and worth knowing: across a whole collection the counts reflect what YOU
 * own, so a rarity you happen to hold a lot of sinks.
 */
function rarityRank(cards: SortableCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cards) {
    if (c.rarity == null) continue;
    counts.set(c.rarity, (counts.get(c.rarity) ?? 0) + 1);
  }
  return counts;
}

/**
 * A new, sorted array. Ties break by card number then name, so the order is total and stable.
 *
 * Unknown values are pushed out BEFORE the direction is applied, which is the whole trick: "we do
 * not know what you paid" must sit at the bottom of a cheapest-first list AND a dearest-first one.
 * Folding that into the comparator and then reversing puts it at the top of one of them.
 */
export function sortCards<T extends SortableCard>(cards: T[], key: SortKey, dir: SortDir): T[] {
  const flip = dir === "desc" ? -1 : 1;
  const counts = key === "rarity" ? rarityRank(cards) : null;

  const valueOf = (c: T): number | null | undefined =>
    key === "price" ? c.price : key === "paid" ? c.paid : key === "gain" ? c.gain : undefined;

  const unknown = (c: T): boolean =>
    key === "rarity" ? c.rarity == null
      : key === "price" || key === "paid" || key === "gain" ? unknownNumber(valueOf(c))
      : false;

  /** ASCENDING order for this key. Direction is applied by the caller, never in here. */
  const ascending = (a: T, b: T): number => {
    switch (key) {
      case "number": return compareCardNumber(a.number, b.number);
      case "name": return a.name.localeCompare(b.name);
      case "owned": return a.owned - b.owned;
      // Scarcity ascending = most common first, so the option's "desc" default lands rarest-first.
      case "rarity": return (counts!.get(b.rarity!) ?? 0) - (counts!.get(a.rarity!) ?? 0);
      default: return (valueOf(a) as number) - (valueOf(b) as number);
    }
  };

  const tie = (a: T, b: T): number => {
    const n = compareCardNumber(a.number, b.number);
    return n !== 0 ? n : a.name.localeCompare(b.name);
  };

  return [...cards].sort((a, b) => {
    const ua = unknown(a);
    const ub = unknown(b);
    if (ua || ub) return ua && ub ? tie(a, b) : ua ? 1 : -1;
    const p = ascending(a, b) * flip;
    return p !== 0 ? p : tie(a, b);
  });
}
