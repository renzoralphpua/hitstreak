// Joining OUR set catalog (TCGplayer, via tcgcsv) to pokemontcg.io, which is where the era comes from.
//
// The two name the same set differently often enough that a single strategy is not enough, and the
// obvious fallbacks are actively dangerous — see `resolveSetMeta` for what each tier is protecting
// against. Pure functions, so the rules can be checked without a database or a network.

/** The shape `resolveSetMeta` needs from a pokemontcg.io set. */
export interface UpstreamSet {
  id: string;
  name: string;
  series: string;
  ptcgoCode?: string;
  releaseDate: string; // YYYY/MM/DD upstream
  /** Set art. Carried through so a caller can mirror it; the matcher itself never reads it. */
  images?: { symbol?: string; logo?: string };
}

/**
 * Names differ in punctuation, casing and accents between the two sources far more than in substance.
 * Folding accents is what lets our "Pokemon GO" meet their "Pokémon GO".
 */
export const normName = (s: string): string =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/**
 * TCGplayer leads a set name with its era token; pokemontcg.io does not.
 * `SM - Guardians Rising` → `Guardians Rising`, `SWSH07: Evolving Skies` → `Evolving Skies`.
 */
export const stripEraPrefix = (s: string): string => s.replace(/^[A-Z]{1,5}\d{0,2}\s*(?::|-)\s*/i, "");

/**
 * TCGplayer qualifies a name at the END where pokemontcg.io does not: a print run in parentheses,
 * and a trailing "Set" the upstream name omits.
 *
 * `Base Set (Shadowless)` is the case this exists for — the second 1999 print run of Base Set, which
 * matched nothing and so rendered the most recognisable set in the game under "Promos & products".
 * Its code `BSS` has no upstream counterpart either, so the name is the only way in.
 */
export const nameVariants = (s: string): string[] => {
  const noParen = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return [noParen, noParen.replace(/\s+Set$/i, "").trim()].filter((v) => v !== "" && v !== s.trim());
};

const year = (d?: string | null): number => (d ? Number(d.slice(0, 4)) : NaN);

/**
 * The era token TCGplayer puts at the front of a name, mapped to pokemontcg.io's own series names.
 *
 * A plain `\b` will not do: the token is usually followed by the set NUMBER (`ME06: Delta Reign`,
 * `SWSH01: Sword & Shield Base Set`) and there is no word boundary between "E" and "0". Hence
 * `\d*` then a non-alphanumeric or end-of-string.
 *
 * Order matters — the longer alternatives come first so `MEE` is not eaten by `ME`.
 */
const ERA_TOKEN: readonly (readonly [RegExp, string])[] = [
  [/^POP Series\b/i, "POP"],
  [/^(HGSS|HeartGold)\d*(?=[^A-Za-z0-9]|$)/i, "HeartGold & SoulSilver"],
  [/^SWSH\d*(?=[^A-Za-z0-9]|$)/i, "Sword & Shield"],
  [/^SM\d*(?=[^A-Za-z0-9]|$)/i, "Sun & Moon"],
  [/^(SVE|SVP|SV)\d*(?=[^A-Za-z0-9]|$)/i, "Scarlet & Violet"],
  [/^(MEE|MEP|ME)\d*(?=[^A-Za-z0-9]|$)/i, "Mega Evolution"],
  [/^(BW|Black and White|Black & White)\d*(?=[^A-Za-z0-9]|$)/i, "Black & White"],
  [/^(DP|Diamond and Pearl|Diamond & Pearl)\d*(?=[^A-Za-z0-9]|$)/i, "Diamond & Pearl"],
  [/^XY\d*(?=[^A-Za-z0-9]|$)/i, "XY"],
  [/^EX\d*(?=[^A-Za-z0-9]|$)/i, "EX"],
  [/^Neo\b/i, "Neo"],
  [/^Gym\b/i, "Gym"],
];

/** The era named by a leading token, or undefined. Says nothing about whether that era is real. */
export const eraFromName = (name: string): string | undefined => eraToken(name)?.era;

/**
 * The leading era token AND what follows it.
 *
 * `rest` is the second bite at a name match: TCGplayer writes `EX Team Rocket Returns` where
 * pokemontcg.io writes `Team Rocket Returns`, separated by a SPACE rather than the colon or dash
 * {@link stripEraPrefix} looks for. Stripping on a bare space is only safe for a token we recognise —
 * blindly removing the first word would turn `Base Set (Shadowless)` into `Set (Shadowless)`.
 */
