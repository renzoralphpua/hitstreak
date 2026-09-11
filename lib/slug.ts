// Readable set URLs. `/sets/prismatic-evolutions` rather than `/sets/117`.
//
// The set CODE cannot do this job: 320 sets share 281 codes, and "PR" alone covers 22 of them
// (Deck Exclusives, League & Championship Cards, every Trainer Kit…). Names are effectively unique,
// so the slug comes from the name.

/** `Prismatic Evolutions` → `prismatic-evolutions`. Accents are folded, everything else collapses. */
export function toSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

export interface Sluggable {
  id: number;
  name: string;
  gameSlug: string;
  /** Already assigned; never regenerated. A live URL must not change meaning. */
  slug?: string | null;
}

/**
 * Assigns a slug to every set that does not have one, leaving existing ones untouched.
 *
 * Uniqueness is scoped PER GAME, because the URL is — `/sets/pokemon/unleashed` and
 * `/sets/riftbound/unleashed` are different pages and neither has to apologise for the other. Two
 * sets sharing a name inside one game (which does not currently happen) fall back to the id, which
 * is unique by construction.
 *
 * Never reassigns: a slug already in the database is a URL someone may have bookmarked.
 */
export function assignSlugs(sets: Sluggable[]): Map<number, string> {
  // One namespace per game, seeded with what is already taken there.
  const taken = new Map<string, Set<string>>();
  for (const s of sets) {
    const set = taken.get(s.gameSlug) ?? new Set<string>();
    if (s.slug) set.add(s.slug);
    taken.set(s.gameSlug, set);
  }

  const out = new Map<number, string>();
  for (const s of sets) {
    if (s.slug) continue;
    const used = taken.get(s.gameSlug)!;
    const base = toSlug(s.name) || `set-${s.id}`;
    const candidate = used.has(base) ? `${base}-${s.id}` : base;
    used.add(candidate);
    out.set(s.id, candidate);
  }
  return out;
}

/** True when a route parameter is a bare database id rather than a slug. */
export const isNumericId = (v: string): boolean => /^\d+$/.test(v);