export function eraToken(name: string): { era: string; rest: string } | undefined {
  const trimmed = name.trim();
  for (const [re, era] of ERA_TOKEN) {
    const m = re.exec(trimmed);
    if (m) return { era, rest: trimmed.slice(m[0].length).replace(/^[\s:.-]+/, "") };
  }
  return undefined;
}

/** Everything `resolveSetMeta` needs, built once per run. */
export interface UpstreamIndex {
  byName: Map<string, UpstreamSet>;
  byCode: Map<string, UpstreamSet[]>;
  series: Set<string>;
}

export function indexUpstream(sets: UpstreamSet[]): UpstreamIndex {
  const byName = new Map(sets.map((s) => [normName(s.name), s]));
  // A ptcgoCode is NOT unique upstream — eight of them cover a set and its gallery subset — so keep
  // every candidate. An ambiguous code must be rejected, not resolved to whichever came first.
  const byCode = new Map<string, UpstreamSet[]>();
  for (const s of sets) {
    if (!s.ptcgoCode) continue;
    const k = s.ptcgoCode.toUpperCase();
    byCode.set(k, [...(byCode.get(k) ?? []), s]);
  }
  return { byName, byCode, series: new Set(sets.map((s) => s.series)) };
}

export interface SetMatch {
  /** The upstream set, when one was identified. Its images are the set art; absent means no art. */
  upstream?: UpstreamSet;
  /** The era to store. Null means "Promos & products". */
  series: string | null;
  how: "name" | "stripped" | "variant" | "code" | "token" | "none";
}

/**
 * Five tiers, most trustworthy first.
 *
 * The first four identify a real upstream set and so carry art; the last knows only the era, which is
 * honest about what it has — the product's era without a set to point at.
 *
 * The CODE tier is corroborated by release year, and that guard is the entire point of it. Our `PR`
 * covers 22 product groups and collides with pokemontcg.io's Wizards Black Star Promos, so without it
 * every promo group from every era was filed under "Base" — XY Promos (2013) included. Bare code
 * equality also put EX Battle Stadium (2004) in Sword & Shield and EX Team Rocket Returns (2004) in
 * Platinum. Our release dates are unreliable for ~19 sets that carry the ingest date, and those simply
 * fail the guard rather than matching wrongly, which is the safe direction.
 */
export function resolveSetMeta(
  name: string,
  code: string | null,
  releaseDate: string | null,
  idx: UpstreamIndex
): SetMatch {
  const exact = idx.byName.get(normName(name));
  if (exact) return { upstream: exact, series: exact.series, how: "name" };

  const stripped = idx.byName.get(normName(stripEraPrefix(name)));
  if (stripped) return { upstream: stripped, series: stripped.series, how: "stripped" };

  for (const v of nameVariants(name)) {
    const hit = idx.byName.get(normName(v));
    if (hit) return { upstream: hit, series: hit.series, how: "variant" };
  }

  // Same idea, but for a token separated by a SPACE ("EX Team Rocket Returns"). The upstream series
  // must AGREE with the token for this to count — that corroboration is what makes stripping a bare
  // word safe, and it is why "SM Base Set" cannot quietly become the 1999 "Base".
  const token = eraToken(name);
  if (token) {
    const byRest = idx.byName.get(normName(token.rest));
    if (byRest && byRest.series === token.era) {
      return { upstream: byRest, series: byRest.series, how: "stripped" };
    }
  }

  const hits = code ? idx.byCode.get(code.toUpperCase()) ?? [] : [];
  if (hits.length === 1) {
    const gap = Math.abs(year(releaseDate) - year(hits[0].releaseDate));
    if (Number.isFinite(gap) && gap <= 1) return { upstream: hits[0], series: hits[0].series, how: "code" };
  }

  // Checked against the LIVE upstream vocabulary, so this can never invent a heading.
  if (token && idx.series.has(token.era)) return { series: token.era, how: "token" };

  return { series: null, how: "none" };
}

/**
 * Orders eras oldest to newest by when each STARTED, using the upstream dates.
 *
 * Ours cannot do this job: ~19 Pokemon sets carry the ingest date rather than a real release, and
 * every POP Series is among them — so ranking by our own MIN or MAX puts Base Set and XY above Mega
 * Evolution. Higher is newer.
 */
export function rankSeries(sets: UpstreamSet[]): Map<string, number> {
  const earliest = new Map<string, string>();
  for (const s of sets) {
    const seen = earliest.get(s.series);
    if (!seen || s.releaseDate < seen) earliest.set(s.series, s.releaseDate);
  }
  return new Map(
    [...earliest.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([series], i) => [series, i])
  );
}
